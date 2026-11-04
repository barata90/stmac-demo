/* STMAC live console: UI, charts, map, and the live interpretation layer.
 * The solver runs in a Web Worker (assets/js/stmac-worker.js); when workers are unavailable
 * (for example index.html opened from disk in Chrome) the same engine runs on the main thread.
 * Every interpretation sentence below is computed from the current run; paper figures are
 * always labelled as such. */
(function () {
'use strict';
const Core = window.STMACCore;
const $ = id => document.getElementById(id);
if (!Core) { const s = $('status'); if (s) s.textContent = 'Could not load assets/js/stmac-core.js.'; return; }
const { STATIONS, N, SPD, TZ, REALMETA, BLOCKS, R_RATIO, RIDGE, GRAPH_K, GRAPH_SIGMA, LON_MEAN, S0_R, S0_G, GT_NU, GT_EPS } = Core;
const scored = i => Core.evalHour(i); /* 08:00-16:55 local time, the notebooks' DAYTIME mask */
const EVAL_LAB = '08:00–16:55';
const VERSION = '20261104';
const R_CHOICES = [10, 100, 1000, 10000], G_CHOICES = [0, 0.3, 1, 3, 10, 30];
/* Paper, means over the seven block lengths (W/m2): the Transformer from Table I (full year,
   20 masks); the climatology, STMAC and the graph baselines from the mean row of Table II
   (ten shared masks). These are the RMSEs behind the first-order column of Table III. */
const PAPER = { tf: 210.2, mdv: 162.6, stmac: 145.9, tvm: 139.3, gtm: 128.8 };
/* Paper, Table I: full year (20 masks) and held-out 7 Nov to 31 Dec 1999 (30 masks), W/m2.
   s0 = STMAC without prior (C = 0, g = 0, r = 10); ho* = held-out columns; k = index into BLOCKS. */
/* Paper, Table II: the ten shared masks (Section VI-B), W/m2. tv/gt/rt = TVGSR, GraphTRSS,
   RTVGSR on raw irradiance; tvm/gtm = TVGSR and GraphTRSS on the MDV anomalies; s = STMAC. */
const TABLE2 = [
  { lab: '30 min', k: 0, mdv: 161.8, tv: 75.0, gt: 74.1, rt: 78.7, tvm: 76.2, gtm: 68.0, s: 89.4 },
  { lab: '2 h', k: 1, mdv: 163.0, tv: 96.5, gt: 95.7, rt: 103.8, tvm: 96.0, gtm: 87.5, s: 140.8 },
  { lab: '6 h', k: 2, mdv: 159.9, tv: 136.0, gt: 135.3, rt: 139.8, tvm: 127.3, gtm: 117.2, s: 151.5 },
  { lab: '12 h', k: 3, mdv: 161.6, tv: 169.9, gt: 169.3, rt: 175.0, tvm: 152.5, gtm: 142.2, s: 156.8 },
  { lab: '1 day', k: 4, mdv: 159.2, tv: 183.7, gt: 183.0, rt: 188.2, tvm: 162.7, gtm: 151.0, s: 155.5 },
  { lab: '3 days', k: 5, mdv: 163.6, tv: 196.7, gt: 196.2, rt: 201.5, tvm: 174.4, gtm: 161.7, s: 161.0 },
  { lab: '7 days', k: 6, mdv: 169.2, tv: 199.4, gt: 198.7, rt: 206.0, tvm: 186.2, gtm: 173.7, s: 166.3 }];
/* GraphTRSS + MDV against STMAC in the paper (Holm-corrected paired Wilcoxon tests, Section VI-B) */
const GT_VERDICT = ['below STMAC (p ≤ 0.027)', 'below STMAC (p ≤ 0.027)', 'below STMAC (p ≤ 0.027)', 'below STMAC (p ≤ 0.027)', 'below STMAC (p ≤ 0.027)', 'level with STMAC (p = 0.63)', 'above STMAC (p = 0.014)'];
const TABLE1 = [
  { lab: '30 min', k: 0, pt: 70, mdv: 162.0, tf: 153.0, s0: 114.3, stmac: 89.6, hoMdv: 96.3, hoTf: 106.4, hoS: 61.4 },
  { lab: '2 h', k: 1, pt: 114, mdv: 162.5, tf: 165.6, s0: 182.5, stmac: 140.0, hoMdv: 94.5, hoTf: 108.8, hoS: 87.1 },
  { lab: '6 h', k: 2, pt: 239, mdv: 163.2, tf: 201.3, s0: 192.5, stmac: 154.4, hoMdv: 97.1, hoTf: 120.1, hoS: 94.1 },
  { lab: '12 h', k: 3, pt: 445, mdv: 162.1, tf: 219.0, s0: 194.8, stmac: 157.2, hoMdv: 91.9, hoTf: 123.4, hoS: 89.9 },
  { lab: '1 day', k: 4, pt: 727, mdv: 160.8, tf: 229.9, s0: 195.6, stmac: 157.4, hoMdv: 96.9, hoTf: 130.2, hoS: 95.8 },
  { lab: '3 days', k: 5, pt: 1904, mdv: 166.2, tf: 250.7, s0: 202.3, stmac: 163.3, hoMdv: 99.5, hoTf: 138.7, hoS: 98.5 },
  { lab: '7 days', k: 6, pt: 4961, mdv: 169.1, tf: 251.8, s0: 199.6, stmac: 166.5, hoMdv: 100.1, hoTf: 137.8, hoS: 99.2 }];
/* sky condition of a day, as in the analysis notebooks (KT_CLEAR, KT_CLOUDY): daily clear-sky
   index at most 0.70 = cloudy, at least 0.85 = clear. The paper reports the split, not the thresholds. */
const CLOUDY_K = 0.70, CLEAR_K = 0.85;
const PHYS_MAX = 1400;       /* upper end of the physical range of GHI used in the readings, W/m2 */
const SAUDI = [[34.95,29.35],[36.07,29.19],[37.00,31.50],[38.00,32.00],[39.20,32.15],[40.40,31.95],
 [41.90,31.00],[42.86,30.50],[44.72,29.20],[46.55,29.10],[47.46,29.00],[47.70,28.52],[48.42,28.55],
 [48.80,27.70],[49.30,27.50],[49.70,26.90],[50.15,26.65],[50.21,26.00],[50.80,25.30],[51.25,24.60],
 [51.60,24.25],[52.60,22.90],[55.13,22.63],[55.20,20.00],[52.00,19.00],[49.00,18.60],[47.50,17.10],
 [47.00,16.95],[45.40,17.33],[44.50,17.43],[43.90,17.35],[43.30,16.65],[42.80,16.40],[42.30,17.10],
 [41.40,18.60],[40.80,19.80],[39.60,20.60],[39.10,21.30],[38.90,22.40],[38.50,23.60],[37.90,24.20],
 [37.20,24.90],[36.60,25.70],[36.20,26.60],[35.60,27.40],[35.00,28.10],[34.60,28.30],[34.80,28.90]];

/* ================= formatting ================= */
const MINUS = '−';
const isNum = x => typeof x === 'number' && isFinite(x);
const f0 = x => isNum(x) ? (Math.round(x) < 0 ? MINUS : '') + Math.abs(Math.round(x)).toLocaleString('en-US') : '–';
const f1 = x => isNum(x) ? (x < -0.05 ? MINUS : '') + Math.abs(x).toFixed(1) : '–';
const f2 = x => isNum(x) ? (x < -0.005 ? MINUS : '') + Math.abs(x).toFixed(2) : '–';
const sg = (x, d) => isNum(x) ? (x > 0 ? '+' : x < 0 ? MINUS : '±') + (d ? Math.abs(x).toFixed(d) : Math.round(Math.abs(x)).toLocaleString('en-US')) : '–';
const money = v => (v < 0 ? MINUS : '') + '$' + (Math.abs(v) >= 100 ? Math.abs(v).toFixed(0) : Math.abs(v) >= 1 ? Math.abs(v).toFixed(1) : Math.abs(v).toFixed(2)) + 'M';
const fmtMs = ms => ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s';
const pad2 = n => (n < 10 ? '0' : '') + n;
function hm(min) { min = ((Math.round(min) % 1440) + 1440) % 1440; return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }
function fmtDur(cells) {
  const m = cells * 5;
  if (m < 60) return m + ' min';
  if (m < 1440) { const h = Math.floor(m / 60), r = m % 60; return h + ' h' + (r ? ' ' + r + ' min' : ''); }
  const d = Math.floor(m / 1440), h = Math.round((m % 1440) / 60);
  return d + (d === 1 ? ' day' : ' days') + (h ? ' ' + h + ' h' : '');
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function dateLab(i) { const d = new Date(GRID.START_UTC + Math.floor(i / SPD) * 86400000); return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
const clockMin = i => (i % SPD) * 5;
const whenLab = i => dateLab(i) + ' ' + hm(clockMin(i));
/* approximate local solar time: the UTC+3 meridian is 45 E, 4 minutes per degree, no equation of time */
const solarMin = (v, i) => clockMin(i) + (STATIONS[v].lon - 45) * 4;
const solarNoonClock = v => 720 - (STATIONS[v].lon - 45) * 4;
const stn = v => STATIONS[v].code + ' · ' + STATIONS[v].name;

/* ================= colours ================= */
const css = getComputedStyle(document.documentElement);
const cvar = n => css.getPropertyValue(n).trim();
const C = { solar: cvar('--solar') || '#d4af37', stmac: cvar('--stmac') || '#00f5d4', pt: cvar('--pt') || '#fb7185', triv: cvar('--triv') || '#94a3b8',
  ink: cvar('--ink') || '#f8fafc', muted: cvar('--muted') || '#94a3b8', faint: cvar('--faint') || '#64748b', line: cvar('--line') || '#26303e',
  line2: cvar('--line2') || '#3a4658', mdv: cvar('--mdv') || '#7fc97f', tf: cvar('--tf') || '#c9a2ff', s0: cvar('--s0') || '#60a5fa', goldHi: cvar('--gold-hi') || '#f5d76e',
  gt: cvar('--gt') || '#fb923c', tvm: cvar('--tvm') || '#d6a56b' };
function rgba(hex, a) { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
const METHODS = {
  PT: { key: 'PT', lab: 'Pure temporal', short: 'Pure temporal', color: () => C.pt, show: 'showPT', r: 'rPT', card: 'cPT' },
  MDV: { key: 'MDV', lab: 'Station climatology (MDV)', short: 'Climatology', color: () => C.mdv, show: 'showMDV', r: 'rMDV', card: 'cAdv' },
  STT: { key: 'STT', lab: 'STMAC · trivial sheaf', short: 'STMAC trivial', color: () => C.triv, show: 'showTriv', r: 'rSTT', card: 'cSTT' },
  STL: { key: 'STL', lab: 'STMAC · longitude sheaf', short: 'STMAC', color: () => C.stmac, r: 'rSTL', card: 'cSTL' },
  S0: { key: 'S0', lab: 'STMAC without prior (S0)', short: 'S0 (no prior)', color: () => C.s0, show: 'showS0', r: 'rS0', card: 'cS0' },
  GT: { key: 'GT', lab: 'GraphTRSS + MDV', short: 'GraphTRSS+MDV', color: () => C.gt, show: 'showGT', r: 'rGT', card: 'cGT' } };
const MKEYS = ['STL', 'GT', 'MDV', 'PT', 'STT', 'S0'];
const shown = k => { const sk = METHODS[k].show; return !sk || !!state[sk]; };

/* ================= state ================= */
const state = { seed: 42, maskSeed: 11, blockIdx: 5, frac: 0.10, sel: 0, gapIdx: 0, dataset: 'real',
  showTriv: false, showS0: false, showGT: false, showPT: true, showMDV: true, res: null, sweep: null,
  econ: { view: 'uc', col: 'c40', src: 'live' },
  r: R_RATIO, g: RIDGE, emph: null, pin: null,
  focus: { map: null, metric: null, sweep: null, cost: null, load: null }, solveLog: [] };
let DATA = null, GRID = Core.grid(), loadingDs = false;
const GRAPH = Core.buildGraph(), W = GRAPH.W, DIST = GRAPH.D;
const EDGES = []; for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (W[i][j] > 0) EDGES.push({ i, j, w: W[i][j], d: DIST[i][j] });
const neighbours = v => EDGES.filter(e => e.i === v || e.j === v).map(e => ({ u: e.i === v ? e.j : e.i, w: e.w, d: e.d })).sort((a, b) => b.w - a.w);
const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const views = (buf, T) => { const a = []; for (let v = 0; v < N; v++) a.push(buf.subarray(v * T, (v + 1) * T)); return a; };

/* ================= engine: worker with main-thread fallback ================= */
function makeWorkerClient() {
  let w;
  try { w = new Worker('assets/js/stmac-worker.js?v=' + VERSION); } catch (e) { return null; }
  const pend = new Map(); let seq = 0, dead = false, deadErr = null;
  w.onmessage = e => { const m = e.data, p = pend.get(m.id); if (!p) return; pend.delete(m.id); m.ok ? p.res(m.out) : p.rej(new Error(m.error)); };
  w.onerror = e => { if (e.preventDefault) e.preventDefault(); dead = true; deadErr = new Error('worker failed: ' + (e.message || 'script error'));
    for (const p of pend.values()) p.rej(deadErr); pend.clear(); };
  return { kind: 'worker', get dead() { return dead; },
    call(op, p) { if (dead) return Promise.reject(deadErr); return new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); w.postMessage({ id, op, p }); }); },
    terminate() { dead = true; w.terminate(); } };
}
function makeLocalClient() {
  let payload = null;
  const eng = Core.createEngine(() => {
    if (window.STMAC_NLR1999) return window.STMAC_NLR1999;
    if (!payload) payload = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'assets/data/nlr1999.js?v=' + VERSION;
      s.onload = () => res(window.STMAC_NLR1999); s.onerror = () => rej(new Error('could not load assets/data/nlr1999.js'));
      document.head.appendChild(s);
    });
    return payload;
  });
  let chain = Promise.resolve();
  return { kind: 'main', dead: false,
    call(op, p) {
      /* yield one frame first so the UI can paint the busy state before the solver blocks */
      const run = () => new Promise(r => setTimeout(r, 20)).then(() => eng.handle({ op, p })).then(o => { if (o && o.transfer) delete o.transfer; return o; });
      const pr = chain.then(run, run); chain = pr.catch(() => {}); return pr;
    }, terminate() {} };
}
const engine = {
  client: null, lastLoad: null,
  get mode() { return this.client ? this.client.kind : 'none'; },
  init() { this.client = makeWorkerClient() || makeLocalClient(); },
  fallback(err) {
    console.warn('[stmac] worker unavailable, solving on the main thread instead:', err && err.message);
    this.client = makeLocalClient(); pool.disable();
  },
  async call(op, p) {
    try { return await this.client.call(op, p); }
    catch (err) {
      if (this.client.kind !== 'worker' || !(this.client.dead || op === 'load')) throw err;
      this.fallback(err);
      if (op !== 'load' && this.lastLoad) await this.client.call('load', Object.assign({}, this.lastLoad, { withArrays: false }));
      return this.client.call(op, p);
    }
  } };
/* helper workers for the block-length sweep; the primary worker stays free for interactive runs */
const pool = {
  helpers: [], disabled: false,
  want() { const hc = navigator.hardwareConcurrency || 2; return Math.min(3, Math.max(0, hc - 2)); },
  async get(dsKey) {
    if (this.disabled || engine.mode !== 'worker') return [engine];
    while (this.helpers.length < this.want()) { const c = makeWorkerClient(); if (!c) break; this.helpers.push({ c, key: null }); }
    const ready = [];
    await Promise.all(this.helpers.map(async h => {
      try { if (h.key !== dsKey) { const o = await h.c.call('load', Object.assign({}, engine.lastLoad, { withArrays: false })); h.key = o.key; } if (h.key === dsKey) ready.push(h.c); }
      catch (e) { h.c.terminate(); h.dead = true; }
    }));
    this.helpers = this.helpers.filter(h => !h.dead);
    return ready.length ? ready : [engine];
  },
  disable() { this.disabled = true; this.helpers.forEach(h => h.c.terminate()); this.helpers = []; } };

/* ================= busy / status ================= */
function setStatus(txt, busy) { const s = $('status'); s.textContent = txt; s.classList.toggle('busy', !!busy); }
function setBusy(on) {
  document.querySelector('.cards').classList.toggle('stale', on && !!state.res);
  const b = document.querySelector('.badge.solve'); if (b) b.classList.toggle('busy', on);
}

/* ================= dataset ================= */
let dsToken = 0;
async function loadDataset(kind) {
  const tok = ++dsToken;
  loadingDs = true;
  state.dataset = kind; state.sweep = null; state.gapIdx = 0; state.pin = null;
  state.focus.sweep = null;
  $('sweepBtn').disabled = false; $('sweepStatus').classList.remove('busy'); /* any running sweep belongs to the old dataset */
  setBusy(true);
  setStatus(kind === 'real' ? 'loading the real 1999 record (' + REALMETA.label + ')…' : 'generating synthetic weather…', true);
  const rb = $('reseedBtn'); rb.textContent = kind === 'real' ? '↻ New outage draw' : '↻ New weather + outage draw';
  engine.lastLoad = { kind, seed: state.seed };
  let out;
  try { out = await engine.call('load', { kind, seed: state.seed, withArrays: true }); }
  catch (err) { if (tok === dsToken) { loadingDs = false; setStatus('could not load the data: ' + err.message); drawTS(); } return false; }
  if (tok !== dsToken) return false;
  GRID = out.grid;
  const T = GRID.T;
  DATA = { key: out.key, kind, U: views(out.U, T), CS: views(out.CS, T), loadMs: out.ms,
    corr: { aligned: out.corrAligned, clock: out.corrClock, n: out.corrN, daily: out.corrDaily, raw: out.corrRaw }, kDaily: out.kDaily };
  loadingDs = false;
  state.res = null; /* results of the previous dataset no longer match these arrays */
  updateChartHead(); drawTS(); renderTsInsight(); renderMetricInsight();
  const d = $('disclose');
  d.innerHTML = kind === 'real'
    ? 'You are looking at the <b>real 1999 Saudi NLR record</b> — 70 days (' + REALMETA.label + '), 11 stations, 5-minute GHI, shipped with this page (' + REALMETA.fillPct + '% of rows were absent from the all-valid record and were linearly interpolated before embedding). Timestamps are Saudi local clock (UTC+3); station identities were verified by solar-noon inference from the data itself; map coordinates are approximate. Table I of the paper is quoted in the panel below; this 70-day window overlaps its held-out period (7 Nov to 31 Dec), so the live errors are closest to the held-out columns and lower than the full-year ones. Errors are scored on removed cells between 08:00 and 16:55 local time, the window of the paper’s notebooks.'
    : 'The synthetic mode runs on <b>physics-based synthetic irradiance</b> — true solar geometry per station latitude/longitude plus spatially correlated moving cloud fronts — so the solver behaviour is real even though the weather is simulated. Switch to the real 1999 NLR record for the genuine article.';
  $('sweepStatus').textContent = kind === 'real'
    ? 'Press “Run full block-length sweep” — 28 joint space-time solves on 70 days of real data, a few seconds.'
    : 'Press “Run full block-length sweep” — 28 joint space-time solves, a few seconds.';
  drawSweep(); renderSweepInsight(); renderMapInsight(); drawLegend();
  return true;
}

/* ================= scenario (latest request wins) ================= */
let scenRunning = false, scenPending = false;
function requestScenario() {
  scenPending = true;
  setBusy(true);
  setStatus('building outage mask + solving' + (engine.mode === 'worker' ? ' in a background worker' : '') + '…', true);
  if (!scenRunning && !loadingDs && DATA) pumpScenario();
}
async function pumpScenario() {
  scenRunning = true;
  while (scenPending && DATA && !loadingDs) {
    scenPending = false;
    const p = { dsKey: DATA.key, blockIdx: state.blockIdx, frac: state.frac, maskSeed: state.maskSeed, r: state.r, g: state.g };
    const t0 = performance.now();
    let out;
    try { out = await engine.call('scenario', p); }
    catch (err) { if (!scenPending) setStatus('solver error: ' + err.message); continue; }
    if (scenPending || loadingDs || !DATA || out.dsKey !== DATA.key) continue;
    applyScenario(out, performance.now() - t0);
  }
  scenRunning = false;
  if (!scenPending) setBusy(false);
}
function applyScenario(out, wall) {
  const T = GRID.T;
  const res = { params: out.params, effFrac: out.effFrac, nb: out.nb, n: out.n, bw: out.bw, ms: out.ms, tm: out.tm, wall, gtN: out.gtN, gtBw: out.gtBw,
    rPT: out.rPT, rMDV: out.rMDV, rSTL: out.rSTL, rSTT: out.rSTT, rS0: out.rS0, rGT: out.rGT, stats: out.stats, T,
    M: views(out.M, T), PT: views(out.PT, T), MDV: views(out.MDV, T), STL: views(out.STL, T), STT: views(out.STT, T), S0: views(out.S0, T), GT: views(out.GT, T), _gaps: [], _gapStats: [] };
  state.res = res;
  state.solveLog.push({ ms: out.ms, total: out.tm.total, wall });
  const bl = BLOCKS[out.params.blockIdx];
  $('bSolve').textContent = fmtMs(out.ms);
  $('bPat').textContent = out.n.toLocaleString('en-US');
  $('effLine').textContent = 'effective missing: ' + (100 * out.effFrac).toFixed(1) + '% per station (' + out.nb + ' block' + (out.nb > 1 ? 's' : '') + ' × ' + bl.lab + ')';
  for (const k of MKEYS) animateMetric(METHODS[k].card, res[METHODS[k].r]);
  setStatus('solved. STMAC reconstruction: ' + fmtMs(out.ms) + ' for ' + N + '×' + T.toLocaleString('en-US') + ' cells; ' + out.n.toLocaleString('en-US') +
    ' unknown cells solved exactly in one sparse factorisation — no training, no fitted model' +
    (engine.mode === 'worker' ? ' (computed in a background worker, so the page stays responsive).' : '.'));
  setBusy(false);
  state.gapIdx = 0; state.pin = null;
  updateChartHead(); drawTS(); renderTsInsight(); renderMetricInsight(); updateEcon(); renderMapInsight();
  drawSweep(); renderSweepInsight(); refreshPop(); scheduleStamp();
}
function animateMetric(id, val) {
  const el = $(id).querySelector('.n');
  const from = parseFloat(el.dataset.v || '0') || 0;
  el.dataset.v = String(val);
  if (reduceMotion) { el.textContent = f0(val); return; }
  const t0 = performance.now(), dur = 650;
  (function tick(now) {
    /* clamp at 0: the first rAF timestamp can precede t0 when a long task just finished */
    const p = Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - p, 3);
    el.textContent = f0(from + (val - from) * e);
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

/* ================= per-gap helpers (computed on the main thread from the returned arrays) ================= */
function gapsOf(v) {
  const r = state.res; if (!r) return [];
  if (r._gaps[v]) return r._gaps[v];
  const M = r.M[v], T = r.T, g = []; let s = -1;
  for (let i = 0; i < T; i++) { if (!M[i] && s < 0) s = i; if (M[i] && s >= 0) { g.push([s, i]); s = -1; } }
  if (s >= 0) g.push([s, T]);
  return (r._gaps[v] = g);
}
function gapStats(v, g0, g1) {
  const r = state.res, U = DATA.U[v], CS = DATA.CS[v];
  const acc = {}; for (const k of MKEYS) acc[k] = { s: 0, b: 0 };
  let nDay = 0, su = 0, sc = 0;
  for (let i = g0; i < g1; i++) {
    if (!scored(i)) continue;
    nDay++; su += U[i]; sc += CS[i];
    for (const k of MKEYS) { const d = r[k][v][i] - U[i]; acc[k].s += d * d; acc[k].b += d; }
  }
  const rmse = {}, bias = {};
  for (const k of MKEYS) { rmse[k] = nDay ? Math.sqrt(acc[k].s / nDay) : NaN; bias[k] = nDay ? acc[k].b / nDay : NaN; }
  return { n: g1 - g0, nDay, rmse, bias, k: sc > 0 ? su / sc : NaN };
}
function allGapStats(v) {
  const r = state.res; if (r._gapStats[v]) return r._gapStats[v];
  return (r._gapStats[v] = gapsOf(v).map(([a, b]) => gapStats(v, a, b)));
}
function dayIndexK(v, i) { const d = Math.floor(i / SPD); return DATA.kDaily && DATA.kDaily[v] ? DATA.kDaily[v][d] : NaN; }
function skyPhrase(k) {
  if (!isNum(k)) return '';
  return k <= CLOUDY_K ? 'a cloudy day by the notebooks’ threshold (≤ 0.70)' : k >= CLEAR_K ? 'a clear day by the notebooks’ threshold (≥ 0.85)' : 'between the notebooks’ cloudy (≤ 0.70) and clear (≥ 0.85) thresholds';
}

/* ================= canvas helpers ================= */
function sizeCanvas(cv, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(40, cv.parentNode.clientWidth);
  if (cv._w !== w || cv._h !== h || cv._dpr !== dpr) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px';
    cv._w = w; cv._h = h; cv._dpr = dpr;
  }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
const boxH = cv => +cv.parentNode.dataset.h;
const FONT = '12px "IBM Plex Mono",ui-monospace,monospace';
function placeholder(ctx, w, h, txt) {
  ctx.font = FONT; ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.fillText(txt, w / 2, h / 2); ctx.textAlign = 'left';
}
function niceTicks(lo, hi, n) {
  const span = hi - lo, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag; const stepv = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const out = []; for (let t = Math.ceil(lo / stepv) * stepv; t <= hi; t += stepv) out.push(t); return out;
}

/* ================= tooltip ================= */
const tip = $('tip');
function showTip(html, x, y) {
  tip.innerHTML = html; tip.classList.add('on'); tip.setAttribute('aria-hidden', 'false');
  const tw = tip.offsetWidth, th = tip.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
  let px = x + 16, py = y + 16;
  if (px + tw > vw - 8) px = Math.max(8, x - tw - 16);
  if (py + th > vh - 8) py = Math.max(8, y - th - 16);
  tip.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)';
}
function hideTip() { if (!tip.classList.contains('on')) return; tip.classList.remove('on'); tip.setAttribute('aria-hidden', 'true'); }
window.addEventListener('scroll', hideTip, { passive: true });
const tipRow = (lab, val, color) => '<div class="r"><span>' + (color ? '<i style="background:' + color + '"></i>' : '') + lab + '</span><b>' + val + '</b></div>';

/* ================= insight boxes ================= */
function setInsight(id, o) {
  const box = $(id);
  box.querySelector('.ins-pill').textContent = o.pill;
  box.querySelector('.ins-body').innerHTML = o.html;
  box.classList.toggle('focused', !!o.focused);
  const rb = box.querySelector('.ins-reset'); rb.hidden = !o.onReset; rb.onclick = o.onReset || null;
  if (o.flash) {
    const g = box.querySelector('.ins-glow');
    if (!reduceMotion && g.animate) g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' });
    const r = box.getBoundingClientRect();
    if (r.top > window.innerHeight - 40) box.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  scheduleStamp();
}
const tile = (k, v, d, color) => '<div class="ins-stat"><span class="k">' + (color ? '<span class="sw" style="background:' + color + '"></span>' : '') + k + '</span><span class="v">' + v + '</span>' + (d ? '<span class="d">' + d + '</span>' : '') + '</div>';
const actBtn = (lab, attrs) => '<button type="button" class="btn sm" ' + attrs + '>' + lab + '</button>';

/* ================= map ================= */
const mapSVG = $('map');
const MLON = [36.2, 52.4], MLAT = [15.2, 31.6], MW = 640, MH = 500;
const mx = lon => (lon - MLON[0]) / (MLON[1] - MLON[0]) * MW;
const my = lat => MH - (lat - MLAT[0]) / (MLAT[1] - MLAT[0]) * MH;
function drawMap() {
  let s = '<path d="M' + SAUDI.map(p => mx(p[0]).toFixed(1) + ',' + my(p[1]).toFixed(1)).join('L') + 'Z" fill="rgba(212,175,55,0.045)" stroke="' + C.line2 + '" stroke-width="1.2"/>';
  for (let lon = 38; lon <= 50; lon += 4) s += '<line x1="' + mx(lon) + '" y1="0" x2="' + mx(lon) + '" y2="' + MH + '" stroke="' + C.line + '" stroke-width="0.5" opacity="0.5"/><text x="' + (mx(lon) + 3) + '" y="14" fill="' + C.muted + '" font-size="10.5" font-family="IBM Plex Mono, monospace">' + lon + '°E</text>';
  for (let lat = 16; lat <= 30; lat += 4) s += '<line x1="0" y1="' + my(lat) + '" x2="' + MW + '" y2="' + my(lat) + '" stroke="' + C.line + '" stroke-width="0.5" opacity="0.5"/><text x="4" y="' + (my(lat) - 4) + '" fill="' + C.muted + '" font-size="10.5" font-family="IBM Plex Mono, monospace">' + lat + '°N</text>';
  for (const e of EDGES) {
    const x1 = mx(STATIONS[e.i].lon), y1 = my(STATIONS[e.i].lat), x2 = mx(STATIONS[e.j].lon), y2 = my(STATIONS[e.j].lat);
    s += '<g class="edge" data-i="' + e.i + '" data-j="' + e.j + '" tabindex="0" role="button" aria-label="Edge ' + STATIONS[e.i].code + ' to ' + STATIONS[e.j].code + ', ' + Math.round(e.d) + ' km, weight ' + e.w.toFixed(2) + '">' +
      '<line class="hit" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>' +
      '<line class="vis" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + C.line2 + '" stroke-width="' + (e.w * 3.2).toFixed(2) + '" opacity="0.8" stroke-linecap="round"/></g>';
  }
  for (let v = 0; v < N; v++) {
    const x = mx(STATIONS[v].lon), y = my(STATIONS[v].lat);
    s += '<g class="stn" data-v="' + v + '" tabindex="0" role="button" aria-label="' + STATIONS[v].name + ' station">' +
      '<circle class="hit" cx="' + x + '" cy="' + y + '" r="16" fill="transparent"/>' +
      '<circle class="halo" cx="' + x + '" cy="' + y + '" r="14" fill="none" stroke="' + C.stmac + '" stroke-width="1.5" opacity="0.9"/>' +
      '<circle class="node" cx="' + x + '" cy="' + y + '" r="7" stroke="#0f1626" stroke-width="1.6"/>' +
      '<text class="code" x="' + (x + 11) + '" y="' + (y + 4) + '" font-size="12.5" font-weight="600" font-family="IBM Plex Mono, monospace">' + STATIONS[v].code + '</text>' +
      '<text x="' + (x + 11) + '" y="' + (y + 16.5) + '" fill="' + C.muted + '" font-size="10">' + STATIONS[v].name + '</text></g>';
  }
  mapSVG.innerHTML = s;
  updateMapSel();
}
function updateMapSel() {
  mapSVG.querySelectorAll('.stn').forEach(g => {
    const v = +g.dataset.v, sel = v === state.sel;
    g.querySelector('.halo').setAttribute('visibility', sel ? 'visible' : 'hidden');
    g.querySelector('.node').setAttribute('fill', sel ? C.stmac : C.solar);
    g.querySelector('.code').setAttribute('fill', sel ? C.ink : C.muted);
    g.setAttribute('aria-pressed', sel ? 'true' : 'false');
  });
  const f = state.focus.map;
  mapSVG.querySelectorAll('.edge').forEach(g => g.classList.toggle('on', !!(f && f.type === 'edge' && +g.dataset.i === f.i && +g.dataset.j === f.j)));
}
function stationTip(v) {
  const s = STATIONS[v], r = state.res;
  let h = '<div class="t">' + stn(v) + '</div>' + tipRow('Location', s.lat.toFixed(2) + '°N ' + s.lon.toFixed(2) + '°E') + tipRow('Solar noon ≈', hm(solarNoonClock(v)) + ' clock') + tipRow('Sheaf shift δ', sg(Core.lonShiftMin(v), 1) + ' min');
  if (r) {
    const st = r.stats, gaps = gapsOf(v);
    let miss = 0; for (const [a, b] of gaps) miss += b - a;
    h += tipRow('Missing', (100 * miss / r.T).toFixed(1) + '% · ' + gaps.length + ' gap' + (gaps.length === 1 ? '' : 's'));
    h += tipRow('STMAC RMSE', f0(st.STL.st[v].rmse) + ' W/m²', C.stmac) + tipRow('Climatology', f0(st.MDV.st[v].rmse) + ' W/m²', C.mdv);
  }
  return h + '<div class="n">Click to inspect this station</div>';
}
function edgeTip(i, j) {
  const e = EDGES.find(x => x.i === i && x.j === j);
  let h = '<div class="t">' + STATIONS[i].code + ' – ' + STATIONS[j].code + ' graph edge</div>' + tipRow('Distance', Math.round(e.d) + ' km') + tipRow('Weight w', e.w.toFixed(3));
  if (DATA) h += tipRow('Departure corr.', f2(DATA.corr.aligned[i][j]));
  return h + '<div class="n">Click to read this edge</div>';
}
function selectStation(v, fromMap) {
  state.sel = v; state.gapIdx = 0; state.pin = null;
  state.focus.map = { type: 'station', v };
  updateMapSel(); updateChartHead(); drawTS(); renderTsInsight(); renderMapInsight(!!fromMap);
  if (state.focus.metric && state.focus.metric.type === 'card') renderMetricInsight();
}
mapSVG.addEventListener('click', e => {
  const g = e.target.closest('.stn,.edge'); if (!g) return;
  if (g.classList.contains('stn')) selectStation(+g.dataset.v, true);
  else { state.focus.map = { type: 'edge', i: +g.dataset.i, j: +g.dataset.j }; updateMapSel(); renderMapInsight(true); }
});
mapSVG.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const g = e.target.closest('.stn,.edge'); if (!g) return; e.preventDefault(); g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
mapSVG.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  const g = e.target.closest('.stn,.edge'); if (!g) { hideTip(); return; }
  showTip(g.classList.contains('stn') ? stationTip(+g.dataset.v) : edgeTip(+g.dataset.i, +g.dataset.j), e.clientX, e.clientY);
});
mapSVG.addEventListener('pointerleave', hideTip);

function renderMapInsight(flash) {
  const f = state.focus.map;
  if (!DATA) { setInsight('mapInsight', { pill: 'Network overview', html: '<p class="ins-hint">Loading the network statistics…</p>' }); return; }
  const reset = () => { state.focus.map = null; updateMapSel(); renderMapInsight(true); };
  const A = DATA.corr.aligned, Cl = DATA.corr.clock, Dly = DATA.corr.daily;
  if (!f) {
    const ds = EDGES.map(e => e.d), ws = EDGES.map(e => e.w);
    let se = 0, ne = 0, sn = 0, nn = 0, sr = 0;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { if (!isNum(A[i][j])) continue; if (W[i][j] > 0) { se += A[i][j]; ne++; sr += DATA.corr.raw[i][j]; } else { sn += A[i][j]; nn++; } }
    const noons = STATIONS.map((s, v) => solarNoonClock(v)), lo = Math.min(...noons), hi = Math.max(...noons);
    const vLo = noons.indexOf(hi), vHi = noons.indexOf(lo);
    let h = '<div class="ins-grid">' + tile('Stations', N) + tile('Graph edges', EDGES.length, 'k = ' + GRAPH_K + ', symmetrised') +
      tile('Edge length', Math.round(Math.min(...ds)) + '–' + Math.round(Math.max(...ds)) + ' km', 'mean ' + Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) + ' km') +
      tile('Weights w', Math.min(...ws).toFixed(2) + '–' + Math.max(...ws).toFixed(2), 'σ = ' + GRAPH_SIGMA + ' km') + '</div>';
    h += '<p>Solar noon falls between <b>' + hm(lo) + '</b> (' + STATIONS[vHi].code + ') and <b>' + hm(hi) + '</b> (' + STATIONS[vLo].code + ') on the local clock, a spread of <b>' + Math.round(hi - lo) + ' min</b>. That offset is what the longitude sheaf removes before neighbours are compared: each station is shifted by δ = (λ − λ̄)/(15°/h), measured from the network-mean longitude λ̄ = ' + LON_MEAN.toFixed(2) + '°E (Section III-B).</p>';
    h += '<p>In the ' + (DATA.kind === 'real' ? '70-day 1999 record' : 'synthetic weather') + ', the 5-minute departures from each station’s own climatology correlate at <b>' + f2(se / ne) + '</b> on average across graph edges and <b>' + f2(sn / nn) + '</b> across non-adjacent pairs (solar-time aligned, ' + EVAL_LAB + ' cells). The raw irradiance of the same edges correlates at <b>' + f2(sr / ne) + '</b>, because every station shares the diurnal cycle; the departures remove that shared cycle. ' +
      (se / ne < 0.15 ? 'Neighbours share little signal beyond the diurnal cycle at this resolution, which limits what the spatial coupling can add over the climatology.' : se / ne < 0.4 ? 'Neighbours share a moderate part of their departures, which is the signal STMAC uses to correct the climatology.' : 'Neighbours share much of their departures, so the spatial coupling has real signal to work with.') + '</p>';
    h += '<p class="ins-hint">Hover a station or an edge for values; click one to read it. Stations and edges are also reachable with <kbd>Tab</kbd>.</p>';
    setInsight('mapInsight', { pill: 'Network overview', html: h, flash });
    return;
  }
  if (f.type === 'station') {
    const v = f.v, s = STATIONS[v], sh = Core.lonShift(v), nbs = neighbours(v), r = state.res;
    let best = -1, bestR = -2; for (let u = 0; u < N; u++) if (u !== v && isNum(A[v][u]) && A[v][u] > bestR) { bestR = A[v][u]; best = u; }
    const kd = DATA.kDaily[v]; let cloudy = 0, clear = 0, km = 0; for (const k of kd) { km += k; if (k <= CLOUDY_K) cloudy++; if (k >= CLEAR_K) clear++; } km /= kd.length;
    let h = '<div class="ins-grid">';
    if (r) {
      const st = r.stats, gaps = gapsOf(v); let miss = 0; for (const [a, b] of gaps) miss += b - a;
      h += tile('STMAC', f0(st.STL.st[v].rmse) + ' W/m²', 'bias ' + sg(st.STL.st[v].bias) , C.stmac) + tile('Climatology', f0(st.MDV.st[v].rmse) + ' W/m²', 'bias ' + sg(st.MDV.st[v].bias), C.mdv) +
        tile('Pure temporal', f0(st.PT.st[v].rmse) + ' W/m²', '', C.pt) + tile('Missing', (100 * miss / r.T).toFixed(1) + '%', gaps.length + ' gap' + (gaps.length === 1 ? '' : 's') + ', ' + st.STL.st[v].n.toLocaleString('en-US') + ' scored');
    }
    h += '</div><p><b>' + stn(v) + '</b> sits at ' + s.lat.toFixed(2) + '°N, ' + s.lon.toFixed(2) + '°E, so its solar noon is near <b>' + hm(solarNoonClock(v)) + '</b> local clock (equation of time ignored). Its local solar time leads the network mean by <b>δ = ' + sg(Core.lonShiftMin(v), 1) + ' min</b>; the longitude sheaf moves its record by that amount, <b>' + Math.abs(sh * 5) + ' min ' + (sh < 0 ? 'earlier' : sh > 0 ? 'later' : '(no shift)') + '</b> here (' + Math.abs(sh) + ' whole sample' + (Math.abs(sh) === 1 ? '' : 's') + '; the reference code shifts by the exact fraction with an FFT).</p>';
    h += '<p>Graph neighbours: ' + nbs.map(n => '<b>' + STATIONS[n.u].code + '</b> (' + Math.round(n.d) + ' km, w = ' + n.w.toFixed(2) + ', r = ' + f2(A[v][n.u]) + ')').join(', ') + '.' + (best >= 0 ? ' Its strongest departure correlation is with <b>' + STATIONS[best].code + '</b> (r = ' + f2(bestR) + '), ' + (W[v][best] > 0 ? 'which is one of its graph neighbours.' : 'which is <b>not</b> one of its graph neighbours: the k-NN graph is built from distance alone.') : '') + ' Here r is the correlation of 5-minute departures from the climatology (solar-time aligned, ' + EVAL_LAB + ' cells).</p>';
    h += '<p>Over the ' + kd.length + ' days, the station received on average <b>' + (100 * km).toFixed(0) + '%</b> of the clear-sky model’s energy in the ' + EVAL_LAB + ' window. <b>' + cloudy + '</b> day' + (cloudy === 1 ? ' is' : 's are') + ' cloudy and <b>' + clear + '</b> clear by the thresholds of the analysis notebooks (daily clear-sky index ≤ 0.70 and ≥ 0.85; computed here with this page’s simple clear-sky model).</p>';
    if (r) {
      const st = r.stats, dl = st.MDV.st[v].rmse - st.STL.st[v].rmse;
      const order = [...Array(N).keys()].sort((a, b) => st.STL.st[a].rmse - st.STL.st[b].rmse), rank = order.indexOf(v) + 1;
      h += '<p>In this scenario STMAC is ' + (dl >= 0 ? '<span class="hl">' + f1(dl) + ' W/m² below</span>' : '<span class="neg">' + f1(-dl) + ' W/m² above</span>') + ' the climatology at this station, and it ranks <b>' + rank + ' of ' + N + '</b> by STMAC error (1 = easiest).' + (Math.abs(st.STL.st[v].bias) > 5 ? ' On average STMAC ' + (st.STL.st[v].bias > 0 ? 'overestimates' : 'underestimates') + ' the missing sunlight here by <b>' + f0(Math.abs(st.STL.st[v].bias)) + ' W/m²</b>.' : '') + '</p>';
    }
    setInsight('mapInsight', { pill: 'Station · ' + s.code, html: h, focused: true, flash, onReset: reset });
    return;
  }
  /* edge */
  const i = f.i, j = f.j, e = EDGES.find(x => x.i === i && x.j === j);
  const dMin = (STATIONS[j].lon - STATIONS[i].lon) * 4, dSh = Core.lonShift(j) - Core.lonShift(i);
  const ra = A[i][j], rc = Cl[i][j], rd = Dly[i][j], n = DATA.corr.n[i][j];
  let h = '<div class="ins-grid">' + tile('Distance', Math.round(e.d) + ' km') + tile('Weight w', e.w.toFixed(3), 'exp(−d²/2σ²)') +
    tile('Solar offset', Math.abs(Math.round(dMin)) + ' min', 'shift ' + Math.abs(dSh * 5) + ' min') + tile('Departure r', f2(ra), 'aligned; clock ' + f2(rc)) + '</div>';
  h += '<p><b>' + stn(i) + '</b> and <b>' + stn(j) + '</b> are ' + Math.round(e.d) + ' km apart, so with σ = ' + GRAPH_SIGMA + ' km the edge weight is <b>' + e.w.toFixed(3) + '</b>' + (e.w > 0.7 ? ', one of the stronger couplings in the network' : e.w < 0.4 ? ', a weak coupling' : '') + '. Their solar noons differ by <b>' + Math.abs(Math.round(dMin)) + ' min</b> (' + (dMin > 0 ? STATIONS[j].code : STATIONS[i].code) + ' is further east); the longitude sheaf shifts them <b>' + Math.abs(dSh * 5) + ' min</b> relative to each other.</p>';
  h += '<p>Over <b>' + n.toLocaleString('en-US') + '</b> shared daytime cells, their 5-minute departures from the climatology correlate at <b>r = ' + f2(ra) + '</b> after solar-time alignment and ' + f2(rc) + ' at equal clock time; ' +
    (ra - rc > 0.01 ? 'alignment raises the agreement.' : ra - rc < -0.01 ? 'alignment lowers it slightly for this pair.' : 'alignment leaves it essentially unchanged.') +
    ' Day to day, their daily clear-sky indices correlate at <b>r = ' + f2(rd) + '</b>. ' +
    (ra < 0.1 ? 'At 5-minute resolution this pair shares little beyond the diurnal cycle, so this edge contributes little to the repair in this window.' : ra < 0.35 ? 'This pair shares a modest part of its departures, which is what the edge passes between them.' : 'This pair shares a large part of its departures, so the edge carries useful signal.') + '</p>';
  h += '<div class="ins-actions">' + actBtn('Show ' + STATIONS[i].code + ' reconstruction', 'data-act="station" data-v="' + i + '"') + actBtn('Show ' + STATIONS[j].code + ' reconstruction', 'data-act="station" data-v="' + j + '"') + '</div>';
  setInsight('mapInsight', { pill: 'Edge · ' + STATIONS[i].code + ' – ' + STATIONS[j].code, html: h, focused: true, flash, onReset: reset });
}

/* ================= reconstruction chart ================= */
let tsGeom = null, tsHover = null;
function drawTS() {
  const cv = $('tsChart'), h = boxH(cv);
  const { ctx, w } = sizeCanvas(cv, h);
  sizeCanvas($('tsOv'), h);
  tsGeom = null;
  if (!DATA || !state.res) { placeholder(ctx, w, h, loadingDs || !DATA ? 'Loading the 1999 record…' : 'Solving…'); return; }
  const r = state.res, T = r.T, v = state.sel;
  const gaps = gapsOf(v);
  if (state.gapIdx >= gaps.length) state.gapIdx = 0;
  const [g0, g1] = gaps.length ? gaps[state.gapIdx] : [T >> 1, (T >> 1) + 288];
  const gl = g1 - g0, padN = Math.max(Math.round(gl * 0.7), SPD >> 1);
  const a = Math.max(0, g0 - padN), b = Math.min(T, g1 + padN);
  const L = 64, R = 12, Tp = 14, B = 32, pw = w - L - R, ph = h - Tp - B;
  let ymax = 100;
  for (let i = a; i < b; i++) ymax = Math.max(ymax, DATA.U[v][i], r.STL[v][i], Math.min(r.PT[v][i], 2000));
  ymax *= 1.09; const ymin = -40;
  const X = i => L + (i - a) / (b - a) * pw;
  const Y = y => Tp + ph - (Math.max(ymin, Math.min(y, ymax)) - ymin) / (ymax - ymin) * ph;
  ctx.font = FONT; ctx.fillStyle = C.muted; ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  for (const t of niceTicks(0, ymax, 5)) {
    ctx.beginPath(); ctx.moveTo(L, Y(t)); ctx.lineTo(w - R, Y(t)); ctx.globalAlpha = .6; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillText(String(Math.round(t)), L - 10, Y(t) + 4);
  }
  ctx.save(); ctx.translate(15, Tp + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('GHI (W/m²)', 0, 0); ctx.restore();
  ctx.textAlign = 'center';
  const dayStep = Math.max(1, Math.round((b - a) / SPD / (w < 560 ? 3 : 6)));
  for (let d = Math.ceil(a / SPD); d * SPD <= b; d += dayStep) {
    const x = X(d * SPD);
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(x, Tp); ctx.lineTo(x, Tp + ph); ctx.globalAlpha = .4; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillText(dateLab(d * SPD), x, h - 10);
  }
  ctx.textAlign = 'left';
  for (let q = 0; q < gaps.length; q++) {
    const [s0, s1] = gaps[q]; if (s1 < a || s0 > b) continue;
    const xa = X(Math.max(s0, a)), xb = X(Math.min(s1, b)), cur = q === state.gapIdx;
    ctx.fillStyle = rgba(C.pt, cur ? 0.11 : 0.06); ctx.fillRect(xa, Tp, xb - xa, ph);
    ctx.strokeStyle = rgba(C.pt, cur ? 0.5 : 0.3); ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(xa, Tp); ctx.lineTo(xa, Tp + ph); ctx.moveTo(xb, Tp); ctx.lineTo(xb, Tp + ph); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const step = Math.max(1, Math.ceil((b - a) / 1600));
  const dim = k => state.emph && state.emph !== k ? 0.22 : 1;
  function line(arr, color, lw, dash, alpha) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = lw; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); let first = true;
    for (let i = a; i < b; i += step) { const x = X(i), y = Y(arr[i]); if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  line(DATA.U[v], C.solar, 1.7, null, state.emph ? 0.8 : 1);
  if (state.showPT) line(r.PT[v], C.pt, state.emph === 'PT' ? 2.2 : 1.4, [6, 4], dim('PT'));
  if (state.showMDV) line(r.MDV[v], C.mdv, state.emph === 'MDV' ? 2.2 : 1.4, [4, 3], dim('MDV'));
  if (state.showTriv) line(r.STT[v], C.triv, state.emph === 'STT' ? 2 : 1.2, [2, 3], dim('STT'));
  if (state.showS0) line(r.S0[v], C.s0, state.emph === 'S0' ? 2.2 : 1.4, [8, 3, 2, 3], dim('S0'));
  if (state.showGT) line(r.GT[v], C.gt, state.emph === 'GT' ? 2.2 : 1.5, [10, 3], dim('GT'));
  line(r.STL[v], rgba(C.stmac, 0.16), 6.5, null, dim('STL'));
  line(r.STL[v], C.stmac, 2.1, null, dim('STL'));
  $('gapLbl').textContent = 'gap ' + (gaps.length ? state.gapIdx + 1 : 0) + '/' + gaps.length;
  tsGeom = { a, b, L, R, Tp, ph, pw, w, h, X, Y, v, g0, g1 };
  drawTSOverlay();
}
function tsIdx(x) {
  const g = tsGeom; if (!g || x < g.L - 4 || x > g.w - g.R + 4) return null;
  return Math.max(g.a, Math.min(g.b - 1, Math.round(g.a + (x - g.L) / g.pw * (g.b - g.a))));
}
function tsSeries() {
  const s = [{ k: 'U', lab: 'Measured', c: C.solar }, { k: 'STL', lab: 'STMAC', c: C.stmac }];
  if (state.showMDV) s.push({ k: 'MDV', lab: 'Climatology', c: C.mdv });
  if (state.showPT) s.push({ k: 'PT', lab: 'Pure temporal', c: C.pt });
  if (state.showTriv) s.push({ k: 'STT', lab: 'STMAC trivial', c: C.triv });
  if (state.showS0) s.push({ k: 'S0', lab: 'S0 (no prior)', c: C.s0 });
  if (state.showGT) s.push({ k: 'GT', lab: 'GraphTRSS+MDV', c: C.gt });
  return s;
}
const valAt = (k, v, i) => k === 'U' ? DATA.U[v][i] : state.res[k][v][i];
function drawTSOverlay() {
  const ov = $('tsOv'); const { ctx } = sizeCanvas(ov, boxH(ov));
  const g = tsGeom; if (!g) return;
  const mark = (i, pinned) => {
    if (i == null || i < g.a || i >= g.b) return;
    const x = g.X(i);
    ctx.strokeStyle = pinned ? C.goldHi : rgba(C.ink, 0.45); ctx.lineWidth = 1; ctx.setLineDash(pinned ? [] : [3, 3]);
    ctx.beginPath(); ctx.moveTo(x, g.Tp); ctx.lineTo(x, g.Tp + g.ph); ctx.stroke(); ctx.setLineDash([]);
    for (const s of tsSeries()) { ctx.fillStyle = s.c; ctx.strokeStyle = '#0a0d14'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, g.Y(valAt(s.k, g.v, i)), pinned ? 4.5 : 3.5, 0, 6.2832); ctx.fill(); ctx.stroke(); }
    if (pinned) { ctx.fillStyle = C.goldHi; ctx.font = FONT; ctx.textAlign = x > g.w - 90 ? 'right' : 'left'; ctx.fillText(hm(clockMin(i)), x + (x > g.w - 90 ? -6 : 6), g.Tp + 12); ctx.textAlign = 'left'; }
  };
  if (state.pin && state.pin.v === g.v) mark(state.pin.i, true);
  if (tsHover != null && !(state.pin && state.pin.i === tsHover)) mark(tsHover, false);
}
function gapIndexAt(v, i) { const gs = gapsOf(v); for (let q = 0; q < gs.length; q++) if (i >= gs[q][0] && i < gs[q][1]) return q; return -1; }
function tsTip(i) {
  const v = tsGeom.v, q = gapIndexAt(v, i), day = scored(i);
  let h = '<div class="t">' + whenLab(i) + ' clock · solar ≈ ' + hm(solarMin(v, i)) + '</div>';
  const u = DATA.U[v][i];
  for (const s of tsSeries()) {
    const val = valAt(s.k, v, i);
    h += tipRow(s.lab, f0(val) + (s.k !== 'U' && q >= 0 ? ' <span style="color:var(--muted)">(' + sg(val - u) + ')</span>' : ''), s.c);
  }
  h += '<div class="n">' + (q >= 0 ? 'Inside gap ' + (q + 1) + ' (' + fmtDur(gapsOf(v)[q][1] - gapsOf(v)[q][0]) + '); brackets = estimate − measured' : 'Observed cell, not scored') + (day ? '' : ' · outside ' + EVAL_LAB + ', not scored') + '</div>';
  return h;
}
(function wireTS() {
  const ov = $('tsOv');
  let raf = 0;
  const sched = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawTSOverlay(); }); };
  ov.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || !tsGeom) return;
    const rc = ov.getBoundingClientRect(), i = tsIdx(e.clientX - rc.left);
    tsHover = i; sched();
    if (i == null) hideTip(); else showTip(tsTip(i), e.clientX, e.clientY);
  });
  ov.addEventListener('pointerleave', () => { tsHover = null; hideTip(); sched(); });
  ov.addEventListener('click', e => {
    if (!tsGeom) return;
    const rc = ov.getBoundingClientRect(), i = tsIdx(e.clientX - rc.left); if (i == null) return;
    state.pin = { v: tsGeom.v, i }; drawTSOverlay(); renderTsInsight(true);
  });
  ov.addEventListener('keydown', e => {
    if (!tsGeom) return;
    const g = tsGeom, gaps = gapsOf(g.v);
    let i = state.pin && state.pin.v === g.v ? state.pin.i : g.g0, handled = true;
    switch (e.key) {
      case 'ArrowLeft': i -= e.shiftKey ? 12 : 1; break;
      case 'ArrowRight': i += e.shiftKey ? 12 : 1; break;
      case 'Home': i = g.g0; break;
      case 'End': i = g.g1 - 1; break;
      case 'PageDown': case ']': if (gaps.length) { state.gapIdx = (state.gapIdx + 1) % gaps.length; state.pin = null; drawTS(); renderTsInsight(true); } e.preventDefault(); return;
      case 'PageUp': case '[': if (gaps.length) { state.gapIdx = (state.gapIdx - 1 + gaps.length) % gaps.length; state.pin = null; drawTS(); renderTsInsight(true); } e.preventDefault(); return;
      case 'Escape': state.pin = null; drawTSOverlay(); renderTsInsight(true); e.preventDefault(); return;
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    state.pin = { v: g.v, i: Math.max(g.a, Math.min(g.b - 1, i)) }; drawTSOverlay(); renderTsInsight(true);
  });
})();
function renderTsInsight(flash) {
  if (!state.res || !DATA) { setInsight('tsInsight', { pill: 'Gap overview', html: '<p class="ins-hint">Solving the first scenario…</p>' }); return; }
  const r = state.res, v = state.sel, gaps = gapsOf(v), T = r.T;
  const hint = '<p class="ins-hint">Hover the chart for values, click to pin a time. With the chart focused: <kbd>←</kbd><kbd>→</kbd> 5 min, <kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd> 1 h, <kbd>PgUp</kbd><kbd>PgDn</kbd> gap, <kbd>Esc</kbd> clear.</p>';
  const statTiles = (gs, withBias) => '<div class="ins-grid">' + MKEYS.filter(shown).map(k => tile(METHODS[k].short, f0(gs.rmse[k]) + ' W/m²', withBias ? 'bias ' + sg(gs.bias[k]) : '', METHODS[k].color())).join('') + '</div>';
  if (state.pin && state.pin.v === v) {
    const i = state.pin.i, q = gapIndexAt(v, i), u = DATA.U[v][i], cs = DATA.CS[v][i], k = dayIndexK(v, i);
    let h = '<div class="ins-grid">' + tile('Measured', f0(u) + ' W/m²', 'clear-sky ' + f0(cs), C.solar);
    for (const m of MKEYS) { if (!shown(m)) continue;
      const e = r[m][v][i] - u; h += tile(METHODS[m].short, f0(r[m][v][i]), q >= 0 ? 'error ' + sg(e) : '', METHODS[m].color()); }
    h += '</div><p><b>' + whenLab(i) + '</b> local clock at <b>' + stn(v) + '</b> (solar time ≈ ' + hm(solarMin(v, i)) + '). ';
    if (!scored(i)) h += 'This time is outside the scoring window (' + EVAL_LAB + ' local time, the notebooks’ DAYTIME mask), so it enters no RMSE on the page.';
    h += '</p>';
    if (q >= 0) {
      const [s0, s1] = gaps[q], errs = MKEYS.filter(shown).map(m => [m, Math.abs(r[m][v][i] - u)]).sort((x, y) => x[1] - y[1]);
      h += '<p>This cell is <b>' + fmtDur(i - s0) + '</b> into gap ' + (q + 1) + ' of ' + gaps.length + ' (length ' + fmtDur(s1 - s0) + '). ' + (scored(i) ? 'The closest estimate at this instant is <b>' + METHODS[errs[0][0]].short + '</b>, off by ' + f0(errs[0][1]) + ' W/m²; the furthest is ' + METHODS[errs[errs.length - 1][0]].short + ' at ' + f0(errs[errs.length - 1][1]) + ' W/m².' : '') + '</p>';
      /* what the solver saw: neighbours at the solar-aligned time */
      const dv = Core.lonShift(v), clim = r.MDV[v][i];
      const parts = neighbours(v).map(n => {
        const j = ((i + dv - Core.lonShift(n.u)) % T + T) % T, obs = r.M[n.u][j] > 0;
        return '<b>' + STATIONS[n.u].code + '</b> ' + (obs ? 'measured ' + f0(DATA.U[n.u][j]) : 'was missing too') + ' (w = ' + n.w.toFixed(2) + (j !== i ? ', at ' + hm(clockMin(j)) : '') + ')';
      });
      h += '<p>STMAC’s departure from the climatology here is <b>' + sg(r.STL[v][i] - clim) + ' W/m²</b>. At the solar-aligned time, its graph neighbours: ' + parts.join('; ') + '.</p>';
    } else {
      const pd = r.PT[v][i] - u;
      h += '<p>The sensor reported this value. STMAC and the climatology keep observed cells as measured, while pure temporal smooths them (by ' + sg(pd, 1) + ' W/m² here). Errors are scored only inside the shaded gaps.</p>';
      let nq = -1, nd = Infinity; gaps.forEach((gp, qq) => { const d = gp[0] > i ? gp[0] - i : i - gp[1]; if (d < nd) { nd = d; nq = qq; } });
      if (nq >= 0 && nq !== state.gapIdx) h += '<div class="ins-actions">' + actBtn('Centre on the nearest gap (gap ' + (nq + 1) + ')', 'data-act="gap" data-g="' + nq + '"') + '</div>';
    }
    if (isNum(k)) h += '<p>On ' + dateLab(i) + ' this station received <b>' + (100 * k).toFixed(0) + '%</b> of the clear-sky model’s daily energy (index ' + k.toFixed(2) + ', ' + skyPhrase(k) + ').</p>';
    if (q >= 0 && q !== state.gapIdx) h += '<div class="ins-actions">' + actBtn('Centre the chart on gap ' + (q + 1), 'data-act="gap" data-g="' + q + '"') + '</div>';
    setInsight('tsInsight', { pill: 'Point · ' + whenLab(i), html: h + hint, focused: true, flash, onReset: () => { state.pin = null; drawTSOverlay(); renderTsInsight(true); } });
    return;
  }
  if (!gaps.length) { setInsight('tsInsight', { pill: 'Gap overview', html: '<p>No gaps at this station in this draw.</p>' + hint }); return; }
  const [s0, s1] = gaps[state.gapIdx], gs = gapStats(v, s0, s1);
  let h = statTiles(gs, true);
  h += '<p><b>Gap ' + (state.gapIdx + 1) + ' of ' + gaps.length + '</b> at <b>' + stn(v) + '</b> starts ' + whenLab(s0) + ' and lasts <b>' + fmtDur(s1 - s0) + '</b> (' + gs.n.toLocaleString('en-US') + ' cells, ' + gs.nDay.toLocaleString('en-US') + ' in the ' + EVAL_LAB + ' scoring window).';
  if (!gs.nDay) { h += ' None of its cells falls in the scoring window, so no method is scored on it.</p>'; }
  else {
    const rk = MKEYS.filter(shown).sort((x, y) => gs.rmse[x] - gs.rmse[y]);
    const dcl = gs.rmse.MDV - gs.rmse.STL;
    h += ' Lowest error on this gap: <b>' + METHODS[rk[0]].short + '</b> (' + f0(gs.rmse[rk[0]]) + ' W/m²). STMAC is ' + (dcl >= 0 ? '<span class="hl">' + f1(dcl) + ' W/m² below</span>' : '<span class="neg">' + f1(-dcl) + ' W/m² above</span>') + ' the climatology here' +
      (Math.abs(gs.bias.STL) > 10 ? ' and ' + (gs.bias.STL > 0 ? 'overestimates' : 'underestimates') + ' the missing sunlight by ' + f0(Math.abs(gs.bias.STL)) + ' W/m² on average' : '') + '.</p>';
    if (isNum(gs.k)) h += '<p>During the gap’s scored hours the sensor measured <b>' + (100 * gs.k).toFixed(0) + '%</b> of the clear-sky model’s energy (clear-sky index ' + gs.k.toFixed(2) + '; the notebooks call a day cloudy at ≤ 0.70 and clear at ≥ 0.85).' + (gs.k <= CLOUDY_K ? ' Cloudy stretches are where a fixed diurnal prior misses most and neighbours can help; the paper finds STMAC below the climatology on cloudy cells at all seven block lengths, by 9.1 to 180.1 W/m² (Section VI-D).' : '') + '</p>';
    const all = allGapStats(v).map((x, q) => [q, x]).filter(x => x[1].nDay > 0);
    if (all.length > 1) {
      const byErr = all.slice().sort((x, y) => y[1].rmse.STL - x[1].rmse.STL), rank = byErr.findIndex(x => x[0] === state.gapIdx) + 1;
      h += '<p>Among this station’s ' + all.length + ' gaps with scored cells, this one ranks <b>' + rank + '</b> by STMAC error (1 = hardest).</p><div class="ins-actions">' +
        (byErr[0][0] !== state.gapIdx ? actBtn('Hardest gap (' + f0(byErr[0][1].rmse.STL) + ' W/m²)', 'data-act="gap" data-g="' + byErr[0][0] + '"') : '') +
        (byErr[byErr.length - 1][0] !== state.gapIdx ? actBtn('Easiest gap (' + f0(byErr[byErr.length - 1][1].rmse.STL) + ' W/m²)', 'data-act="gap" data-g="' + byErr[byErr.length - 1][0] + '"') : '') + '</div>';
    }
  }
  setInsight('tsInsight', { pill: 'Gap ' + (state.gapIdx + 1) + ' · ' + STATIONS[v].code, html: h + hint, flash });
}
function updateChartHead() {
  const s = STATIONS[state.sel];
  $('chartTitle').textContent = 'Reconstruction — ' + s.code + ' · ' + s.name + ' (' + s.lat.toFixed(2) + '°N, ' + s.lon.toFixed(2) + '°E)';
}

/* ================= legend ================= */
const SERIES = [
  { id: 'truth', lab: () => state.dataset === 'real' ? 'Ground truth (real 1999 record)' : 'Ground truth (synthetic weather)', color: () => C.solar, always: true },
  { id: 'PT', lab: 'Pure temporal — collapses on long gaps', color: () => C.pt, key: 'showPT' },
  { id: 'MDV', lab: 'Station climatology (MDV) — the baseline to beat', color: () => C.mdv, key: 'showMDV' },
  { id: 'STL', lab: 'STMAC · longitude sheaf', color: () => C.stmac, always: true },
  { id: 'STT', lab: 'STMAC · trivial sheaf', color: () => C.triv, key: 'showTriv' },
  { id: 'S0', lab: 'STMAC without prior (S0) — the ablation of Table I', color: () => C.s0, key: 'showS0' },
  { id: 'GT', lab: 'GraphTRSS + MDV — strongest graph baseline of Table II', color: () => C.gt, key: 'showGT' }];
function drawLegend() {
  const el = $('tsLegend'); el.innerHTML = '';
  for (const s of SERIES) {
    const btn = document.createElement('button'); btn.type = 'button';
    btn.className = 'sl' + ((s.key && !state[s.key]) ? ' off' : '');
    btn.innerHTML = '<span class="sw" style="background:' + s.color() + '"></span>' + (typeof s.lab === 'function' ? s.lab() : s.lab);
    if (s.key) { btn.title = 'Click to toggle'; btn.setAttribute('aria-pressed', state[s.key] ? 'true' : 'false');
      btn.addEventListener('click', () => { state[s.key] = !state[s.key]; if (!state[s.key] && state.emph === s.id) state.emph = null; drawLegend(); drawTS(); renderTsInsight(); }); }
    else btn.style.cursor = 'default';
    el.appendChild(btn);
  }
  scheduleStamp();
}

/* ================= metrics: overview, cards, Table I rows ================= */
function overviewMetricText() {
  const r = state.res, p = r.params, bl = BLOCKS[p.blockIdx];
  const hours = bl.s * 5 / 60, cycles = hours / 24;
  const dPT = r.rPT - r.rSTL, dCL = r.rMDV - r.rSTL, gain = r.rSTT - r.rSTL;
  let s;
  if (hours < 6) {
    s = 'At <b>' + bl.lab + '</b> blocks the gap is far shorter than one diurnal cycle, so a station’s own recent history is highly informative. Pure temporal reaches <b>' + Math.round(r.rPT) + ' W/m²</b> against <b>' + Math.round(r.rSTL) + '</b> for STMAC' +
      (dPT < 0 ? ', and wins this scenario — the paper reports the same for gaps up to 2 hours.' : '.');
  } else if (hours < 24) {
    s = 'A <b>' + bl.lab + '</b> block removes a large share of a diurnal cycle. Temporal smoothing flattens into a straight bridge across the gap (<b>' + Math.round(r.rPT) + ' W/m²</b>), while STMAC reaches <b>' + Math.round(r.rSTL) + '</b> by correcting the diurnal climatology with what the neighbouring stations saw.';
  } else {
    s = 'A <b>' + bl.lab + '</b> outage swallows <b>' + Math.round(cycles) + '</b> full diurnal cycle' + (cycles >= 2 ? 's' : '') + '. No smoothness prior can invent ' + Math.round(cycles) + ' missing sunrise–noon–sunset arcs, so pure temporal reaches <b>' + Math.round(r.rPT) + ' W/m²</b>; STMAC rebuilds them at <b>' + Math.round(r.rSTL) + '</b>.';
  }
  s += ' The station climatology alone scores <b>' + Math.round(r.rMDV) + ' W/m²</b> here';
  if (dCL > 3) s += ', so the spatial coupling is worth <span class="hl">' + dCL.toFixed(1) + ' W/m²</span> on top of it.';
  else if (dCL >= 0) s += ' — on a gap this long the diurnal prior does nearly all of the work, and the spatial correction adds only <b>' + dCL.toFixed(1) + ' W/m²</b>.';
  else s += ' and edges STMAC by <b>' + Math.abs(dCL).toFixed(1) + ' W/m²</b> in this draw; across the 20 mask realisations of the paper STMAC stays below it at every block length.';
  if (gain > 0.3) s += ' Aligning stations to solar time before coupling is worth <b>' + gain.toFixed(1) + ' W/m²</b> against the trivial sheaf here.';
  else s += ' Trivial and longitude sheaves land within <b>' + Math.abs(gain).toFixed(2) + ' W/m²</b> of each other in this draw; the paper finds the alignment significant only for gaps up to 6 hours.';
  const dS0 = r.rS0 - r.rSTL;
  s += ' Without its prior (S0: C = 0, g = 0, r = 10) the joint solver reaches <b>' + Math.round(r.rS0) + ' W/m²</b>' + (dS0 >= 0 ? ', so the climatological prior accounts for <b>' + dS0.toFixed(1) + ' W/m²</b> of STMAC’s accuracy here; the paper reports 25 to 43 W/m² over the full year.' : ' and edges STMAC by <b>' + (-dS0).toFixed(1) + ' W/m²</b> in this draw.');
  const dGT = r.rGT - r.rSTL, gtRow = TABLE2.find(x => x.k === p.blockIdx);
  s += ' GraphTRSS + MDV, the strongest of the recent graph methods in Table II (a Sobolev penalty on first temporal differences, applied to the same climatological anomalies), reaches <b>' + Math.round(r.rGT) + ' W/m²</b>, ' +
    (dGT < -0.05 ? '<span class="neg">' + f1(-dGT) + ' W/m² below</span> STMAC' : dGT > 0.05 ? '<span class="hl">' + f1(dGT) + ' W/m² above</span> STMAC' : 'level with STMAC') + ' in this draw; on the ten shared masks of the paper it is ' + GT_VERDICT[p.blockIdx] + ' at ' + gtRow.lab + ' (' + f1(gtRow.gtm) + ' against ' + f1(gtRow.s) + ').';
  if (p.r !== R_RATIO || p.g !== RIDGE) s += ' <b>Note:</b> the weights are set to r = ' + p.r + ', g = ' + p.g + ', not the paper’s cross-validated pair (r = 1000, g = 3); the STMAC readings above describe your setting, not the published one (GraphTRSS + MDV keeps its own cross-validated weights, ν = ' + GT_NU + ', ε = ' + GT_EPS + ').';
  const rank = [['Pure temporal', r.rPT], ['Station climatology', r.rMDV], ['STMAC (trivial sheaf)', r.rSTT], ['STMAC (longitude sheaf)', r.rSTL], ['STMAC without prior (S0)', r.rS0], ['GraphTRSS + MDV', r.rGT]].sort((a, b) => a[1] - b[1]);
  s += '<br><b>Ranking for this scenario</b> (lower error is better): ' + rank.map((x, i) => (i + 1) + '. ' + x[0] + ' ' + Math.round(x[1]) + ' W/m²').join(' · ') + '.';
  s += ' In plain words: an error of ' + Math.round(r.rSTL) + ' W/m² means the repaired curve is typically off by about ' + Math.round(r.rSTL) + ' W per square metre of sensor during the scored hours (' + EVAL_LAB + '), against a midday maximum near 900–1000 in this winter window.';
  return '<p>' + s + '</p><p class="ins-hint">Click a card for its per-station breakdown, or a row of Table I or Table II to compare it with the live run.</p>';
}
function reconRange(key) {
  const r = state.res; let lo = Infinity, hi = -Infinity, neg = 0, negDay = 0; const byHour = new Array(24).fill(0);
  for (let v = 0; v < N; v++) { const M = r.M[v], X = r[key][v]; for (let i = 0; i < r.T; i++) if (!M[i]) { const x = X[i]; if (x < lo) lo = x; if (x > hi) hi = x;
    if (x < -1) { neg++; if (scored(i)) negDay++; byHour[Math.floor(clockMin(i) / 60)]++; } } }
  return { lo, hi, neg, negDay, hour: byHour.indexOf(Math.max(...byHour)) };
}
function renderMetricInsight(flash) {
  document.querySelectorAll('.card').forEach(c => c.setAttribute('aria-pressed', state.focus.metric && state.focus.metric.type === 'card' && state.focus.metric.m === c.dataset.m ? 'true' : 'false'));
  document.querySelectorAll('#refTable tr[data-k]').forEach(tr => tr.classList.toggle('sel', !!(state.focus.metric && state.focus.metric.type === 'row' && state.focus.metric.k === +tr.dataset.k)));
  document.querySelectorAll('#refTable2 tr[data-k]').forEach(tr => tr.classList.toggle('sel', !!(state.focus.metric && state.focus.metric.type === 'row2' && state.focus.metric.k === +tr.dataset.k)));
  if (!state.res) { setInsight('metricInsight', { pill: 'This scenario', html: '<p class="ins-hint">Solving the first scenario…</p>' }); return; }
  const f = state.focus.metric, r = state.res;
  const reset = () => { state.focus.metric = null; state.emph = null; drawTS(); renderMetricInsight(true); };
  if (!f) { setInsight('metricInsight', { pill: 'This scenario · ' + BLOCKS[r.params.blockIdx].lab, html: overviewMetricText(), flash }); return; }
  if (f.type === 'card') {
    const m = METHODS[f.m], st = r.stats[f.m], ref = f.m === 'STL' ? 'MDV' : 'STL', refSt = r.stats[ref];
    const vals = st.st.map((x, v) => ({ v, x: x.rmse, ref: refSt.st[v].rmse })).sort((a, b) => a.x - b.x);
    const max = Math.max(...vals.map(o => Math.max(o.x, o.ref))) * 1.05;
    let h = '<div class="ins-grid">' + tile('RMSE', f1(r[m.r]) + ' W/m²', '', m.color()) + tile('MAE', f1(st.mae) + ' W/m²') + tile('Mean bias', sg(st.bias, 1) + ' W/m²', st.bias > 0 ? 'overestimates' : 'underestimates') + tile('Cells scored', st.n.toLocaleString('en-US'), 'removed, ' + EVAL_LAB) + '</div>';
    h += '<div class="ins-bars" role="list">' + vals.map(o => '<button type="button" class="ins-bar' + (o.v === state.sel ? ' cur' : '') + '" data-act="station" data-v="' + o.v + '" role="listitem" title="Show ' + STATIONS[o.v].name + '"><span>' + STATIONS[o.v].code + ' · ' + STATIONS[o.v].name + '</span><span class="tr"><span class="fl" style="width:' + (100 * o.x / max).toFixed(1) + '%;background:' + m.color() + '"></span><span class="mk" style="left:' + (100 * o.ref / max).toFixed(1) + '%;background:' + METHODS[ref].color() + ';box-shadow:0 0 6px ' + METHODS[ref].color() + '"></span></span><span class="nv">' + f0(o.x) + '</span></button>').join('') + '</div>';
    h += '<p class="ins-note">Bars: ' + m.short + ' RMSE per station (W/m²). Tick: ' + METHODS[ref].short + ' at the same station. Click a row to open that station.</p>';
    const beat = vals.filter(o => f.m === 'STL' ? o.x < o.ref : o.ref < o.x).length;
    const best = vals[0], worst = vals[vals.length - 1];
    h += '<p>Across the 11 stations, ' + m.short + ' ranges from <b>' + f0(best.x) + '</b> (' + STATIONS[best.v].code + ') to <b>' + f0(worst.x) + ' W/m²</b> (' + STATIONS[worst.v].code + '). ';
    if (f.m === 'STL') {
      const d = vals.map(o => [o.v, o.ref - o.x]).sort((a, b) => b[1] - a[1]);
      h += 'STMAC is below the climatology at <b>' + beat + ' of 11</b> stations; the largest gain is at ' + STATIONS[d[0][0]].code + ' (' + f1(d[0][1]) + ' W/m²)' + (d[d.length - 1][1] < 0 ? ' and the largest loss at ' + STATIONS[d[d.length - 1][0]].code + ' (' + f1(-d[d.length - 1][1]) + ' W/m²).' : '.');
    } else h += 'STMAC is below it at <b>' + beat + ' of 11</b> stations.';
    if (f.m === 'GT') h += ' GraphTRSS + MDV fits the observed cells instead of keeping them exactly (every cell is an unknown, ' + (r.gtN || 0).toLocaleString('en-US') + ' in all, half-bandwidth ' + r.gtBw + '), uses the identity restriction map, and penalises the graph smoothness of first temporal differences with (L + εI), ν = ' + GT_NU + ', ε = ' + GT_EPS + ', β = 1, the weights the paper’s block cross-validation selected.';
    const ratio = r[m.r] / st.mae;
    h += ' RMSE is <b>' + ratio.toFixed(2) + '×</b> the MAE; for normally distributed errors the ratio is about 1.25, so ' + (ratio > 1.4 ? 'a minority of large misses weighs heavily here.' : 'the misses are spread fairly evenly.') + '</p>';
    const rg = reconRange(f.m), outside = rg.hi > PHYS_MAX || rg.lo < -50;
    h += '<p>Inside the gaps its estimates run from <b>' + f0(rg.lo) + '</b> to <b>' + f0(rg.hi) + ' W/m²</b>' + (outside ? ', beyond the physical range of sunlight (0 to about ' + PHYS_MAX.toLocaleString('en-US') + ' W/m²).' : ', inside the physical range.') +
      (rg.neg ? ' <b>' + rg.neg.toLocaleString('en-US') + '</b> removed cell' + (rg.neg === 1 ? ' comes' : 's come') + ' out below zero (' + rg.negDay.toLocaleString('en-US') + ' in the scored hours), most often around ' + pad2(rg.hour) + ':00.' : '') +
      (f.m === 'PT' && outside ? ' Smoothing a station’s own history has nothing to anchor it on gaps this long.' : f.m === 'GT' && rg.neg ? ' GraphTRSS + MDV smooths the departure from the climatology in time, so a departure seen in the daylight hours carries on into the evening, where the climatology falls to zero.' : '') + ' No method on this page clips its output.</p>';
    setInsight('metricInsight', { pill: 'Method · ' + m.lab, html: h, focused: true, flash, onReset: reset });
    return;
  }
  if (f.type === 'row2') { renderTable2Row(f, r, reset, flash); return; }
  /* Table I row */
  const row = TABLE1.find(x => x.k === f.k), p = r.params;
  const fy = [['Pure temporal', row.pt], ['Climatology', row.mdv], ['Transformer', row.tf], ['S0 (no prior)', row.s0], ['STMAC', row.stmac]].sort((a, b) => a[1] - b[1]);
  let h = '<div class="ins-grid">' + tile('Paper STMAC', f1(row.stmac), 'held-out ' + f1(row.hoS), C.stmac) + tile('Paper climatology', f1(row.mdv), 'held-out ' + f1(row.hoMdv), C.mdv) +
    tile('Paper Transformer', f1(row.tf), 'held-out ' + f1(row.hoTf), C.tf) + tile('Paper S0', f1(row.s0), 'no prior', C.s0) + tile('Paper pure temp.', f0(row.pt), 'full year', C.pt) + '</div>';
  h += '<p>Over the full year (20 masks) at <b>' + row.lab + '</b> blocks the lowest error is <b>' + fy[0][0] + '</b> (' + (fy[0][1] >= 100 ? f1(fy[0][1]) : f0(fy[0][1])) + ' W/m²). STMAC sits ' + f1(row.mdv - row.stmac) + ' W/m² below the climatology and ' + f1(row.tf - row.stmac) + ' below the trained Transformer; without its prior (S0) it reaches ' + f1(row.s0) + ', so the prior is worth ' + f1(row.s0 - row.stmac) + ' W/m² at this length. On the held-out 7 Nov to 31 Dec period (30 masks) STMAC reaches ' + f1(row.hoS) + ', ' + f1(row.hoMdv - row.hoS) + ' below the climatology and ' + f1(row.hoTf - row.hoS) + ' below the Transformer.</p>';
  let live = null, src = '';
  const sw = state.sweep;
  if (p.blockIdx === row.k) { live = { pt: r.rPT, mdv: r.rMDV, sl: r.rSTL, s0: r.rS0 }; src = 'the scenario on screen'; }
  else if (sw && sw.rows[row.k] && !sweepStale()) { const q = sw.rows[row.k]; live = { pt: q.pt, mdv: q.mdv, sl: q.sl, s0: q.s0 }; src = 'the live sweep'; }
  if (live) {
    const lr = [['Pure temporal', live.pt], ['Climatology', live.mdv], ['S0 (no prior)', live.s0], ['STMAC', live.sl]].sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const pr = fy.filter(x => x[0] !== 'Transformer').map(x => x[0]);
    h += '<p>From ' + src + ' (' + (DATA.kind === 'real' ? '70-day winter window' : 'synthetic weather') + ', one mask): STMAC <b>' + f1(live.sl) + '</b>, climatology <b>' + f1(live.mdv) + '</b>, S0 <b>' + f1(live.s0) + '</b>, pure temporal <b>' + f0(live.pt) + '</b> W/m². ' +
      (DATA.kind === 'real' ? 'The live window (22 Oct to 30 Dec) overlaps the held-out period, so the held-out column is the closer reference: live STMAC is <b>' + (live.sl / row.hoS).toFixed(2) + '×</b> the held-out figure and ' + (live.sl / row.stmac).toFixed(2) + '× the full-year one. ' : '') +
      'The order of the four methods run live ' + (lr.join() === pr.join() ? '<span class="hl">matches</span> the full-year column (' + lr.join(' < ') + ').' : '<span class="neg">differs</span> from the full-year column: live ' + lr.join(' < ') + ', paper ' + pr.join(' < ') + '.') + '</p>';
  } else h += '<div class="ins-actions">' + actBtn('Run ' + row.lab + ' live', 'data-act="block" data-k="' + row.k + '"') + '</div>';
  setInsight('metricInsight', { pill: 'Table I · ' + row.lab, html: h, focused: true, flash, onReset: reset });
}
function renderTable2Row(f, r, reset, flash) {
  const row = TABLE2.find(x => x.k === f.k), p = r.params;
  const all = [['MDV', row.mdv], ['TVGSR', row.tv], ['GraphTRSS', row.gt], ['RTVGSR', row.rt], ['TVGSR + MDV', row.tvm], ['GraphTRSS + MDV', row.gtm], ['STMAC', row.s]].sort((a, b) => a[1] - b[1]);
  const rawBest = Math.min(row.tv, row.gt, row.rt);
  let h = '<div class="ins-grid">' + tile('Paper STMAC', f1(row.s), 'ten shared masks', C.stmac) + tile('Paper GraphTRSS+MDV', f1(row.gtm), sg(row.gtm - row.s, 1) + ' vs STMAC', C.gt) +
    tile('Paper TVGSR+MDV', f1(row.tvm), sg(row.tvm - row.s, 1) + ' vs STMAC', C.tvm) + tile('Best raw graph', f1(rawBest), sg(rawBest - row.s, 1) + ' vs STMAC') + tile('Paper climatology', f1(row.mdv), '', C.mdv) + '</div>';
  h += '<p>On the ten shared masks at <b>' + row.lab + '</b> blocks the order is ' + all.map(x => x[0] + ' ' + f1(x[1])).join(' < ') + ' W/m². ';
  h += row.k <= 2 ? 'The three graph methods on raw irradiance (identity restriction maps, no prior) are all below STMAC at this length; the paper reports them 11 to 45 W/m² below up to 6 hours. '
    : 'The three graph methods on raw irradiance are above STMAC at this length; the paper reports them 12 to 41 W/m² above from 12 hours on (Holm-corrected p = 0.014 at every length). ';
  h += 'Applied to the same climatological anomalies, GraphTRSS + MDV is ' + GT_VERDICT[row.k] + ' here.</p>';
  let live = null, src = '';
  const sw = state.sweep;
  if (p.blockIdx === row.k) { live = { mdv: r.rMDV, sl: r.rSTL, gt: r.rGT }; src = 'the scenario on screen'; }
  else if (sw && sw.rows[row.k] && !sweepStale()) { const q = sw.rows[row.k]; live = { mdv: q.mdv, sl: q.sl, gt: q.gt }; src = 'the live sweep'; }
  if (live) {
    const d = live.gt - live.sl, pd = row.gtm - row.s;
    h += '<p>From ' + src + ' (' + (DATA.kind === 'real' ? '70-day winter window' : 'synthetic weather') + ', one mask): GraphTRSS + MDV <b>' + f1(live.gt) + '</b>, STMAC <b>' + f1(live.sl) + '</b>, climatology <b>' + f1(live.mdv) + '</b> W/m². GraphTRSS + MDV is ' +
      (d < 0 ? '<span class="neg">' + f1(-d) + ' W/m² below</span>' : '<span class="hl">' + f1(d) + ' W/m² above</span>') + ' STMAC, against ' + sg(pd, 1) + ' W/m² in the paper; the sign ' + ((d < 0) === (pd < 0) ? '<span class="hl">agrees</span>.' : '<span class="neg">differs</span> in this draw (single masks on a 70-day window can fall either way where the paper finds the two close).') + '</p>';
  } else h += '<div class="ins-actions">' + actBtn('Run ' + row.lab + ' live', 'data-act="block" data-k="' + row.k + '"') + '</div>';
  h += '<p class="ins-note">RTVGSR (temporal total variation, solved by ADMM) and the raw-signal variants are quoted from the paper and not run on this page; GraphTRSS + MDV runs live with ν = ' + GT_NU + ', ε = ' + GT_EPS + ', β = 1.</p>';
  setInsight('metricInsight', { pill: 'Table II · ' + row.lab, html: h, focused: true, flash, onReset: reset });
}
document.querySelector('.cards').addEventListener('click', e => {
  const c = e.target.closest('.card'); if (!c) return;
  const m = c.dataset.m, cur = state.focus.metric;
  if (cur && cur.type === 'card' && cur.m === m) { state.focus.metric = null; state.emph = null; }
  else { state.focus.metric = { type: 'card', m }; state.emph = m; const sk = METHODS[m].show; if (sk && !state[sk]) { state[sk] = true; drawLegend(); } }
  drawTS(); renderMetricInsight(true);
});
(function wireTables() {
  for (const [id, type] of [['refTable', 'row'], ['refTable2', 'row2']]) {
    const t = $(id);
    const pick = tr => { const k = +tr.dataset.k, cur = state.focus.metric; state.emph = null; state.focus.metric = cur && cur.type === type && cur.k === k ? null : { type, k }; drawTS(); renderMetricInsight(true); };
    t.addEventListener('click', e => { const tr = e.target.closest('tr[data-k]'); if (tr) pick(tr); });
    t.addEventListener('keydown', e => { const tr = e.target.closest('tr[data-k]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(tr); } });
  }
})();

/* ================= sweep ================= */
const sweepKey = () => [state.dataset, state.seed, state.frac, state.maskSeed, state.r, state.g].join('|');
const sweepStale = () => !!(state.sweep && state.sweep.key !== sweepKey());
let sweepGeom = null, sweepHover = null;
async function runSweep() {
  if (!DATA || (state.sweep && !state.sweep.done)) return;
  const btn = $('sweepBtn'); btn.disabled = true;
  const st = $('sweepStatus');
  const p = { dsKey: DATA.key, frac: state.frac, maskSeed: state.maskSeed, r: state.r, g: state.g };
  const sweep = { key: sweepKey(), params: Object.assign({ dataset: state.dataset }, p), rows: new Array(BLOCKS.length).fill(null), done: false, t0: performance.now(), workers: 1 };
  state.sweep = sweep; state.focus.sweep = null;
  st.textContent = 'starting the sweep…'; st.classList.add('busy');
  drawSweep(); renderSweepInsight();
  let workers;
  try { workers = await pool.get(DATA.key); } catch (e) { workers = [engine]; }
  sweep.workers = workers.length;
  let next = 0, doneN = 0, failed = null;
  await Promise.all(workers.map(async wk => {
    while (next < BLOCKS.length && state.sweep === sweep && !failed) {
      const k = next++;
      try { sweep.rows[k] = await wk.call('sweepBlock', Object.assign({ k }, p)); }
      catch (err) { failed = err; return; }
      if (state.sweep !== sweep) return;
      doneN++;
      st.textContent = 'sweeping… ' + doneN + '/' + BLOCKS.length + ' block lengths done' + (workers.length > 1 ? ' (' + workers.length + ' workers in parallel)' : '');
      drawSweep(); renderSweepInsight();
    }
  }));
  if (state.sweep !== sweep) return; /* superseded: a newer sweep or dataset owns the UI now */
  btn.disabled = false; st.classList.remove('busy');
  if (failed) { st.textContent = 'sweep failed: ' + failed.message; state.sweep = null; drawSweep(); renderSweepInsight(); return; }
  sweep.done = true; sweep.ms = performance.now() - sweep.t0;
  const rows = sweep.rows, f = rows[0], g = rows[rows.length - 1];
  let xo = 'none in this draw'; for (const r of rows) if (r.sl < r.pt) { xo = r.lab; break; }
  let win = 0; for (const r of rows) if (r.sl < r.mdv) win++;
  let gtWin = 0; for (const r of rows) if (r.gt < r.sl) gtWin++;
  st.textContent = 'done — ' + (BLOCKS.length * 4) + ' joint space-time solves in ' + fmtMs(sweep.ms) + (sweep.workers > 1 ? ' on ' + sweep.workers + ' workers' : '') + '. From 30-min to 7-day blocks, pure-temporal error grew ×' +
    (g.pt / f.pt).toFixed(0) + ' while STMAC grew ×' + (g.sl / f.sl).toFixed(1) +
    '. Pure temporal stays ahead until ' + xo + '. STMAC is below the station climatology at ' + win + ' of ' + rows.length +
    ' block lengths; on multi-day gaps the two nearly coincide, because the diurnal prior is doing most of the work. GraphTRSS + MDV is below STMAC at ' + gtWin + ' of ' + rows.length + '.';
  drawSweep(); renderSweepInsight(); if (state.focus.metric && state.focus.metric.type === 'row') renderMetricInsight();
}
const SW_SERIES = [{ k: 'pt', m: 'PT', c: () => C.pt, dash: [6, 4], lw: 1.6 }, { k: 's0', m: 'S0', c: () => C.s0, dash: [8, 3, 2, 3], lw: 1.5 },
  { k: 'mdv', m: 'MDV', c: () => C.mdv, dash: [4, 3], lw: 1.6 }, { k: 'st', m: 'STT', c: () => C.triv, dash: [2, 3], lw: 1.3 },
  { k: 'gt', m: 'GT', c: () => C.gt, dash: [10, 3], lw: 1.7 }, { k: 'sl', m: 'STL', c: () => C.stmac, dash: null, lw: 2.2 }];
function drawSweep() {
  const cv = $('sweepChart'), h = boxH(cv);
  const { ctx, w } = sizeCanvas(cv, h); sizeCanvas($('sweepOv'), h);
  sweepGeom = null;
  const sw = state.sweep, rows = sw ? sw.rows : null, have = rows ? rows.filter(Boolean) : [];
  if (!have.length) { placeholder(ctx, w, h, sw ? 'Sweeping…' : 'Run the sweep to draw the curves'); return; }
  const L = 74, R = 14, Tp = 16, B = 34, pw = w - L - R, ph = h - Tp - B;
  let lo = 1e9, hi = 0;
  for (const r of have) { lo = Math.min(lo, r.pt, r.sl, r.st, r.mdv, r.s0, r.gt); hi = Math.max(hi, r.pt, r.sl, r.st, r.mdv, r.s0, r.gt); }
  lo = Math.max(1, lo * 0.7); hi *= 1.4;
  const Y = val => Tp + ph - (Math.log10(val) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * ph;
  const X = i => L + (i + 0.5) / BLOCKS.length * pw;
  ctx.font = FONT; ctx.fillStyle = C.muted; ctx.textAlign = 'right';
  for (const t of [3, 10, 30, 100, 300, 1000, 3000]) {
    if (t < lo || t > hi) continue;
    ctx.strokeStyle = C.line; ctx.globalAlpha = .6; ctx.beginPath(); ctx.moveTo(L, Y(t)); ctx.lineTo(w - R, Y(t)); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillText(String(t), L - 10, Y(t) + 4);
  }
  ctx.save(); ctx.translate(17, Tp + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('RMSE (W/m², log scale)', 0, 0); ctx.restore();
  /* the block length of the scenario on screen */
  if (state.res && !sweepStale()) { const cx = X(state.res.params.blockIdx), cw = pw / BLOCKS.length; ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(cx - cw / 2, Tp, cw, ph); }
  ctx.textAlign = 'center';
  for (let i = 0; i < BLOCKS.length; i++) { ctx.fillStyle = state.res && state.res.params.blockIdx === i ? C.ink : C.muted; ctx.fillText(BLOCKS[i].lab.replace(' ', ''), X(i), h - 12); }
  ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const segs = get => { const out = []; let cur = []; rows.forEach((r, i) => { if (r) cur.push([X(i), Y(get(r))]); else if (cur.length) { out.push(cur); cur = []; } }); if (cur.length) out.push(cur); return out; };
  for (const sgm of segs(r => r.sl)) if (sgm.length > 1) {
    const grad = ctx.createLinearGradient(0, Tp, 0, Tp + ph); grad.addColorStop(0, rgba(C.stmac, 0.15)); grad.addColorStop(1, rgba(C.stmac, 0));
    ctx.fillStyle = grad; ctx.beginPath(); sgm.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.lineTo(sgm[sgm.length - 1][0], Tp + ph); ctx.lineTo(sgm[0][0], Tp + ph); ctx.closePath(); ctx.fill();
  }
  for (const s of SW_SERIES) {
    const col = s.c(); ctx.strokeStyle = col; ctx.lineWidth = s.lw; if (s.dash) ctx.setLineDash(s.dash);
    for (const sgm of segs(r => r[s.k])) { ctx.beginPath(); sgm.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
    ctx.setLineDash([]); ctx.fillStyle = col;
    rows.forEach((r, i) => { if (!r) return; ctx.beginPath(); ctx.arc(X(i), Y(r[s.k]), 3.6, 0, 6.2832); ctx.fill(); });
  }
  if (sw.done) {
    const g = rows[rows.length - 1], f = rows[0];
    ctx.font = '12.5px "IBM Plex Mono",ui-monospace,monospace';
    ctx.fillStyle = C.pt; ctx.fillText('pure temporal ×' + (g.pt / f.pt).toFixed(0) + ' growth', L + 8, Y(g.pt) - 10);
  }
  if (sweepStale()) { ctx.font = FONT; ctx.fillStyle = C.goldHi; ctx.textAlign = 'right'; ctx.fillText('settings changed since this sweep', w - R - 4, Tp + 12); ctx.textAlign = 'left'; }
  sweepGeom = { X, Y, L, R, Tp, ph, pw, w, h };
  drawSweepOverlay();
}
function sweepHit(x, y) {
  const g = sweepGeom, sw = state.sweep; if (!g || !sw) return null;
  const k = Math.floor((x - g.L) / g.pw * BLOCKS.length); if (k < 0 || k >= BLOCKS.length || !sw.rows[k]) return null;
  let best = null, bd = Infinity;
  for (const s of SW_SERIES) { const d = Math.abs(g.Y(sw.rows[k][s.k]) - y); if (d < bd) { bd = d; best = s.m; } }
  return { k, m: best, near: bd < 18 };
}
function drawSweepOverlay() {
  const ov = $('sweepOv'); const { ctx } = sizeCanvas(ov, boxH(ov));
  const g = sweepGeom, sw = state.sweep; if (!g || !sw) return;
  const cw = g.pw / BLOCKS.length;
  const col = (k, a) => { ctx.fillStyle = 'rgba(212,175,55,' + a + ')'; ctx.fillRect(g.X(k) - cw / 2, g.Tp, cw, g.ph); };
  const ring = (k, m, rad) => { const s = SW_SERIES.find(x => x.m === m); if (!s || !sw.rows[k]) return; ctx.strokeStyle = s.c(); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.X(k), g.Y(sw.rows[k][s.k]), rad, 0, 6.2832); ctx.stroke(); };
  if (sweepHover) { col(sweepHover.k, 0.06); if (sweepHover.near) ring(sweepHover.k, sweepHover.m, 7); }
  const f = state.focus.sweep;
  if (f && sw.rows[f.k]) { col(f.k, 0.1); ring(f.k, f.m, 8.5); }
}
function sweepTip(k) {
  const r = state.sweep.rows[k]; let h = '<div class="t">' + BLOCKS[k].lab + ' blocks</div>';
  for (const s of SW_SERIES.slice().reverse()) h += tipRow(METHODS[s.m].short, f1(r[s.k]) + ' W/m²', s.c());
  return h + '<div class="n">Click to read this block length</div>';
}
(function wireSweep() {
  const ov = $('sweepOv'); let raf = 0;
  const sched = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawSweepOverlay(); }); };
  ov.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const rc = ov.getBoundingClientRect(), hit = sweepHit(e.clientX - rc.left, e.clientY - rc.top);
    sweepHover = hit; ov.classList.toggle('hot', !!hit); sched();
    if (hit) showTip(sweepTip(hit.k), e.clientX, e.clientY); else hideTip();
  });
  ov.addEventListener('pointerleave', () => { sweepHover = null; hideTip(); sched(); });
  ov.addEventListener('click', e => {
    const rc = ov.getBoundingClientRect(), hit = sweepHit(e.clientX - rc.left, e.clientY - rc.top); if (!hit) return;
    state.focus.sweep = { k: hit.k, m: hit.m }; drawSweepOverlay(); renderSweepInsight(true);
  });
  ov.addEventListener('keydown', e => {
    const sw = state.sweep; if (!sw) return;
    const avail = sw.rows.map((r, i) => r ? i : -1).filter(i => i >= 0); if (!avail.length) return;
    const f = state.focus.sweep || { k: avail[0], m: 'STL' }; const order = SW_SERIES.map(s => s.m);
    let { k, m } = f, pos = avail.indexOf(k);
    if (e.key === 'ArrowRight') k = avail[Math.min(avail.length - 1, pos + 1)];
    else if (e.key === 'ArrowLeft') k = avail[Math.max(0, pos - 1)];
    else if (e.key === 'ArrowUp') m = order[Math.min(order.length - 1, order.indexOf(m) + 1)];
    else if (e.key === 'ArrowDown') m = order[Math.max(0, order.indexOf(m) - 1)];
    else if (e.key === 'Enter') { if (state.focus.sweep) setBlock(state.focus.sweep.k); e.preventDefault(); return; }
    else if (e.key === 'Escape') { state.focus.sweep = null; drawSweepOverlay(); renderSweepInsight(true); e.preventDefault(); return; }
    else return;
    e.preventDefault(); state.focus.sweep = { k, m }; drawSweepOverlay(); renderSweepInsight(true);
  });
})();
function renderSweepInsight(flash) {
  const sw = state.sweep;
  if (!sw) { setInsight('sweepInsight', { pill: 'Sweep', html: '<p class="ins-hint">Run the sweep, then click any point to read that block length.</p>' }); return; }
  const stale = sweepStale();
  const staleNote = stale ? '<p class="ins-note">These curves were computed with r = ' + sw.params.r + ', g = ' + sw.params.g + ', ' + Math.round(sw.params.frac * 100) + '% outage and mask seed ' + sw.params.maskSeed + '. The settings have changed since, so rerun the sweep to refresh them.</p>' : '';
  const f = state.focus.sweep;
  if (!f || !sw.rows[f.k]) {
    const have = sw.rows.map((r, i) => r ? i : -1).filter(i => i >= 0);
    if (!sw.done) { setInsight('sweepInsight', { pill: 'Sweep · running', html: '<p>' + have.length + ' of ' + BLOCKS.length + ' block lengths done' + (sw.workers > 1 ? ', ' + sw.workers + ' workers in parallel' : '') + '. Points appear as each block length finishes.</p>' }); return; }
    const rows = sw.rows, wins = rows.filter(r => r.sl < r.mdv).map(r => r.lab), losses = rows.filter(r => r.sl >= r.mdv).map(r => r.lab);
    const gaps = rows.map(r => r.mdv - r.sl);
    let h = '<p>STMAC is below the climatology at <b>' + wins.length + ' of ' + rows.length + '</b> block lengths' + (losses.length ? ' (not at ' + losses.join(', ') + ')' : '') + '. Its margin over the climatology runs from <b>' + sg(Math.max(...gaps), 1) + '</b> to <b>' + sg(Math.min(...gaps), 1) + ' W/m²</b> (positive = STMAC lower). Pure temporal ends <b>×' + (rows[6].pt / rows[6].sl).toFixed(1) + '</b> above STMAC at 7 days.</p>';
    const s0win = rows.filter(r => r.s0 < r.mdv).map(r => r.lab), prior = rows.map(r => r.s0 - r.sl);
    h += '<p>Without its prior, the joint solver (S0) is below the climatology ' + (s0win.length ? 'only at ' + s0win.join(', ') : 'at no block length') + ', and the prior is worth <b>' + f1(Math.min(...prior)) + '</b> to <b>' + f1(Math.max(...prior)) + ' W/m²</b> across block lengths. The paper reports the same pattern over the full year: S0 improves on the climatology only at 30 minutes, and the prior accounts for 25 to 43 W/m².</p>';
    const gtBelow = rows.filter(r => r.gt < r.sl).map(r => r.lab), gtAbove = rows.filter(r => r.gt >= r.sl).map(r => r.lab), gd = rows.map(r => r.gt - r.sl);
    h += '<p>GraphTRSS + MDV is below STMAC ' + (gtBelow.length ? 'at ' + gtBelow.join(', ') : 'at no block length') + (gtAbove.length ? ' and above it at ' + gtAbove.join(', ') : '') + ' (differences ' + sg(Math.min(...gd), 1) + ' to ' + sg(Math.max(...gd), 1) + ' W/m²). On the ten shared masks the paper finds it below STMAC up to 1 day, level at 3 days and 7.4 W/m² above at 7 days.</p>';
    h += '<p class="ins-hint">Hover for values, click a point to read that block length. With the chart focused: <kbd>←</kbd><kbd>→</kbd> block length, <kbd>↑</kbd><kbd>↓</kbd> method, <kbd>Enter</kbd> loads it above.</p>';
    setInsight('sweepInsight', { pill: 'Sweep overview', html: h + staleNote, flash });
    return;
  }
  const r = sw.rows[f.k], bl = BLOCKS[f.k], m = f.m, key = SW_SERIES.find(s => s.m === m).k, first = sw.rows[0];
  const rank = SW_SERIES.map(s => [s.m, r[s.k]]).sort((a, b) => a[1] - b[1]);
  let h = '<div class="ins-grid">' + SW_SERIES.slice().reverse().map(s => tile(METHODS[s.m].short, f1(r[s.k]), rank[0][0] === s.m ? 'lowest' : '', s.c())).join('') + '</div>';
  h += '<p>At <b>' + bl.lab + '</b> blocks (' + (100 * r.frac).toFixed(1) + '% of cells removed) the order is ' + rank.map(x => METHODS[x[0]].short + ' ' + f1(x[1])).join(' < ') + ' W/m². STMAC is ' + (r.mdv - r.sl >= 0 ? '<span class="hl">' + f1(r.mdv - r.sl) + ' W/m² (' + (100 * (r.mdv - r.sl) / r.mdv).toFixed(1) + '%) below</span>' : '<span class="neg">' + f1(r.sl - r.mdv) + ' W/m² above</span>') + ' the climatology, and pure temporal is <b>×' + (r.pt / r.sl).toFixed(1) + '</b> STMAC.</p>';
  if (first && f.k > 0) h += '<p>You selected <b>' + METHODS[m].short + '</b>: its error is <b>×' + (r[key] / first[key]).toFixed(1) + '</b> its 30-min value (' + f1(first[key]) + ' → ' + f1(r[key]) + ' W/m²).</p>';
  const row = TABLE1.find(x => x.k === f.k), row2 = TABLE2.find(x => x.k === f.k);
  if (row2) h += '<p>Paper Table II at ' + row2.lab + ' (ten shared masks): GraphTRSS + MDV ' + f1(row2.gtm) + ', STMAC ' + f1(row2.s) + ' W/m², so the baseline is ' + GT_VERDICT[f.k] + '. Live, GraphTRSS + MDV is ' + (r.gt < r.sl ? '<span class="neg">' + f1(r.sl - r.gt) + ' W/m² below</span>' : '<span class="hl">' + f1(r.gt - r.sl) + ' W/m² above</span>') + ' STMAC.</p>';
  if (row) h += '<p>Paper Table I at ' + row.lab + ': full year (20 masks) STMAC ' + f1(row.stmac) + ', S0 ' + f1(row.s0) + ', climatology ' + f1(row.mdv) + ', Transformer ' + f1(row.tf) + ', pure temporal ' + f0(row.pt) + ' W/m²; held-out 7 Nov to 31 Dec (30 masks) STMAC ' + f1(row.hoS) + ', climatology ' + f1(row.hoMdv) + ', Transformer ' + f1(row.hoTf) + '. ' +
    (sw.params.dataset === 'real' ? 'The live 70-day window overlaps the held-out period: live STMAC is <b>' + (r.sl / row.hoS).toFixed(2) + '×</b> the held-out value and ' + (r.sl / row.stmac).toFixed(2) + '× the full-year one.' : 'This sweep ran on synthetic weather, so compare shapes, not values.') + '</p>';
  else h += '<p>Table I of the paper does not report ' + bl.lab + ' blocks; the live sweep adds it to fill the curve.</p>';
  const onScreen = state.res && state.res.params.blockIdx === f.k && !stale;
  h += '<div class="ins-actions">' + (onScreen ? '<span class="ins-note">This is the scenario shown in the reconstruction chart.</span>' : actBtn('Load ' + bl.lab + ' in the reconstruction chart', 'data-act="block" data-k="' + f.k + '"')) + '</div>';
  setInsight('sweepInsight', { pill: 'Sweep · ' + bl.lab + ' · ' + METHODS[m].short, html: h + staleNote, focused: true, flash, onReset: () => { state.focus.sweep = null; drawSweepOverlay(); renderSweepInsight(true); } });
}
function buildSweepLegend() {
  const el = $('sweepLegend'); el.innerHTML = '';
  const items = [['Pure temporal — per-station smoothing, no spatial info', C.pt, 'dash'], ['Station climatology (MDV) — mean diurnal cycle, ±15 days', C.mdv, 'dash'],
    ['STMAC without prior (S0) — C = 0, g = 0, r = 10, the ablation of Table I', C.s0, 'dashdot'],
    ['GraphTRSS + MDV — Sobolev smoothness on the same anomalies, Table II', C.gt, 'longdash'],
    ['STMAC · trivial sheaf — graph coupling, no time alignment', C.triv, 'dot'], ['STMAC · longitude sheaf — proposed, solar-time aligned', C.stmac, 'solid']];
  for (const [lab, col, styl] of items) {
    const s = document.createElement('span'); s.className = 'sl'; s.style.cursor = 'default';
    const bg = styl === 'solid' ? col : styl === 'longdash' ? 'repeating-linear-gradient(90deg,' + col + ' 0 10px,transparent 10px 13px)' : styl === 'dashdot' ? 'repeating-linear-gradient(90deg,' + col + ' 0 8px,transparent 8px 11px,' + col + ' 11px 13px,transparent 13px 16px)' : styl === 'dash' ? 'repeating-linear-gradient(90deg,' + col + ' 0 6px,transparent 6px 10px)' : 'repeating-linear-gradient(90deg,' + col + ' 0 3px,transparent 3px 6px)';
    s.innerHTML = '<span class="sw" style="background:' + bg + '"></span>' + lab; el.appendChild(s);
  }
}

/* ================= economics ================= */
/* Paper, Table III: annual cost of the PV-estimate error (million USD per year), mean of the
   seven outage lengths, from the unit-commitment simulation of the 2025 Saudi system
   (Section V-D). c19 = 19.3 GW, 3+5 reserve, 69 USD/bbl; c40 = 40 GW, 3+5, 69; ur = 40 GW,
   uncertainty-based reserve, 69; c96 / ur96 = the same at 96 USD/bbl. eq = first-order model at
   40 GW, 10% outage, 3 and 10 USD/MWh, applied to R, the seven-length mean RMSE (W/m2). */
const UC_COLS = [
  { id: 'c19', lab: '19.3 GW (2026) · 3+5 reserve · $69', desc: '19.3 GW of PV (operating in 2026), the 3+5 reserve rule and fuel at 69 USD/bbl', gw: 19.3, ur: false, oil: 69 },
  { id: 'c40', lab: '40 GW · 3+5 reserve · $69', desc: '40 GW of PV (planned for 2027), the 3+5 reserve rule and fuel at 69 USD/bbl', gw: 40, ur: false, oil: 69 },
  { id: 'ur', lab: '40 GW · uncertainty reserve · $69', desc: '40 GW of PV, reserves sized to each method’s error (UR) and fuel at 69 USD/bbl', gw: 40, ur: true, oil: 69 },
  { id: 'c96', lab: '40 GW · 3+5 reserve · $96', desc: '40 GW of PV, the 3+5 reserve rule and fuel at the EIA 2026 outlook of 96 USD/bbl', gw: 40, ur: false, oil: 96 },
  { id: 'ur96', lab: '40 GW · uncertainty reserve · $96', desc: '40 GW of PV, reserves sized to each method’s error (UR) and fuel at 96 USD/bbl', gw: 40, ur: true, oil: 96 }];
const TABLE3 = [
  { key: 'TF', lab: 'Transformer (trained)', c19: 0.68, c40: 3.88, ur: 7.52, c96: 7.07, ur96: 13.99, eq: [11.0, 36.8], R: PAPER.tf },
  { key: 'MDV', lab: 'Station climatology (MDV)', c19: 0.37, c40: 2.51, ur: 4.91, c96: 3.44, ur96: 8.13, eq: [8.5, 28.5], R: PAPER.mdv },
  { key: 'STL', lab: 'STMAC', c19: 0.28, c40: 2.00, ur: 4.21, c96: 2.69, ur96: 6.98, eq: [7.7, 25.6], R: PAPER.stmac },
  { key: 'TVM', lab: 'TVGSR + MDV', c19: 0.23, c40: 1.65, ur: 3.75, c96: 2.21, ur96: 6.30, eq: [7.3, 24.4], R: PAPER.tvm },
  { key: 'GT', lab: 'GraphTRSS + MDV', c19: 0.19, c40: 1.44, ur: 3.40, c96: 1.87, ur96: 5.69, eq: [6.8, 22.6], R: PAPER.gtm }];
const T3C = { TF: () => C.tf, MDV: () => C.mdv, STL: () => C.stmac, TVM: () => C.tvm, GT: () => C.gt };
const musd = v => (v < 0 ? MINUS : '') + '$' + Math.abs(v).toFixed(2) + 'M';
/* first-order model: C_err = P_cap (R/1000) eps H_d c, with H_d = 4380 daylight hours */
function cost(gw, R, pen, out) { return gw * 1000 * (R / 1000) * out * 4380 * pen; }
let costGeom = [], costHover = -1, econRaf = 0;
function scheduleEcon() { if (!econRaf) econRaf = requestAnimationFrame(() => { econRaf = 0; updateEcon(); }); }
const ucCol = () => UC_COLS.find(c => c.id === state.econ.col);
/* bars on screen: {key, lab, c, R, val (million USD per year)} */
function econMethods() {
  if (state.econ.view === 'uc') { const col = state.econ.col; return TABLE3.map(m => ({ key: m.key, lab: m.lab, c: T3C[m.key](), R: m.R, val: m[col], row: m })); }
  const { gw, pen, out } = levers(), val = R => cost(gw, R, pen, out) / 1e6;
  if (state.econ.src === 'paper' || !state.res) return TABLE3.map(m => ({ key: m.key, lab: m.lab, c: T3C[m.key](), R: m.R, val: val(m.R), row: m }));
  const r = state.res;
  return [{ key: 'PT', lab: 'Pure temporal', c: C.pt, R: r.rPT }, { key: 'MDV', lab: 'Station climatology (MDV)', c: C.mdv, R: r.rMDV },
    { key: 'STT', lab: 'STMAC · trivial sheaf', c: C.triv, R: r.rSTT }, { key: 'STL', lab: 'STMAC · longitude sheaf', c: C.stmac, R: r.rSTL },
    { key: 'GT', lab: 'GraphTRSS + MDV', c: C.gt, R: r.rGT }].map(m => Object.assign(m, { val: val(m.R) }));
}
function levers() { return { gw: +$('gwSlider').value, pen: +$('penSlider').value, out: +$('outSlider').value / 100 }; }
function buildUcChips() {
  const el = $('ucChips'); el.innerHTML = '';
  for (const c of UC_COLS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (c.id === state.econ.col ? ' on' : ''); b.textContent = c.lab;
    b.setAttribute('aria-pressed', c.id === state.econ.col ? 'true' : 'false');
    b.addEventListener('click', () => { if (state.econ.col === c.id) return; state.econ.col = c.id; buildUcChips(); updateEcon(); });
    el.appendChild(b);
  }
  scheduleStamp();
}
function setEconView(view) {
  state.econ.view = view; state.focus.cost = null;
  document.querySelectorAll('#econView .chip').forEach(b => { const on = b.dataset.view === view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  $('ucCtl').hidden = view !== 'uc'; $('eqCtl').hidden = view !== 'eq';
  updateEcon();
}
function setEconSrc(src) {
  state.econ.src = src; state.focus.cost = null;
  for (const [id, key] of [['srcPaper', 'paper'], ['srcLive', 'live']]) { const el = $(id); el.classList.toggle('on', key === src); el.setAttribute('aria-pressed', key === src ? 'true' : 'false'); }
  updateEcon();
}
function ucInterp() {
  const col = ucCol(), k = col.id, by = key => TABLE3.find(m => m.key === key)[k];
  const st = by('STL'), tf = by('TF'), md = by('MDV'), gt = by('GT'), tv = by('TVM');
  let t = 'With ' + col.desc + ', the error of STMAC costs <b>' + musd(st) + ' a year</b> in the simulated 2025 system: <span class="hl">' + musd(tf - st) + '</span> less than the trained Transformer and <span class="hl">' + musd(md - st) + '</span> less than the station climatology. GraphTRSS + MDV costs <b>' + musd(st - gt) + '</b> less than STMAC and TVGSR + MDV ' + musd(st - tv) + ' less, in line with their lower RMSE in Table II. The cost ranking follows the RMSE ranking in every column of Table III.';
  if (k === 'c19') t += ' This is the PV capacity operating in 2026; the paper finds costs 5.7 to 7.4 times higher at 40 GW, because the error volume roughly doubles and the cost per MWh of error also rises.';
  else if (k === 'c40') t += ' No simulated case sheds load, so this is extra fuel and start-ups when a schedule built on the estimate is corrected in real time; STMAC’s error burns 25.7 thousand barrels of oil equivalent a year against 118 thousand for the Transformer.';
  else if (col.ur && col.oil === 69) t += ' Reserves sized to each method’s error roughly double the cost of every method against the 3+5 rule (STMAC ' + musd(TABLE3.find(m => m.key === 'STL').c40) + ' there).';
  else t += ' The 96 USD/bbl case scales the fuel component of the cost with the dispatch held fixed; with fuel valued at export parity every cost channel scales with the oil price.';
  return t;
}
function updateEcon() {
  const view = state.econ.view, methods = econMethods(), st = methods.find(m => m.key === 'STL');
  if (view === 'eq') { const { gw, pen, out } = levers(); $('gwVal').textContent = gw + ' GW'; $('penVal').textContent = '$' + pen + '/MWh'; $('outVal').textContent = Math.round(out * 100) + '%'; }
  $('saveNum').textContent = view === 'uc' ? musd(st.val) : money(st.val);
  $('saveLbl').textContent = view === 'uc' ? 'annual cost of STMAC’s reconstruction error in the simulated 2025 system (Table III)' : 'annual cost of STMAC’s error under the first-order model, which the paper finds 4 to 13 times the simulated cost';
  $('costLbl').textContent = view === 'uc' ? 'Annual cost of the PV-estimate error by method · ' + ucCol().lab : 'First-order cost by method · ' + (state.econ.src === 'live' && state.res ? 'live RMSE' : 'paper RMSE');
  const ei = $('econInterp');
  if (view === 'uc') ei.innerHTML = ucInterp();
  else {
    const { gw, pen, out } = levers(), cl = methods.find(m => m.key === 'MDV'), tf = methods.find(m => m.key === 'TF'), gtm = methods.find(m => m.key === 'GT');
    let t = 'The first-order model multiplies capacity, relative error, outage fraction, 4,380 daylight hours and a penalty rate. At <b>' + gw + ' GW</b>, <b>$' + pen + '/MWh</b> and <b>' + Math.round(out * 100) + '%</b> outage, STMAC’s error prices at <b>' + money(st.val) + '/yr</b> and the climatology’s at <b>' + money(cl.val) + '/yr</b>' + (tf ? '; the Transformer’s at <b>' + money(tf.val) + '/yr</b>' : '') + (gtm ? '; GraphTRSS + MDV’s at <b>' + money(gtm.val) + '/yr</b>' : '') + '.';
    t += ' Saudi Arabia has no imbalance market, and the paper’s unit-commitment simulation puts STMAC’s cost at 40 GW (3+5 reserve, 69 USD/bbl) at $2.00M a year, while this model gives $7.7M to $25.6M for the paper’s RMSE at 3 to 10 USD/MWh: 4 to 13 times more. Read these bars as an upper reference, not as a cost estimate.';
    if (state.econ.src === 'live' && state.res) t += ' The RMSEs come from the ' + BLOCKS[state.res.params.blockIdx].lab + ' scenario you just ran on the ' + (DATA && DATA.kind === 'syn' ? 'synthetic run' : '70-day window') + ', so the bars move with every run.';
    else if (state.econ.src === 'live') t += ' The live scenario is still solving, so the paper’s means are shown.';
    ei.innerHTML = t;
  }
  renderEconLive();
  drawCost(methods);
  renderCostInsight();
}
function renderEconLive() {
  const lv = $('econLive'); if (!lv) return;
  if (!state.res) { lv.innerHTML = '<li>Run a scenario to see the live reading.</li>'; return; }
  const r = state.res, p = r.params, bl = BLOCKS[p.blockIdx];
  const { gw, pen, out } = levers(), perW = gw * out * 4380 * pen / 1e6, fm = v => money(v);
  const items = [];
  items.push('<b>Scenario:</b> ' + bl.lab + ' outages covering ' + Math.round(r.effFrac * 100) + '% of each station’s record (mask seed ' + p.maskSeed + '), ' + (DATA.kind === 'real' ? 'real 1999 record, 22 Oct to 30 Dec' : 'synthetic weather') + ', weights r = ' + p.r + ', g = ' + p.g +
    (p.r === R_RATIO && p.g === RIDGE ? ' (the paper’s values).' : ' (changed from the paper’s r = 1000, g = 3).'));
  const live = [['GraphTRSS + MDV', r.rGT], ['STMAC', r.rSTL], ['Station climatology', r.rMDV], ['Pure temporal', r.rPT]].sort((a, b) => a[1] - b[1]);
  items.push('<b>Live errors, lowest first:</b> ' + live.map(x => x[0] + ' ' + Math.round(x[1]) + ' W/m²').join(' · ') + '.');
  const d = r.rMDV - r.rSTL;
  items.push('<b>STMAC against the climatology:</b> ' + (d > 0.05 ? 'STMAC is ' + f1(d) + ' W/m² lower here. ' : d < -0.05 ? 'the climatology is ' + f1(-d) + ' W/m² lower in this draw; single masks can fall either way on long gaps. ' : 'the two are level here; on long gaps the diurnal prior does most of the work. ') +
    'Over the paper’s 20 masks STMAC stays below the climatology at every block length, by 2.6 to 72 W/m², and in the simulation its error costs $0.51M a year less at 40 GW (3+5 reserve).');
  const dg = r.rGT - r.rSTL;
  items.push('<b>STMAC against GraphTRSS + MDV:</b> ' + (dg < -0.05 ? 'the graph baseline is ' + f1(-dg) + ' W/m² lower here' : dg > 0.05 ? 'STMAC is ' + f1(dg) + ' W/m² lower here' : 'the two are level here') + '. In the paper GraphTRSS + MDV is lower up to 1 day, and its error costs $0.56M a year less than STMAC’s at 40 GW (3+5 reserve), in line with its lower RMSE.');
  items.push('<b>First-order translation:</b> at ' + gw + ' GW, $' + pen + '/MWh and ' + Math.round(out * 100) + '% outage every 1 W/m² of error is worth $' + perW.toFixed(2) + 'M a year, so the live STMAC error prices at ' + fm(cost(gw, r.rSTL, pen, out) / 1e6) + ' and the climatology at ' + fm(cost(gw, r.rMDV, pen, out) / 1e6) + '. The paper’s simulation suggests the system cost is 4 to 13 times lower than this rule of thumb.');
  if (DATA.kind === 'real') items.push('<b>Why the live errors are lower than the paper’s:</b> Table III uses the mean over the seven block lengths of the full-year evaluation (STMAC 145.9 W/m² on the ten shared masks). This page runs one mask on a 70-day winter window with weaker sunlight, so the errors are smaller; the ordering of the methods is what carries over.');
  items.push('<b>What to try next:</b> switch the valuation to the first-order model and move the penalty to see how far it sits from the simulated cost; shorten the block to 30 min or 2 h and GraphTRSS + MDV pulls ahead; lengthen it to 3 or 7 days and STMAC, the climatology and GraphTRSS + MDV converge.');
  lv.innerHTML = items.map(t => '<li>' + t + '</li>').join('');
}
const SHORT_LAB = { TF: 'Transformer', MDV: 'Climatology', STL: 'STMAC', TVM: 'TVGSR+MDV', GT: 'GraphTRSS+MDV', PT: 'Pure temporal', STT: 'STMAC trivial' };
function drawCost(methods) {
  const cv = $('costChart'), h = boxH(cv);
  const { ctx, w } = sizeCanvas(cv, h); sizeCanvas($('costOv'), h);
  const maxC = Math.max(...methods.map(m => m.val)), uc = state.econ.view === 'uc';
  const bh = 30;
  ctx.font = FONT; costGeom = [];
  methods.forEach((m, i) => {
    const y = 20 + i * (bh + 28), bw = Math.max(3, m.val / maxC * (w - 124));
    const lab = w < 440 ? (SHORT_LAB[m.key] || m.lab) + ' · ' + Math.round(m.R) + ' W/m²' : m.lab + '  ·  ' + (uc ? 'mean RMSE ' : 'R = ') + Math.round(m.R) + ' W/m²';
    ctx.fillStyle = C.muted; ctx.fillText(lab, 0, y - 6);
    ctx.fillStyle = m.c; ctx.globalAlpha = .85; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, y, bw, bh, 5) : ctx.rect(0, y, bw, bh); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = C.ink; ctx.fillText((uc ? musd(m.val) : money(m.val)) + '/yr', bw + 8, y + bh / 2 + 4);
    costGeom.push({ y0: y - 19, y1: y + bh + 6, y, bw, bh, m });
  });
  drawCostOverlay();
}
function drawCostOverlay() {
  const ov = $('costOv'); const { ctx } = sizeCanvas(ov, boxH(ov));
  const f = state.focus.cost;
  costGeom.forEach((g, i) => {
    const sel = f && f === g.m.key, hov = i === costHover;
    if (!sel && !hov) return;
    ctx.strokeStyle = sel ? C.goldHi : rgba(C.ink, 0.6); ctx.lineWidth = sel ? 2 : 1.2;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, g.y - 2, g.bw + 3, g.bh + 4, 6) : ctx.rect(0, g.y - 2, g.bw + 3, g.bh + 4); ctx.stroke();
  });
}
function costHit(y) { return costGeom.findIndex(g => y >= g.y0 && y <= g.y1); }
(function wireCost() {
  const ov = $('costOv');
  ov.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const rc = ov.getBoundingClientRect(), i = costHit(e.clientY - rc.top);
    if (i !== costHover) { costHover = i; drawCostOverlay(); }
    ov.classList.toggle('hot', i >= 0);
    if (i >= 0) { const g = costGeom[i], uc = state.econ.view === 'uc'; showTip('<div class="t">' + g.m.lab + '</div>' + tipRow(uc ? 'Mean RMSE' : 'RMSE', f1(g.m.R) + ' W/m²', g.m.c) + tipRow(uc ? 'Simulated cost' : 'First-order cost', (uc ? musd(g.m.val) : money(g.m.val)) + '/yr') + '<div class="n">Click to read this bar</div>', e.clientX, e.clientY); }
    else hideTip();
  });
  ov.addEventListener('pointerleave', () => { costHover = -1; drawCostOverlay(); hideTip(); });
  ov.addEventListener('click', e => {
    const rc = ov.getBoundingClientRect(), i = costHit(e.clientY - rc.top); if (i < 0) return;
    const key = costGeom[i].m.key; state.focus.cost = state.focus.cost === key ? null : key; drawCostOverlay(); renderCostInsight(true);
  });
  ov.addEventListener('keydown', e => {
    if (!costGeom.length) return;
    let i = costGeom.findIndex(g => g.m.key === state.focus.cost);
    if (e.key === 'ArrowDown') i = Math.min(costGeom.length - 1, i + 1);
    else if (e.key === 'ArrowUp') i = Math.max(0, i < 0 ? 0 : i - 1);
    else if (e.key === 'Escape') { state.focus.cost = null; drawCostOverlay(); renderCostInsight(true); e.preventDefault(); return; }
    else return;
    e.preventDefault(); state.focus.cost = costGeom[i].m.key; drawCostOverlay(); renderCostInsight(true);
  });
})();
function renderCostInsight(flash) {
  const f = state.focus.cost, methods = econMethods(), m = methods.find(x => x.key === f);
  const reset = () => { state.focus.cost = null; drawCostOverlay(); renderCostInsight(true); };
  if (!m) {
    if (f) state.focus.cost = null;
    setInsight('costInsight', { pill: 'Cost bars', html: '<p class="ins-hint">' + (state.econ.view === 'uc' ? 'Click a bar to see what the method’s error costs in the simulated system, how far it sits from STMAC, and what the first-order model would have said.' : 'Click a bar to see what it costs, how far it sits from STMAC, and at which penalty the gap passes $1M a year.') + '</p>' });
    return;
  }
  const st = methods.find(x => x.key === 'STL'), maxC = Math.max(...methods.map(x => x.val));
  if (state.econ.view === 'uc') {
    const col = ucCol(), row = m.row, d = m.val - st.val, vals = UC_COLS.map(c => [c, row[c.id]]);
    const lo = vals.reduce((a, b) => b[1] < a[1] ? b : a), hi = vals.reduce((a, b) => b[1] > a[1] ? b : a);
    let h = '<div class="ins-grid">' + tile('Simulated cost', musd(m.val) + '/yr', col.lab, m.c) + tile('Mean RMSE', f1(m.R) + ' W/m²', m.key === 'TF' ? 'Table I, full year' : 'Table II, ten masks') +
      (m.key !== 'STL' ? tile(d >= 0 ? 'Above STMAC' : 'Below STMAC', musd(Math.abs(d)) + '/yr', sg(m.R - st.R, 1) + ' W/m²') : '') + tile('First-order, 40 GW', '$' + row.eq[0].toFixed(1) + '–' + row.eq[1].toFixed(1) + 'M', '3 to 10 USD/MWh') + '</div>';
    h += '<p>With ' + col.desc + ', the error of <b>' + m.lab + '</b> costs <b>' + musd(m.val) + '</b> a year in the simulated system' + (m.key === 'STL' ? '.' : ', ' + (d >= 0 ? musd(d) + ' more' : musd(-d) + ' less') + ' than STMAC.') + ' Across the five columns of Table III it runs from ' + musd(lo[1]) + ' (' + lo[0].lab + ') to ' + musd(hi[1]) + ' (' + hi[0].lab + ').</p>';
    h += '<p>The first-order model prices the same mean RMSE at $' + row.eq[0].toFixed(1) + 'M to $' + row.eq[1].toFixed(1) + 'M a year at 40 GW, ' + (row.eq[0] / row.c40).toFixed(1) + ' to ' + (row.eq[1] / row.c40).toFixed(1) + ' times the simulated 40 GW cost under the 3+5 rule.</p>';
    if (m.key === 'TF') h += '<p>The Transformer was trained on the same year, which can only lower its error, and its figures are quoted from the paper; the page does not run it. At 40 GW (3+5) its error burns 118 thousand barrels of oil equivalent a year against 25.7 thousand for STMAC.</p>';
    else if (m.key === 'GT') h += '<p>GraphTRSS + MDV runs live on this page (fifth error card); its RMSE is the lowest of the five on the ten shared masks, and so is its cost in every column.</p>';
    else if (m.key === 'TVM') h += '<p>TVGSR + MDV is quoted from Table II (ν = 10) and not run on this page.</p>';
    else if (m.key === 'MDV') h += '<p>The climatology is the method every spatial correction has to beat; STMAC’s margin over it is ' + musd(m.val - st.val) + ' a year in this column.</p>';
    else h += '<p>At 40 GW (3+5) STMAC’s error burns 25.7 thousand barrels of oil equivalent a year. The nearest bar is ' + (() => { const o = methods.filter(x => x.key !== 'STL').map(x => [x, x.val - st.val]).sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))[0]; return '<b>' + o[0].lab + '</b>, ' + (o[1] >= 0 ? musd(o[1]) + ' more expensive.' : musd(-o[1]) + ' cheaper.'); })() + '</p>';
    setInsight('costInsight', { pill: 'Cost · ' + m.lab, html: h, focused: true, flash, onReset: reset });
    return;
  }
  const { gw, pen, out } = levers();
  const perW = gw * out * 4380 * pen / 1e6, c = m.val, dR = m.R - st.R, dC = c - st.val;
  const srcLab = state.econ.src === 'live' && state.res ? 'this live run' : 'the paper’s means over the seven block lengths';
  let h = '<div class="ins-grid">' + tile('RMSE', f1(m.R) + ' W/m²', '', m.c) + tile('First-order cost', money(c) + '/yr', (100 * c / maxC).toFixed(0) + '% of the tallest bar') +
    tile('Cost per W/m²', '$' + perW.toFixed(2) + 'M/yr', 'at these levers') + (m.key !== 'STL' ? tile(dC >= 0 ? 'Above STMAC' : 'Below STMAC', money(Math.abs(dC)) + '/yr', sg(dR, 1) + ' W/m²') : '') + '</div>';
  h += '<p>The first-order model, ' + gw + ' GW × (R/1000) × ' + Math.round(out * 100) + '% outage × 4,380 h × $' + pen + '/MWh, turns every 1 W/m² of error into <b>$' + perW.toFixed(2) + 'M</b> a year. With R = ' + f1(m.R) + ' W/m² (from ' + srcLab + '), <b>' + m.lab + '</b> prices at <b>' + money(c) + '/yr</b>.</p>';
  if (m.key !== 'STL') {
    if (dR > 0) {
      const penStar = 1e6 / (gw * 1000 * (dR / 1000) * out * 4380);
      h += '<p>It sits <b>' + f1(dR) + ' W/m²</b> above STMAC, so it costs <b>' + money(dC) + '/yr</b> more. Holding capacity and outage fixed, that gap passes $1M a year once the penalty exceeds <b>$' + (penStar < 100 ? penStar.toFixed(2) : penStar.toFixed(0)) + '/MWh</b>' + (penStar <= pen ? ' (it already does at $' + pen + '/MWh).' : ' (the current rate is $' + pen + '/MWh).') + '</p>';
    } else h += '<p>It sits <b>' + f1(-dR) + ' W/m² below</b> STMAC here, so it is <b>' + money(-dC) + '/yr</b> cheaper in this reading.' + (m.key === 'PT' ? ' Short gaps favour pure temporal, as the paper reports for blocks up to 2 hours.' : '') + '</p>';
    if (m.key === 'PT' && m.R > PHYS_MAX) h += '<p>An RMSE of ' + f0(m.R) + ' W/m² exceeds the [0, ' + PHYS_MAX + '] W/m² physical range, so treat this bar as a warning about naive smoothing, not as a cost anyone would pay.</p>';
  }
  if (m.row) h += '<p>In the paper’s unit-commitment simulation the same method costs ' + musd(m.row.c40) + ' a year at 40 GW (3+5 reserve, 69 USD/bbl), ' + (m.val / m.row.c40).toFixed(1) + ' times less than this bar at the current levers.</p>';
  else h += '<p>The paper’s simulation puts STMAC at $2.00M a year at 40 GW (3+5 reserve), against $7.7M to $25.6M from this model at 3 to 10 USD/MWh: because Saudi Arabia has no imbalance market, the paper treats this model as a comparison, not as the valuation.</p>';
  setInsight('costInsight', { pill: 'Cost · ' + m.lab, html: h, focused: true, flash, onReset: reset });
}

/* ================= 2025 load estimate (input of the unit-commitment simulation) ================= */
let LOAD = null, loadGeom = null, loadHover = null;
function decodeLoad() {
  if (LOAD) return LOAD;
  const p = window.STMAC_LOAD2025; if (!p) return null;
  const bin = atob(p.b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const d16 = new Int16Array(u8.buffer), mw = new Float64Array(p.hours); let acc = 0;
  for (let i = 0; i < p.hours; i++) { acc += d16[i]; mw[i] = acc; }
  const nd = p.hours / 24, days = [];
  for (let d = 0; d < nd; d++) {
    let lo = Infinity, hi = -Infinity, s = 0, hLo = 0, hHi = 0;
    for (let h = 0; h < 24; h++) { const x = mw[d * 24 + h]; s += x; if (x < lo) { lo = x; hLo = h; } if (x > hi) { hi = x; hHi = h; } }
    const dt = new Date(Date.UTC(p.calendarYear, 0, 1 + d));
    days.push({ d, lo, hi, mean: s / 24, hLo, hHi, fri: dt.getUTCDay() === 5, m: dt.getUTCMonth(), lab: MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCDate() });
  }
  let peak = -Infinity, ip = 0, min = Infinity, sum = 0; for (let i = 0; i < p.hours; i++) { const x = mw[i]; sum += x; if (x > peak) { peak = x; ip = i; } if (x < min) min = x; }
  const thr = peak * (1 - 3 / 62.1); let near = 0, near3 = 0; for (let i = 0; i < p.hours; i++) { if (mw[i] > thr) near++; if (mw[i] >= peak - 3000) near3++; }
  const mm = f => { let s = 0, n = 0; for (const x of days) if (f(x)) { s += x.mean; n++; } return s / n; };
  const fr = (f, g) => { let a = 0, na = 0, b = 0, nb = 0; for (const x of days) if (f(x)) { if (x.fri) { a += x.mean; na++; } else { b += x.mean; nb++; } } return (a / na) / (b / nb); };
  const byPeak = days.slice().sort((a, b) => b.hi - a.hi);
  days.forEach(x => { x.rank = byPeak.indexOf(x) + 1; });
  /* the live 70-day window (22 Oct to 30 Dec) as day-of-year indices */
  const w0 = 294, w1 = 364;
  LOAD = { mw, days, peak, ip, min, energy: sum / 1e6, lf: sum / p.hours / peak, thr, near, near3,
    summer: mm(x => x.m >= 5 && x.m <= 7), winter: mm(x => x.m === 11 || x.m <= 1), friJA: fr(x => x.m === 6 || x.m === 7), win: [w0, w1], winMean: mm(x => x.d >= w0 && x.d < w1) };
  return LOAD;
}
function drawLoad() {
  const cv = $('loadChart'), h = boxH(cv);
  const { ctx, w } = sizeCanvas(cv, h); sizeCanvas($('loadOv'), h);
  loadGeom = null;
  const Ld = decodeLoad();
  if (!Ld) { placeholder(ctx, w, h, 'Loading the load estimate…'); return; }
  const L = 54, R = 10, Tp = 12, B = 28, pw = w - L - R, ph = h - Tp - B, nd = Ld.days.length;
  const ymin = 20000, ymax = 80000;
  const X = d => L + (d + 0.5) / nd * pw, Y = v => Tp + ph - (v - ymin) / (ymax - ymin) * ph;
  ctx.font = FONT; ctx.fillStyle = C.muted; ctx.textAlign = 'right';
  for (const t of [20000, 40000, 60000, 80000]) {
    ctx.strokeStyle = C.line; ctx.globalAlpha = .6; ctx.beginPath(); ctx.moveTo(L, Y(t)); ctx.lineTo(w - R, Y(t)); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillText(String(t / 1000), L - 8, Y(t) + 4);
  }
  ctx.save(); ctx.translate(13, Tp + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('Load (GW)', 0, 0); ctx.restore();
  /* live reconstruction window */
  ctx.fillStyle = rgba(C.stmac, 0.06); ctx.fillRect(X(Ld.win[0]) - pw / nd / 2, Tp, (Ld.win[1] - Ld.win[0]) * pw / nd, ph);
  ctx.textAlign = 'center';
  const mStep = pw < 420 ? 2 : 1;
  for (let m = 0; m < 12; m += mStep) { const d0 = Math.round((Date.UTC(1999, m, 15) - Date.UTC(1999, 0, 1)) / 86400000); ctx.fillStyle = C.muted; ctx.fillText(MONTHS[m], X(d0), h - 9); }
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(C.solar, 0.22); ctx.beginPath();
  Ld.days.forEach((x, i) => { const px = X(i), py = Y(x.hi); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  for (let i = nd - 1; i >= 0; i--) ctx.lineTo(X(i), Y(Ld.days[i].lo));
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.solar; ctx.lineWidth = 1.5; ctx.beginPath();
  Ld.days.forEach((x, i) => { const px = X(i), py = Y(x.mean); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
  /* near-peak threshold and the annual peak */
  ctx.strokeStyle = rgba(C.pt, 0.7); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(L, Y(Ld.thr)); ctx.lineTo(w - R, Y(Ld.thr)); ctx.stroke(); ctx.setLineDash([]);
  const pd = Math.floor(Ld.ip / 24); ctx.fillStyle = C.pt; ctx.beginPath(); ctx.arc(X(pd), Y(Ld.peak), 4, 0, 6.2832); ctx.fill();
  ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText(w < 440 ? 'live' : 'live window', w - R - 4, Tp + 12); ctx.textAlign = 'left';
  loadGeom = { X, Y, L, R, Tp, ph, pw, w, h, nd };
  drawLoadOverlay();
}
function drawLoadOverlay() {
  const ov = $('loadOv'); const { ctx } = sizeCanvas(ov, boxH(ov));
  const g = loadGeom; if (!g) return;
  const mark = (d, sel) => { if (d == null) return; const x = g.X(d), x0 = LOAD.days[d]; ctx.strokeStyle = sel ? C.goldHi : rgba(C.ink, 0.45); ctx.lineWidth = 1; ctx.setLineDash(sel ? [] : [3, 3]);
    ctx.beginPath(); ctx.moveTo(x, g.Tp); ctx.lineTo(x, g.Tp + g.ph); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.solar; ctx.beginPath(); ctx.arc(x, g.Y(x0.mean), sel ? 4.5 : 3.5, 0, 6.2832); ctx.fill(); };
  if (state.focus.load != null) mark(state.focus.load, true);
  if (loadHover != null && loadHover !== state.focus.load) mark(loadHover, false);
}
const loadIdx = x => { const g = loadGeom; if (!g || x < g.L - 4 || x > g.w - g.R + 4) return null; return Math.max(0, Math.min(g.nd - 1, Math.floor((x - g.L) / g.pw * g.nd))); };
const gw2 = mw => (mw / 1000).toFixed(2);
(function wireLoad() {
  const ov = $('loadOv'); let raf = 0;
  const sched = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawLoadOverlay(); }); };
  ov.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || !loadGeom) return;
    const rc = ov.getBoundingClientRect(), d = loadIdx(e.clientX - rc.left); loadHover = d; sched(); ov.classList.toggle('hot', d != null);
    if (d == null) { hideTip(); return; }
    const x = LOAD.days[d];
    showTip('<div class="t">' + x.lab + (x.fri ? ' · Friday' : '') + '</div>' + tipRow('Daily peak', gw2(x.hi) + ' GW at ' + pad2(x.hHi) + ':00', C.pt) + tipRow('Daily mean', gw2(x.mean) + ' GW', C.solar) + tipRow('Daily minimum', gw2(x.lo) + ' GW at ' + pad2(x.hLo) + ':00') + '<div class="n">Click to read this day</div>', e.clientX, e.clientY);
  });
  ov.addEventListener('pointerleave', () => { loadHover = null; hideTip(); sched(); });
  ov.addEventListener('click', e => { if (!loadGeom) return; const rc = ov.getBoundingClientRect(), d = loadIdx(e.clientX - rc.left); if (d == null) return; state.focus.load = d; drawLoadOverlay(); renderLoadInsight(true); });
  ov.addEventListener('keydown', e => {
    if (!loadGeom) return;
    let d = state.focus.load == null ? Math.floor(LOAD.ip / 24) : state.focus.load;
    if (e.key === 'ArrowRight') d += e.shiftKey ? 7 : 1; else if (e.key === 'ArrowLeft') d -= e.shiftKey ? 7 : 1;
    else if (e.key === 'Escape') { state.focus.load = null; drawLoadOverlay(); renderLoadInsight(true); e.preventDefault(); return; } else return;
    e.preventDefault(); state.focus.load = Math.max(0, Math.min(loadGeom.nd - 1, d)); drawLoadOverlay(); renderLoadInsight(true);
  });
})();
function renderLoadInsight(flash) {
  const Ld = decodeLoad();
  if (!Ld) { setInsight('loadInsight', { pill: 'Load overview', html: '<p class="ins-hint">Could not load assets/data/load2025.js.</p>' }); return; }
  const pd = Ld.days[Math.floor(Ld.ip / 24)], d = state.focus.load;
  if (d == null) {
    let h = '<div class="ins-grid">' + tile('Annual peak', gw2(Ld.peak) + ' GW', pd.lab + ', ' + pad2(Ld.ip % 24) + ':00', C.pt) + tile('Energy', Ld.energy.toFixed(1) + ' TWh', 'target 429.1 TWh') + tile('Load factor', Ld.lf.toFixed(3)) + tile('Minimum', gw2(Ld.min) + ' GW') + '</div>';
    h += '<p>Computed in your browser from the hourly estimate the simulation runs on. The peak matches the 2025 figure of 77.08 GW the model is scaled to, and the annual energy is <b>' + Ld.energy.toFixed(1) + ' TWh</b> against the 429.1 TWh its one free parameter is calibrated to (the mean over realisations; this is one realisation). The mean load in June to August is <b>' + (Ld.summer / Ld.winter).toFixed(2) + '×</b> that of December to February, and in July and August Fridays run at <b>' + Ld.friJA.toFixed(2) + '</b> of the other days.</p>';
    h += '<p>As an independent check the paper counts the hours near the peak: <b>' + Ld.near + '</b> hours lie above the dashed line at ' + gw2(Ld.thr) + ' GW, the 2019 margin of 3 GW below a 62.1 GW peak scaled to 77.08 GW (ECRA reports 76 such hours for 2019); ' + Ld.near3 + ' lie within an unscaled 3 GW.</p>';
    h += '<p>The shaded band marks the 70-day window that the reconstruction above runs on. Its mean load is <b>' + gw2(Ld.winMean) + ' GW</b>, against ' + gw2(Ld.summer) + ' GW in June to August, ' + (Ld.summer / Ld.winMean).toFixed(2) + ' times more. The costs of Table III are summed over the whole year, so the high-load months count as well as this winter window.</p>';
    h += '<p class="ins-hint">Hover for a day, click to read it. With the chart focused: <kbd>←</kbd><kbd>→</kbd> one day, <kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd> one week, <kbd>Esc</kbd> clear.</p>';
    setInsight('loadInsight', { pill: 'Load overview', html: h, flash });
    return;
  }
  const x = Ld.days[d]; let nn = 0; for (let k = 0; k < 24; k++) if (Ld.mw[d * 24 + k] > Ld.thr) nn++;
  let h = '<div class="ins-grid">' + tile('Daily peak', gw2(x.hi) + ' GW', pad2(x.hHi) + ':00', C.pt) + tile('Daily mean', gw2(x.mean) + ' GW', '', C.solar) + tile('Daily minimum', gw2(x.lo) + ' GW', pad2(x.hLo) + ':00') + tile('Peak rank', x.rank + ' of ' + Ld.days.length, '1 = highest') + '</div>';
  h += '<p><b>' + x.lab + '</b> is ' + (x.fri ? 'a Friday, when the model reduces the load by 10 to 15%' : 'a working day') + '. The load swings from ' + gw2(x.lo) + ' GW at ' + pad2(x.hLo) + ':00 to ' + gw2(x.hi) + ' GW at ' + pad2(x.hHi) + ':00' + (x.hHi >= 11 && x.hHi <= 15 ? ', a midday peak that PV output helps to cover.' : x.hHi >= 17 ? ', an evening peak after PV output has faded.' : '.') + (nn ? ' ' + nn + ' of its hours are above the near-peak line.' : '') + '</p>';
  if (d >= Ld.win[0] && d < Ld.win[1]) h += '<p>This day lies inside the 70-day window of the live reconstruction above.</p>';
  setInsight('loadInsight', { pill: 'Load · ' + x.lab, html: h, focused: true, flash, onReset: () => { state.focus.load = null; drawLoadOverlay(); renderLoadInsight(true); } });
}

/* ================= badge popovers ================= */
const pop = $('pop'); let popFor = null;
function median(a) { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; }
function popHTML(kind) {
  const r = state.res, where = engine.mode === 'worker' ? 'in a Web Worker, off the main thread, so the page stays responsive while it runs' : 'on the main thread (Web Workers are unavailable here, for example when the page is opened from disk)';
  if (kind === 'solve') {
    if (!r) return '<h3>Last solve</h3><p>The first scenario is still running.</p>';
    const tm = r.tm, lg = state.solveLog;
    return '<h3>Last solve · timing breakdown</h3><table>' +
      '<tr><td>STMAC longitude sheaf (headline)</td><td>' + fmtMs(tm.stl) + '</td></tr><tr><td>STMAC trivial sheaf</td><td>' + fmtMs(tm.stt) + '</td></tr>' +
      '<tr><td>STMAC without prior (S0)</td><td>' + fmtMs(tm.s0) + '</td></tr><tr><td>GraphTRSS + MDV (all ' + (r.gtN || 0).toLocaleString('en-US') + ' cells)</td><td>' + fmtMs(tm.gt) + '</td></tr>' +
      '<tr><td>Pure temporal (11 banded solves)</td><td>' + fmtMs(tm.pt) + '</td></tr><tr><td>Outage mask</td><td>' + fmtMs(tm.mask) + '</td></tr>' +
      '<tr><td>Climatology fill + error statistics</td><td>' + fmtMs(tm.mdv + tm.stats) + '</td></tr><tr><td>Total in the solver</td><td>' + fmtMs(tm.total) + '</td></tr>' +
      '<tr><td>Round trip incl. data transfer</td><td>' + fmtMs(r.wall) + '</td></tr></table>' +
      '<p>Everything ran ' + where + '. This session has run <b>' + lg.length + '</b> scenario' + (lg.length === 1 ? '' : 's') + '; the median headline solve is <b>' + fmtMs(median(lg.map(x => x.ms))) + '</b>.</p>' +
      '<p>For scale, the paper assembles and solves Eq. (6) in 0.54 s for one year of 5-minute synthetic data with 3-day blocks at 11 stations and in 5.8 s at 100 stations, with sparse LU on a laptop CPU, a scaling of N<sup>1.08</sup> (Section IV-D). This page solves the 70-day window with a banded Cholesky factorisation, which gives the same exact solution.</p>';
  }
  if (kind === 'params') return '<h3>Trained parameters · 0</h3><p>STMAC has no training set and no fitted model. This session has run <b>' + state.solveLog.length + '</b> reconstruction' + (state.solveLog.length === 1 ? '' : 's') + '; each one recomputed the climatology from the observed cells of its own mask and solved the system from scratch, with nothing learned or carried over between runs. The GraphTRSS + MDV baseline run next to it is training-free as well; the recent graph methods of Table II and STMAC share that property, and the Transformer is the only learned model in the comparison.</p>';
  if (kind === 'weights') {
    const paper = state.r === R_RATIO && state.g === RIDGE;
    return '<h3>Weights</h3><p>In use now: <b>r = ' + state.r + ', g = ' + state.g + '</b>' + (paper ? ', the pair the paper selects by block cross-validation on observed cells.' : '. The paper’s cross-validated pair is r = 1000, g = 3.') + '</p><p>Only two ratios of Eq. (5) matter: r = α<sub>t</sub>/α<sub>s</sub> sets how much temporal smoothness counts against neighbour agreement, and g = γ/α<sub>s</sub> sets how strongly long gaps are pulled back to the climatology (g → ∞ recovers it).</p>' +
      '<p>Selection (Section IV-D): for each outage length, 5% of the observed cells are hidden in blocks of that length and the error on the hidden daytime cells is averaged over the seven lengths. Over r ∈ {10, 10², 10³, 10⁴} and g ∈ {0, 0.3, 1, 3, 10, 30} this picks r = 10³, g = 3 on the 1999 network; on the 2019 satellite-derived field it picks r = 10 with g = 1.0 (N = 11) and g = 0.3 (N = 25, 50).</p><p>On that field STMAC then averages 77.8, 72.5 and 66.5 W/m² for N = 11, 25 and 50, below the climatology (92.8, 91.7, 88.0) and low-rank completion (99.4, 84.7, 75.5) at all lengths and sizes, while the 1999 weights without reselection are worse at every length (Section VI-E): the selection procedure transfers, the weight values do not. GraphTRSS + MDV keeps its own cross-validated weights, ν = ' + GT_NU + ', ε = ' + GT_EPS + ', β = 1 (notebook E14).</p>' +
      (paper ? '' : '<div class="ins-actions">' + actBtn('Reset to r = 1000, g = 3', 'data-act="reset-weights"') + '</div>');
  }
  if (kind === 'unknowns') {
    if (!r) return '<h3>Unknown cells</h3><p>The first scenario is still running.</p>';
    const band = r.n * (r.bw + 1), dense = r.n * r.n;
    return '<h3>Unknown cells · ' + r.n.toLocaleString('en-US') + '</h3><table>' +
      '<tr><td>Unknowns n (removed cells)</td><td>' + r.n.toLocaleString('en-US') + '</td></tr><tr><td>Half-bandwidth</td><td>' + r.bw + ' (limit 2N = ' + 2 * N + ')</td></tr>' +
      '<tr><td>Band storage n·(bw+1)</td><td>' + band.toLocaleString('en-US') + ' (' + (band * 8 / 1e6).toFixed(1) + ' MB)</td></tr>' +
      '<tr><td>Dense storage n²</td><td>' + (dense / 1e6).toFixed(0) + ' M (' + (dense * 8 / 1e9).toFixed(1) + ' GB)</td></tr>' +
      '<tr><td>Factorisation work ≈ n·bw²</td><td>' + (r.n * r.bw * r.bw / 1e6).toFixed(1) + ' M</td></tr></table>' +
      '<p>Ordering the unknowns by (time, station) keeps the system of Eq. (6) banded, which is why one exact Cholesky factorisation fits in a browser tab. GraphTRSS + MDV fits observed cells instead of fixing them, so its system covers all ' + (r.gtN || 0).toLocaleString('en-US') + ' cells (half-bandwidth ' + r.gtBw + '); it is solved the same way.</p>';
  }
  return '<h3>Transformer baseline</h3><p>The deep-learning baseline of Section V-C is a four-layer encoder (d<sub>model</sub> = 64, 4 heads, feed-forward width 128) with <b>136,075</b> trained parameters, trained for <b>25</b> epochs with random masks on daily windows of 288 samples from the first 70% of the record. Training took 47 minutes on a laptop CPU, so avoiding it saves little energy; the gain of a training-free method is that new stations need no retraining or curated history.</p><p>Because its training period is inside the full-year evaluation, the paper repeats the comparison on the held-out 7 Nov to 31 Dec period, where STMAC is lower at all seven lengths by 22 to 45 W/m² in 30 of 30 realisations. In the unit-commitment simulation at 40 GW its error costs $3.88M a year against $2.00M for STMAC (Table III). Its figures on this page are quoted from the paper; the page does not run it.</p>';
}
function openPop(btn) {
  const kind = btn.dataset.pop;
  if (popFor === btn) { closePop(); return; }
  closePop();
  pop.querySelector('.pop-body').innerHTML = popHTML(kind); pop.hidden = false; popFor = btn; btn.setAttribute('aria-expanded', 'true');
  /* open below the whole badge strip so the popover never covers another badge */
  const rc = btn.getBoundingClientRect(), strip = (btn.closest('.console-strip') || btn).getBoundingClientRect();
  const pw = pop.offsetWidth, vw = document.documentElement.clientWidth;
  const left = Math.max(12, Math.min(rc.left + window.scrollX, window.scrollX + vw - pw - 12));
  pop.style.left = left + 'px'; pop.style.top = (strip.bottom + window.scrollY + 8) + 'px';
  scheduleStamp();
}
function closePop() { if (!popFor) return; popFor.setAttribute('aria-expanded', 'false'); popFor = null; pop.hidden = true; }
function refreshPop() { if (popFor) pop.querySelector('.pop-body').innerHTML = popHTML(popFor.dataset.pop); }
document.querySelectorAll('.badge[data-pop]').forEach(b => { b.setAttribute('aria-expanded', 'false'); b.addEventListener('click', e => { e.stopPropagation(); openPop(b); }); });
pop.querySelector('.pop-x').addEventListener('click', closePop);
document.addEventListener('click', e => { if (popFor && !pop.contains(e.target)) closePop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && popFor) { const b = popFor; closePop(); b.focus(); } });
window.addEventListener('resize', closePop, { passive: true });

/* ================= delegated actions inside insights and popovers ================= */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act === 'station') selectStation(+a.dataset.v, true);
  else if (act === 'gap') { state.gapIdx = +a.dataset.g; state.pin = null; drawTS(); renderTsInsight(true); }
  else if (act === 'block') setBlock(+a.dataset.k);
  else if (act === 'reset-weights') { state.r = R_RATIO; state.g = RIDGE; buildWeightChips(); onSettingsChanged(); closePop(); }
});

/* ================= controls ================= */
function onSettingsChanged() {
  $('bWeights').textContent = 'r = ' + state.r + ' · g = ' + state.g;
  requestScenario();
  if (state.sweep) { drawSweep(); renderSweepInsight(); }
}
function setBlock(k) { state.blockIdx = k; buildChips(); requestScenario(); }
function buildDsChips() {
  const el = $('dsChips'); el.innerHTML = '';
  [['real', 'Real 1999 NLR record · 70 days'], ['syn', 'Synthetic weather']].forEach(([k, lab]) => {
    const c = document.createElement('button'); c.type = 'button';
    c.className = 'chip' + (state.dataset === k ? ' on' : ''); c.textContent = lab; c.setAttribute('aria-pressed', state.dataset === k ? 'true' : 'false');
    c.addEventListener('click', async () => {
      if (state.dataset === k) return;
      state.dataset = k; buildDsChips();
      if (await loadDataset(k)) { drawLegend(); requestScenario(); }
    });
    el.appendChild(c);
  });
  scheduleStamp();
}
function buildChips() {
  const el = $('blockChips'); el.innerHTML = '';
  BLOCKS.forEach((b, i) => {
    const c = document.createElement('button'); c.type = 'button';
    c.className = 'chip' + (i === state.blockIdx ? ' on' : ''); c.textContent = b.lab; c.setAttribute('aria-pressed', i === state.blockIdx ? 'true' : 'false');
    c.addEventListener('click', () => { if (state.blockIdx !== i) setBlock(i); });
    el.appendChild(c);
  });
  scheduleStamp();
}
function buildWeightChips() {
  const er = $('rChips'), eg = $('gChips'); er.innerHTML = ''; eg.innerHTML = '';
  const lab = document.createElement('span'); lab.className = 'chip-lab'; lab.textContent = 'r (time vs. space)'; er.appendChild(lab);
  R_CHOICES.forEach(v => { const c = document.createElement('button'); c.type = 'button'; c.className = 'chip' + (v === state.r ? ' on' : ''); c.setAttribute('aria-pressed', v === state.r ? 'true' : 'false');
    c.textContent = String(v); c.title = 'ratio of the temporal smoothness weight to the spatial weight';
    c.addEventListener('click', () => { if (state.r === v) return; state.r = v; buildWeightChips(); onSettingsChanged(); }); er.appendChild(c); });
  const lab2 = document.createElement('span'); lab2.className = 'chip-lab'; lab2.textContent = 'g (pull toward climatology)'; eg.appendChild(lab2);
  G_CHOICES.forEach(v => { const c = document.createElement('button'); c.type = 'button'; c.className = 'chip' + (v === state.g ? ' on' : ''); c.setAttribute('aria-pressed', v === state.g ? 'true' : 'false');
    c.textContent = String(v); c.title = 'g = γ/αs, the ridge weight: larger values keep long gaps closer to the station climatology';
    c.addEventListener('click', () => { if (state.g === v) return; state.g = v; buildWeightChips(); onSettingsChanged(); }); eg.appendChild(c); });
  scheduleStamp();
}
$('fracSlider').addEventListener('input', e => { $('fracVal').textContent = e.target.value + '%'; });
$('fracSlider').addEventListener('change', e => { state.frac = +e.target.value / 100; onSettingsChanged(); });
$('reseedBtn').addEventListener('click', async () => {
  state.maskSeed = (state.maskSeed + 7919) >>> 0;
  if (state.dataset === 'syn') { state.seed = (state.seed * 1664525 + 1013904223) >>> 0; if (!(await loadDataset('syn'))) return; }
  $('sweepStatus').textContent = state.dataset === 'syn' ? 'weather regenerated — run the sweep again to refresh the curves.' : 'new outage placement drawn — run the sweep again to refresh the curves.';
  onSettingsChanged();
});
$('sweepBtn').addEventListener('click', runSweep);
$('prevGap').addEventListener('click', () => { if (!state.res) return; const g = gapsOf(state.sel).length; if (!g) return; state.gapIdx = (state.gapIdx - 1 + g) % g; state.pin = null; drawTS(); renderTsInsight(true); });
$('nextGap').addEventListener('click', () => { if (!state.res) return; const g = gapsOf(state.sel).length; if (!g) return; state.gapIdx = (state.gapIdx + 1) % g; state.pin = null; drawTS(); renderTsInsight(true); });
$('srcPaper').addEventListener('click', () => setEconSrc('paper'));
$('srcLive').addEventListener('click', () => setEconSrc('live'));
document.querySelectorAll('#econView .chip').forEach(b => b.addEventListener('click', () => { if (state.econ.view !== b.dataset.view) setEconView(b.dataset.view); }));
['gwSlider', 'penSlider', 'outSlider'].forEach(id => $(id).addEventListener('input', scheduleEcon));

/* ================= resize, fonts, hero ================= */
function redrawAll() { drawTS(); drawSweep(); updateEcon(); drawLoad(); }
if (window.ResizeObserver) {
  const map = new Map([['tsChart', drawTS], ['sweepChart', drawSweep], ['costChart', updateEcon], ['loadChart', drawLoad]]);
  const pending = new Set(); let raf = 0;
  const ro = new ResizeObserver(entries => {
    for (const en of entries) { const cv = en.target.querySelector('canvas:not(.ov)'); if (cv && cv._w !== Math.max(40, en.target.clientWidth)) pending.add(map.get(cv.id)); }
    if (pending.size && !raf) raf = requestAnimationFrame(() => { raf = 0; pending.forEach(f => f && f()); pending.clear(); });
  });
  document.querySelectorAll('.chart-box').forEach(b => ro.observe(b));
} else {
  let rsz; window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(redrawAll, 150); });
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawAll);
const header = document.querySelector('header');
if (window.IntersectionObserver && header) new IntersectionObserver(es => es.forEach(e => header.classList.toggle('offscreen', !e.isIntersecting))).observe(header);
const heroStage = $('heroStage');
if (heroStage && !reduceMotion && window.matchMedia && window.matchMedia('(pointer:fine)').matches) {
  let raf = 0, px = 0, py = 0;
  const wide = window.matchMedia('(min-width: 821px)');
  heroStage.addEventListener('pointermove', e => {
    if (!wide.matches) return; /* the small-screen layout scales the stage with its own transform */
    const r = heroStage.getBoundingClientRect(); px = (e.clientX - r.left) / r.width - .5; py = (e.clientY - r.top) / r.height - .5;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; heroStage.style.transform = 'rotateX(' + (-py * 8).toFixed(2) + 'deg) rotateY(' + (px * 10).toFixed(2) + 'deg)'; });
  });
  heroStage.addEventListener('pointerleave', () => { heroStage.style.transform = ''; });
}

/* ================= test ids (stamped when idle, not on every DOM mutation) ================= */
let stampQueued = false;
function scheduleStamp() {
  if (stampQueued) return; stampQueued = true;
  const run = () => { stampQueued = false;
    document.querySelectorAll('button,input,details,[role="button"],canvas,svg').forEach((el, i) => {
      if (!el.dataset.testid) { const raw = (el.id || el.getAttribute('aria-label') || el.textContent || el.tagName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48); el.dataset.testid = raw + '-' + i; }
    }); };
  (window.requestIdleCallback || (f => setTimeout(f, 200)))(run);
}

/* ================= boot ================= */
engine.init();
drawMap(); buildDsChips(); buildChips(); buildWeightChips(); buildUcChips(); drawLegend(); buildSweepLegend(); updateChartHead();
drawTS(); drawSweep(); updateEcon(); drawLoad(); renderLoadInsight(); renderMapInsight(); renderTsInsight(); renderMetricInsight(); renderSweepInsight();
scheduleStamp();
loadDataset('real').then(ok => { if (ok) requestScenario(); });
window.STMAC = { state, engine, pool, get data() { return DATA; } }; /* handle for debugging and automated tests */
})();

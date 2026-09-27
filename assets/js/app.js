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
const { STATIONS, N, SPD, TZ, REALMETA, BLOCKS, R_RATIO, RIDGE, GRAPH_K, GRAPH_SIGMA, DAY_CS } = Core;
const VERSION = '20260927';
const R_CHOICES = [10, 100, 1000, 10000], G_CHOICES = [0, 0.3, 1, 3, 10, 30];
/* Paper, Table II basis: full-year means over 20 masks, averaged over the seven block
   lengths (W/m2). Cloudy-cell means come from the ten shared masks of Section V-F;
   the Transformer and pure-temporal baselines were not evaluated on that subset. */
const PAPER = { pt: 1208.6, tf: 210.2, mdv: 163.7, stmac: 146.9, mdvCloudy: 292.5, stmacCloudy: 246.0, mdv3d: 166.2, stmac3d: 163.3, pt3d: 1904 };
/* Paper, Table I (full year, 20 masks); k = index into BLOCKS */
const TABLE1 = [
  { lab: '30 min', k: 0, pt: 70, mdv: 162.0, tf: 153.0, stmac: 89.6 },
  { lab: '2 h', k: 1, pt: 114, mdv: 162.5, tf: 165.6, stmac: 140.0 },
  { lab: '6 h', k: 2, pt: 239, mdv: 163.2, tf: 201.3, stmac: 154.4 },
  { lab: '1 day', k: 4, pt: 727, mdv: 160.8, tf: 229.9, stmac: 157.4 },
  { lab: '3 days', k: 5, pt: 1904, mdv: 166.2, tf: 250.7, stmac: 163.3 },
  { lab: '7 days', k: 6, pt: 4961, mdv: 169.1, tf: 251.8, stmac: 166.5 }];
const CLOUDY_K = 0.70;       /* paper: cloudy = daily clear-sky index at most 0.70 */
const PHYS_MAX = 1400;       /* paper: clipping range [0, 1400] W/m2 */
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
  line2: cvar('--line2') || '#3a4658', mdv: cvar('--mdv') || '#7fc97f', tf: cvar('--tf') || '#c9a2ff', goldHi: cvar('--gold-hi') || '#f5d76e' };
function rgba(hex, a) { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
const METHODS = {
  PT: { key: 'PT', lab: 'Pure temporal', short: 'Pure temporal', color: () => C.pt, show: 'showPT', r: 'rPT', card: 'cPT' },
  MDV: { key: 'MDV', lab: 'Station climatology (MDV)', short: 'Climatology', color: () => C.mdv, show: 'showMDV', r: 'rMDV', card: 'cAdv' },
  STT: { key: 'STT', lab: 'STMAC · trivial sheaf', short: 'STMAC trivial', color: () => C.triv, show: 'showTriv', r: 'rSTT', card: 'cSTT' },
  STL: { key: 'STL', lab: 'STMAC · longitude sheaf', short: 'STMAC', color: () => C.stmac, r: 'rSTL', card: 'cSTL' } };
const MKEYS = ['STL', 'MDV', 'PT', 'STT'];

/* ================= state ================= */
const state = { seed: 42, maskSeed: 11, blockIdx: 5, frac: 0.10, sel: 0, gapIdx: 0, dataset: 'real',
  showTriv: false, showPT: true, showMDV: true, econSrc: 'live', res: null, sweep: null,
  r: R_RATIO, g: RIDGE, emph: null, pin: null,
  focus: { map: null, metric: null, sweep: null, cost: null }, solveLog: [] };
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
    corr: { aligned: out.corrAligned, clock: out.corrClock, n: out.corrN, daily: out.corrDaily }, kDaily: out.kDaily };
  loadingDs = false;
  state.res = null; /* results of the previous dataset no longer match these arrays */
  updateChartHead(); drawTS(); renderTsInsight(); renderMetricInsight();
  const d = $('disclose');
  d.innerHTML = kind === 'real'
    ? 'You are looking at the <b>real 1999 Saudi NLR record</b> — 70 days (' + REALMETA.label + '), 11 stations, 5-minute GHI, shipped with this page (' + REALMETA.fillPct + '% of rows were absent from the all-valid record and were linearly interpolated before embedding). Timestamps are Saudi local clock (UTC+3); station identities were verified by solar-noon inference from the data itself; map coordinates are approximate. Full-year benchmark numbers are quoted from Table I of the paper in the panel below; this 70-day window overlaps the held-out November–December period, so the live errors here are lower than the full-year ones.'
    : 'The synthetic mode runs on <b>physics-based synthetic irradiance</b> — true solar geometry per station latitude/longitude plus spatially correlated moving cloud fronts — so the solver behaviour is real even though the weather is simulated. Switch to the real 1999 NLR record for the genuine article.';
  $('sweepStatus').textContent = kind === 'real'
    ? 'Press “Run full block-length sweep” — 21 solver runs on 70 days of real data, a few seconds.'
    : 'Press “Run full block-length sweep” — ~21 solver runs, a few seconds.';
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
  const res = { params: out.params, effFrac: out.effFrac, nb: out.nb, n: out.n, bw: out.bw, ms: out.ms, tm: out.tm, wall,
    rPT: out.rPT, rMDV: out.rMDV, rSTL: out.rSTL, rSTT: out.rSTT, stats: out.stats, T,
    M: views(out.M, T), PT: views(out.PT, T), MDV: views(out.MDV, T), STL: views(out.STL, T), STT: views(out.STT, T), _gaps: [], _gapStats: [] };
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
    if (CS[i] <= DAY_CS) continue;
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
  return k <= CLOUDY_K ? 'at or below the paper’s cloudy threshold of 0.70' : 'above the paper’s cloudy threshold of 0.70';
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
  let h = '<div class="t">' + stn(v) + '</div>' + tipRow('Location', s.lat.toFixed(2) + '°N ' + s.lon.toFixed(2) + '°E') + tipRow('Solar noon ≈', hm(solarNoonClock(v)) + ' clock');
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
    let se = 0, ne = 0, sn = 0, nn = 0;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { if (!isNum(A[i][j])) continue; if (W[i][j] > 0) { se += A[i][j]; ne++; } else { sn += A[i][j]; nn++; } }
    const noons = STATIONS.map((s, v) => solarNoonClock(v)), lo = Math.min(...noons), hi = Math.max(...noons);
    const vLo = noons.indexOf(hi), vHi = noons.indexOf(lo);
    let h = '<div class="ins-grid">' + tile('Stations', N) + tile('Graph edges', EDGES.length, 'k = ' + GRAPH_K + ', symmetrised') +
      tile('Edge length', Math.round(Math.min(...ds)) + '–' + Math.round(Math.max(...ds)) + ' km', 'mean ' + Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) + ' km') +
      tile('Weights w', Math.min(...ws).toFixed(2) + '–' + Math.max(...ws).toFixed(2), 'σ = ' + GRAPH_SIGMA + ' km') + '</div>';
    h += '<p>Solar noon falls between <b>' + hm(lo) + '</b> (' + STATIONS[vHi].code + ') and <b>' + hm(hi) + '</b> (' + STATIONS[vLo].code + ') on the local clock, a spread of <b>' + Math.round(hi - lo) + ' min</b>. That offset is what the longitude sheaf removes before neighbours are compared.</p>';
    h += '<p>In the ' + (DATA.kind === 'real' ? '70-day 1999 record' : 'synthetic weather') + ', the 5-minute departures from each station’s own climatology correlate at <b>' + f2(se / ne) + '</b> on average across graph edges and <b>' + f2(sn / nn) + '</b> across non-adjacent pairs (solar-time aligned, daytime cells). ' +
      (se / ne < 0.15 ? 'Neighbours share little signal beyond the diurnal cycle at this resolution, which limits what the spatial coupling can add over the climatology.' : se / ne < 0.4 ? 'Neighbours share a moderate part of their departures, which is the signal STMAC uses to correct the climatology.' : 'Neighbours share much of their departures, so the spatial coupling has real signal to work with.') + '</p>';
    h += '<p class="ins-hint">Hover a station or an edge for values; click one to read it. Stations and edges are also reachable with <kbd>Tab</kbd>.</p>';
    setInsight('mapInsight', { pill: 'Network overview', html: h, flash });
    return;
  }
  if (f.type === 'station') {
    const v = f.v, s = STATIONS[v], sh = Core.lonShift(v), nbs = neighbours(v), r = state.res;
    let best = -1, bestR = -2; for (let u = 0; u < N; u++) if (u !== v && isNum(A[v][u]) && A[v][u] > bestR) { bestR = A[v][u]; best = u; }
    const kd = DATA.kDaily[v]; let cloudy = 0, km = 0; for (const k of kd) { km += k; if (k <= CLOUDY_K) cloudy++; } km /= kd.length;
    let h = '<div class="ins-grid">';
    if (r) {
      const st = r.stats, gaps = gapsOf(v); let miss = 0; for (const [a, b] of gaps) miss += b - a;
      h += tile('STMAC', f0(st.STL.st[v].rmse) + ' W/m²', 'bias ' + sg(st.STL.st[v].bias) , C.stmac) + tile('Climatology', f0(st.MDV.st[v].rmse) + ' W/m²', 'bias ' + sg(st.MDV.st[v].bias), C.mdv) +
        tile('Pure temporal', f0(st.PT.st[v].rmse) + ' W/m²', '', C.pt) + tile('Missing', (100 * miss / r.T).toFixed(1) + '%', gaps.length + ' gap' + (gaps.length === 1 ? '' : 's') + ', ' + st.STL.st[v].n.toLocaleString('en-US') + ' scored');
    }
    h += '</div><p><b>' + stn(v) + '</b> sits at ' + s.lat.toFixed(2) + '°N, ' + s.lon.toFixed(2) + '°E. Its solar noon is near <b>' + hm(solarNoonClock(v)) + '</b> local clock (equation of time ignored), so the longitude sheaf moves its record <b>' + Math.abs(sh * 5) + ' min ' + (sh < 0 ? 'earlier' : sh > 0 ? 'later' : '(no shift)') + '</b> (' + Math.abs(sh) + ' sample' + (Math.abs(sh) === 1 ? '' : 's') + ') before comparing it with its neighbours.</p>';
    h += '<p>Graph neighbours: ' + nbs.map(n => '<b>' + STATIONS[n.u].code + '</b> (' + Math.round(n.d) + ' km, w = ' + n.w.toFixed(2) + ', r = ' + f2(A[v][n.u]) + ')').join(', ') + '.' + (best >= 0 ? ' Its strongest departure correlation is with <b>' + STATIONS[best].code + '</b> (r = ' + f2(bestR) + '), ' + (W[v][best] > 0 ? 'which is one of its graph neighbours.' : 'which is <b>not</b> one of its graph neighbours: the k-NN graph is built from distance alone.') : '') + ' Here r is the correlation of 5-minute departures from the climatology (solar-time aligned, daytime cells).</p>';
    h += '<p>Over the ' + kd.length + ' days, the station received on average <b>' + (100 * km).toFixed(0) + '%</b> of the clear-sky model’s energy; <b>' + cloudy + '</b> day' + (cloudy === 1 ? '' : 's') + ' fall at or below the paper’s cloudy threshold (daily clear-sky index ≤ 0.70, computed here with this page’s simple clear-sky model).</p>';
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
  const v = tsGeom.v, q = gapIndexAt(v, i), day = DATA.CS[v][i] > DAY_CS;
  let h = '<div class="t">' + whenLab(i) + ' clock · solar ≈ ' + hm(solarMin(v, i)) + '</div>';
  const u = DATA.U[v][i];
  for (const s of tsSeries()) {
    const val = valAt(s.k, v, i);
    h += tipRow(s.lab, f0(val) + (s.k !== 'U' && q >= 0 ? ' <span style="color:var(--muted)">(' + sg(val - u) + ')</span>' : ''), s.c);
  }
  h += '<div class="n">' + (q >= 0 ? 'Inside gap ' + (q + 1) + ' (' + fmtDur(gapsOf(v)[q][1] - gapsOf(v)[q][0]) + '); brackets = estimate − measured' : 'Observed cell, not scored') + (day ? '' : ' · night, excluded from RMSE') + '</div>';
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
  const statTiles = (gs, withBias) => '<div class="ins-grid">' + MKEYS.filter(k => k !== 'STT' || state.showTriv).map(k => tile(METHODS[k].short, f0(gs.rmse[k]) + ' W/m²', withBias ? 'bias ' + sg(gs.bias[k]) : '', METHODS[k].color())).join('') + '</div>';
  if (state.pin && state.pin.v === v) {
    const i = state.pin.i, q = gapIndexAt(v, i), u = DATA.U[v][i], cs = DATA.CS[v][i], k = dayIndexK(v, i);
    let h = '<div class="ins-grid">' + tile('Measured', f0(u) + ' W/m²', 'clear-sky ' + f0(cs), C.solar);
    for (const m of MKEYS) { if ((m === 'STT' && !state.showTriv) || (m === 'PT' && !state.showPT) || (m === 'MDV' && !state.showMDV)) continue;
      const e = r[m][v][i] - u; h += tile(METHODS[m].short, f0(r[m][v][i]), q >= 0 ? 'error ' + sg(e) : '', METHODS[m].color()); }
    h += '</div><p><b>' + whenLab(i) + '</b> local clock at <b>' + stn(v) + '</b> (solar time ≈ ' + hm(solarMin(v, i)) + '). ';
    if (cs <= DAY_CS) h += 'The clear-sky model is below ' + DAY_CS + ' W/m² here, so this is a night-time cell and it is excluded from every RMSE on the page.';
    h += '</p>';
    if (q >= 0) {
      const [s0, s1] = gaps[q], errs = MKEYS.filter(m => m !== 'STT' || state.showTriv).map(m => [m, Math.abs(r[m][v][i] - u)]).sort((x, y) => x[1] - y[1]);
      h += '<p>This cell is <b>' + fmtDur(i - s0) + '</b> into gap ' + (q + 1) + ' of ' + gaps.length + ' (length ' + fmtDur(s1 - s0) + '). ' + (cs > DAY_CS ? 'The closest estimate at this instant is <b>' + METHODS[errs[0][0]].short + '</b>, off by ' + f0(errs[0][1]) + ' W/m²; the furthest is ' + METHODS[errs[errs.length - 1][0]].short + ' at ' + f0(errs[errs.length - 1][1]) + ' W/m².' : '') + '</p>';
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
  h += '<p><b>Gap ' + (state.gapIdx + 1) + ' of ' + gaps.length + '</b> at <b>' + stn(v) + '</b> starts ' + whenLab(s0) + ' and lasts <b>' + fmtDur(s1 - s0) + '</b> (' + gs.n.toLocaleString('en-US') + ' cells, ' + gs.nDay.toLocaleString('en-US') + ' in daylight).';
  if (!gs.nDay) { h += ' It falls entirely at night, so no method is scored on it.</p>'; }
  else {
    const rk = MKEYS.filter(k => k !== 'STT' || state.showTriv).sort((x, y) => gs.rmse[x] - gs.rmse[y]);
    const dcl = gs.rmse.MDV - gs.rmse.STL;
    h += ' Lowest error on this gap: <b>' + METHODS[rk[0]].short + '</b> (' + f0(gs.rmse[rk[0]]) + ' W/m²). STMAC is ' + (dcl >= 0 ? '<span class="hl">' + f1(dcl) + ' W/m² below</span>' : '<span class="neg">' + f1(-dcl) + ' W/m² above</span>') + ' the climatology here' +
      (Math.abs(gs.bias.STL) > 10 ? ' and ' + (gs.bias.STL > 0 ? 'overestimates' : 'underestimates') + ' the missing sunlight by ' + f0(Math.abs(gs.bias.STL)) + ' W/m² on average' : '') + '.</p>';
    if (isNum(gs.k)) h += '<p>During the gap’s daylight the sensor measured <b>' + (100 * gs.k).toFixed(0) + '%</b> of the clear-sky model’s energy (clear-sky index ' + gs.k.toFixed(2) + ', ' + skyPhrase(gs.k) + ').' + (gs.k <= CLOUDY_K ? ' Cloudy stretches are where a fixed diurnal prior misses most and neighbours can help.' : '') + '</p>';
    const all = allGapStats(v).map((x, q) => [q, x]).filter(x => x[1].nDay > 0);
    if (all.length > 1) {
      const byErr = all.slice().sort((x, y) => y[1].rmse.STL - x[1].rmse.STL), rank = byErr.findIndex(x => x[0] === state.gapIdx) + 1;
      h += '<p>Among this station’s ' + all.length + ' gaps with daylight, this one ranks <b>' + rank + '</b> by STMAC error (1 = hardest).</p><div class="ins-actions">' +
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
  { id: 'STT', lab: 'STMAC · trivial sheaf', color: () => C.triv, key: 'showTriv' }];
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
  if (p.r !== R_RATIO || p.g !== RIDGE) s += ' <b>Note:</b> the weights are set to r = ' + p.r + ', γ = ' + p.g + ', not the paper’s cross-validated pair (r = 1000, γ = 3); the readings above describe your setting, not the published one.';
  const rank = [['Pure temporal', r.rPT], ['Station climatology', r.rMDV], ['STMAC (trivial sheaf)', r.rSTT], ['STMAC (longitude sheaf)', r.rSTL]].sort((a, b) => a[1] - b[1]);
  s += '<br><b>Ranking for this scenario</b> (lower error is better): ' + rank.map((x, i) => (i + 1) + '. ' + x[0] + ' ' + Math.round(x[1]) + ' W/m²').join(' · ') + '.';
  s += ' In plain words: an error of ' + Math.round(r.rSTL) + ' W/m² means the repaired curve is typically off by about ' + Math.round(r.rSTL) + ' W per square metre of sensor during daylight, against a midday maximum near 900–1000 in this winter window.';
  return '<p>' + s + '</p><p class="ins-hint">Click a card for its per-station breakdown, or a Table I row to compare it with the live run.</p>';
}
function reconRange(key) {
  const r = state.res; let lo = Infinity, hi = -Infinity;
  for (let v = 0; v < N; v++) { const M = r.M[v], X = r[key][v]; for (let i = 0; i < r.T; i++) if (!M[i]) { const x = X[i]; if (x < lo) lo = x; if (x > hi) hi = x; } }
  return [lo, hi];
}
function renderMetricInsight(flash) {
  document.querySelectorAll('.card').forEach(c => c.setAttribute('aria-pressed', state.focus.metric && state.focus.metric.type === 'card' && state.focus.metric.m === c.dataset.m ? 'true' : 'false'));
  document.querySelectorAll('#refTable tr[data-k]').forEach(tr => tr.classList.toggle('sel', !!(state.focus.metric && state.focus.metric.type === 'row' && state.focus.metric.k === +tr.dataset.k)));
  if (!state.res) { setInsight('metricInsight', { pill: 'This scenario', html: '<p class="ins-hint">Solving the first scenario…</p>' }); return; }
  const f = state.focus.metric, r = state.res;
  const reset = () => { state.focus.metric = null; state.emph = null; drawTS(); renderMetricInsight(true); };
  if (!f) { setInsight('metricInsight', { pill: 'This scenario · ' + BLOCKS[r.params.blockIdx].lab, html: overviewMetricText(), flash }); return; }
  if (f.type === 'card') {
    const m = METHODS[f.m], st = r.stats[f.m], ref = f.m === 'STL' ? 'MDV' : 'STL', refSt = r.stats[ref];
    const vals = st.st.map((x, v) => ({ v, x: x.rmse, ref: refSt.st[v].rmse })).sort((a, b) => a.x - b.x);
    const max = Math.max(...vals.map(o => Math.max(o.x, o.ref))) * 1.05;
    let h = '<div class="ins-grid">' + tile('RMSE', f1(r[m.r]) + ' W/m²', '', m.color()) + tile('MAE', f1(st.mae) + ' W/m²') + tile('Mean bias', sg(st.bias, 1) + ' W/m²', st.bias > 0 ? 'overestimates' : 'underestimates') + tile('Cells scored', st.n.toLocaleString('en-US'), 'removed, daytime') + '</div>';
    h += '<div class="ins-bars" role="list">' + vals.map(o => '<button type="button" class="ins-bar' + (o.v === state.sel ? ' cur' : '') + '" data-act="station" data-v="' + o.v + '" role="listitem" title="Show ' + STATIONS[o.v].name + '"><span>' + STATIONS[o.v].code + ' · ' + STATIONS[o.v].name + '</span><span class="tr"><span class="fl" style="width:' + (100 * o.x / max).toFixed(1) + '%;background:' + m.color() + '"></span><span class="mk" style="left:' + (100 * o.ref / max).toFixed(1) + '%;background:' + METHODS[ref].color() + ';box-shadow:0 0 6px ' + METHODS[ref].color() + '"></span></span><span class="nv">' + f0(o.x) + '</span></button>').join('') + '</div>';
    h += '<p class="ins-note">Bars: ' + m.short + ' RMSE per station (W/m²). Tick: ' + METHODS[ref].short + ' at the same station. Click a row to open that station.</p>';
    const beat = vals.filter(o => f.m === 'STL' ? o.x < o.ref : o.ref < o.x).length;
    const best = vals[0], worst = vals[vals.length - 1];
    h += '<p>Across the 11 stations, ' + m.short + ' ranges from <b>' + f0(best.x) + '</b> (' + STATIONS[best.v].code + ') to <b>' + f0(worst.x) + ' W/m²</b> (' + STATIONS[worst.v].code + '). ';
    if (f.m === 'STL') {
      const d = vals.map(o => [o.v, o.ref - o.x]).sort((a, b) => b[1] - a[1]);
      h += 'STMAC is below the climatology at <b>' + beat + ' of 11</b> stations; the largest gain is at ' + STATIONS[d[0][0]].code + ' (' + f1(d[0][1]) + ' W/m²)' + (d[d.length - 1][1] < 0 ? ' and the largest loss at ' + STATIONS[d[d.length - 1][0]].code + ' (' + f1(-d[d.length - 1][1]) + ' W/m²).' : '.');
    } else h += 'STMAC is below it at <b>' + beat + ' of 11</b> stations.';
    const ratio = r[m.r] / st.mae;
    h += ' RMSE is <b>' + ratio.toFixed(2) + '×</b> the MAE; for normally distributed errors the ratio is about 1.25, so ' + (ratio > 1.4 ? 'a minority of large misses weighs heavily here.' : 'the misses are spread fairly evenly.') + '</p>';
    const [lo, hi] = reconRange(f.m);
    h += '<p>Inside the gaps its estimates run from <b>' + f0(lo) + '</b> to <b>' + f0(hi) + ' W/m²</b>' + (hi > PHYS_MAX || lo < -50 ? ', outside the [0, ' + PHYS_MAX + '] W/m² range the paper uses for clipping, a sign that the method has no physical anchor on gaps this long.' : ', inside the physical range.') + '</p>';
    setInsight('metricInsight', { pill: 'Method · ' + m.lab, html: h, focused: true, flash, onReset: reset });
    return;
  }
  /* Table I row */
  const row = TABLE1.find(x => x.k === f.k), p = r.params;
  const paperRank = [['Pure temporal', row.pt], ['Climatology', row.mdv], ['Transformer', row.tf], ['STMAC', row.stmac]].sort((a, b) => a[1] - b[1]);
  let h = '<div class="ins-grid">' + tile('Paper STMAC', f1(row.stmac), 'W/m²', C.stmac) + tile('Paper climatology', f1(row.mdv), 'margin ' + f1(row.mdv - row.stmac), C.mdv) + tile('Paper Transformer', f1(row.tf), '', C.tf) + tile('Paper pure temp.', f0(row.pt), '', C.pt) + '</div>';
  h += '<p>In the paper (full year, 20 masks) at <b>' + row.lab + '</b> blocks the lowest error is <b>' + paperRank[0][0] + '</b>; STMAC sits ' + f1(row.mdv - row.stmac) + ' W/m² below the climatology and ' + f1(row.tf - row.stmac) + ' W/m² below the trained Transformer.</p>';
  let live = null, src = '';
  const sw = state.sweep;
  if (p.blockIdx === row.k) { live = { pt: r.rPT, mdv: r.rMDV, sl: r.rSTL }; src = 'the scenario on screen'; }
  else if (sw && sw.rows[row.k] && !sweepStale()) { const q = sw.rows[row.k]; live = { pt: q.pt, mdv: q.mdv, sl: q.sl }; src = 'the live sweep'; }
  if (live) {
    const lr = [['Pure temporal', live.pt], ['Climatology', live.mdv], ['STMAC', live.sl]].sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const pr = paperRank.filter(x => x[0] !== 'Transformer').map(x => x[0]);
    h += '<p>From ' + src + ' (' + (DATA.kind === 'real' ? '70-day winter window' : 'synthetic weather') + ', one mask): STMAC <b>' + f1(live.sl) + '</b>, climatology <b>' + f1(live.mdv) + '</b>, pure temporal <b>' + f0(live.pt) + '</b> W/m². Live STMAC is <b>' + (live.sl / row.stmac).toFixed(2) + '×</b> the paper figure. The order of the three shared methods ' + (lr.join() === pr.join() ? '<span class="hl">matches</span> the paper (' + lr.join(' < ') + ').' : '<span class="neg">differs</span> from the paper: live ' + lr.join(' < ') + ', paper ' + pr.join(' < ') + '.') + '</p>';
  } else h += '<div class="ins-actions">' + actBtn('Run ' + row.lab + ' live', 'data-act="block" data-k="' + row.k + '"') + '</div>';
  setInsight('metricInsight', { pill: 'Table I · ' + row.lab, html: h, focused: true, flash, onReset: reset });
}
document.querySelector('.cards').addEventListener('click', e => {
  const c = e.target.closest('.card'); if (!c) return;
  const m = c.dataset.m, cur = state.focus.metric;
  if (cur && cur.type === 'card' && cur.m === m) { state.focus.metric = null; state.emph = null; }
  else { state.focus.metric = { type: 'card', m }; state.emph = m; const sk = METHODS[m].show; if (sk && !state[sk]) { state[sk] = true; drawLegend(); } }
  drawTS(); renderMetricInsight(true);
});
(function wireTable() {
  const t = $('refTable');
  const pick = tr => { const k = +tr.dataset.k, cur = state.focus.metric; state.emph = null; state.focus.metric = cur && cur.type === 'row' && cur.k === k ? null : { type: 'row', k }; drawTS(); renderMetricInsight(true); };
  t.addEventListener('click', e => { const tr = e.target.closest('tr[data-k]'); if (tr) pick(tr); });
  t.addEventListener('keydown', e => { const tr = e.target.closest('tr[data-k]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(tr); } });
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
  st.textContent = 'done — ' + (BLOCKS.length * 3) + ' solver runs in ' + fmtMs(sweep.ms) + (sweep.workers > 1 ? ' on ' + sweep.workers + ' workers' : '') + '. From 30-min to 7-day blocks, pure-temporal error grew ×' +
    (g.pt / f.pt).toFixed(0) + ' while STMAC grew ×' + (g.sl / f.sl).toFixed(1) +
    '. Pure temporal stays ahead until ' + xo + '. STMAC is below the station climatology at ' + win + ' of ' + rows.length +
    ' block lengths; on multi-day gaps the two nearly coincide, because the diurnal prior is doing most of the work.';
  drawSweep(); renderSweepInsight(); if (state.focus.metric && state.focus.metric.type === 'row') renderMetricInsight();
}
const SW_SERIES = [{ k: 'pt', m: 'PT', c: () => C.pt, dash: [6, 4], lw: 1.6 }, { k: 'mdv', m: 'MDV', c: () => C.mdv, dash: [4, 3], lw: 1.6 },
  { k: 'st', m: 'STT', c: () => C.triv, dash: [2, 3], lw: 1.3 }, { k: 'sl', m: 'STL', c: () => C.stmac, dash: null, lw: 2.2 }];
function drawSweep() {
  const cv = $('sweepChart'), h = boxH(cv);
  const { ctx, w } = sizeCanvas(cv, h); sizeCanvas($('sweepOv'), h);
  sweepGeom = null;
  const sw = state.sweep, rows = sw ? sw.rows : null, have = rows ? rows.filter(Boolean) : [];
  if (!have.length) { placeholder(ctx, w, h, sw ? 'Sweeping…' : 'Run the sweep to draw the curves'); return; }
  const L = 74, R = 14, Tp = 16, B = 34, pw = w - L - R, ph = h - Tp - B;
  let lo = 1e9, hi = 0;
  for (const r of have) { lo = Math.min(lo, r.pt, r.sl, r.st, r.mdv); hi = Math.max(hi, r.pt, r.sl, r.st, r.mdv); }
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
    ctx.fillStyle = C.stmac; ctx.fillText('STMAC ×' + (g.sl / f.sl).toFixed(1), L + 8, Y(g.sl) + 18);
    ctx.fillStyle = C.mdv; ctx.fillText('station climatology ×' + (g.mdv / f.mdv).toFixed(1), L + 8, Y(g.mdv) - 10);
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
  const staleNote = stale ? '<p class="ins-note">These curves were computed with r = ' + sw.params.r + ', γ = ' + sw.params.g + ', ' + Math.round(sw.params.frac * 100) + '% outage and mask seed ' + sw.params.maskSeed + '. The settings have changed since, so rerun the sweep to refresh them.</p>' : '';
  const f = state.focus.sweep;
  if (!f || !sw.rows[f.k]) {
    const have = sw.rows.map((r, i) => r ? i : -1).filter(i => i >= 0);
    if (!sw.done) { setInsight('sweepInsight', { pill: 'Sweep · running', html: '<p>' + have.length + ' of ' + BLOCKS.length + ' block lengths done' + (sw.workers > 1 ? ', ' + sw.workers + ' workers in parallel' : '') + '. Points appear as each block length finishes.</p>' }); return; }
    const rows = sw.rows, wins = rows.filter(r => r.sl < r.mdv).map(r => r.lab), losses = rows.filter(r => r.sl >= r.mdv).map(r => r.lab);
    const gaps = rows.map(r => r.mdv - r.sl);
    let h = '<p>STMAC is below the climatology at <b>' + wins.length + ' of ' + rows.length + '</b> block lengths' + (losses.length ? ' (not at ' + losses.join(', ') + ')' : '') + '. Its margin over the climatology runs from <b>' + sg(Math.max(...gaps), 1) + '</b> to <b>' + sg(Math.min(...gaps), 1) + ' W/m²</b> (positive = STMAC lower). Pure temporal ends <b>×' + (rows[6].pt / rows[6].sl).toFixed(1) + '</b> above STMAC at 7 days.</p>';
    h += '<p class="ins-hint">Hover for values, click a point to read that block length. With the chart focused: <kbd>←</kbd><kbd>→</kbd> block length, <kbd>↑</kbd><kbd>↓</kbd> method, <kbd>Enter</kbd> loads it above.</p>';
    setInsight('sweepInsight', { pill: 'Sweep overview', html: h + staleNote, flash });
    return;
  }
  const r = sw.rows[f.k], bl = BLOCKS[f.k], m = f.m, key = SW_SERIES.find(s => s.m === m).k, first = sw.rows[0];
  const rank = SW_SERIES.map(s => [s.m, r[s.k]]).sort((a, b) => a[1] - b[1]);
  let h = '<div class="ins-grid">' + SW_SERIES.slice().reverse().map(s => tile(METHODS[s.m].short, f1(r[s.k]), rank[0][0] === s.m ? 'lowest' : '', s.c())).join('') + '</div>';
  h += '<p>At <b>' + bl.lab + '</b> blocks (' + (100 * r.frac).toFixed(1) + '% of cells removed) the order is ' + rank.map(x => METHODS[x[0]].short + ' ' + f1(x[1])).join(' < ') + ' W/m². STMAC is ' + (r.mdv - r.sl >= 0 ? '<span class="hl">' + f1(r.mdv - r.sl) + ' W/m² (' + (100 * (r.mdv - r.sl) / r.mdv).toFixed(1) + '%) below</span>' : '<span class="neg">' + f1(r.sl - r.mdv) + ' W/m² above</span>') + ' the climatology, and pure temporal is <b>×' + (r.pt / r.sl).toFixed(1) + '</b> STMAC.</p>';
  if (first && f.k > 0) h += '<p>You selected <b>' + METHODS[m].short + '</b>: its error is <b>×' + (r[key] / first[key]).toFixed(1) + '</b> its 30-min value (' + f1(first[key]) + ' → ' + f1(r[key]) + ' W/m²).</p>';
  const row = TABLE1.find(x => x.k === f.k);
  if (row) h += '<p>Paper Table I at ' + row.lab + ' (full year, 20 masks): STMAC ' + f1(row.stmac) + ', climatology ' + f1(row.mdv) + ', Transformer ' + f1(row.tf) + ', pure temporal ' + f0(row.pt) + ' W/m². Live STMAC is <b>' + (r.sl / row.stmac).toFixed(2) + '×</b> the paper value on this ' + (sw.params.dataset === 'real' ? '70-day winter window' : 'synthetic run') + '.</p>';
  else h += '<p>Table I of the paper does not report ' + bl.lab + ' blocks; the live sweep adds it to fill the curve.</p>';
  const onScreen = state.res && state.res.params.blockIdx === f.k && !stale;
  h += '<div class="ins-actions">' + (onScreen ? '<span class="ins-note">This is the scenario shown in the reconstruction chart.</span>' : actBtn('Load ' + bl.lab + ' in the reconstruction chart', 'data-act="block" data-k="' + f.k + '"')) + '</div>';
  setInsight('sweepInsight', { pill: 'Sweep · ' + bl.lab + ' · ' + METHODS[m].short, html: h + staleNote, focused: true, flash, onReset: () => { state.focus.sweep = null; drawSweepOverlay(); renderSweepInsight(true); } });
}
function buildSweepLegend() {
  const el = $('sweepLegend'); el.innerHTML = '';
  const items = [['Pure temporal — per-station smoothing, no spatial info', C.pt, 'dash'], ['Station climatology (MDV) — mean diurnal cycle, ±15 days', C.mdv, 'dash'],
    ['STMAC · trivial sheaf — graph coupling, no time alignment', C.triv, 'dot'], ['STMAC · longitude sheaf — proposed, solar-time aligned', C.stmac, 'solid']];
  for (const [lab, col, styl] of items) {
    const s = document.createElement('span'); s.className = 'sl'; s.style.cursor = 'default';
    const bg = styl === 'solid' ? col : styl === 'dash' ? 'repeating-linear-gradient(90deg,' + col + ' 0 6px,transparent 6px 10px)' : 'repeating-linear-gradient(90deg,' + col + ' 0 3px,transparent 3px 6px)';
    s.innerHTML = '<span class="sw" style="background:' + bg + '"></span>' + lab; el.appendChild(s);
  }
}

/* ================= economics ================= */
function cost(gw, R, pen, out) { return gw * 1000 * (R / 1000) * out * 4380 * pen; }
let costGeom = [], costHover = -1, econRaf = 0;
function scheduleEcon() { if (!econRaf) econRaf = requestAnimationFrame(() => { econRaf = 0; updateEcon(); }); }
function econMethods() {
  if (state.econSrc === 'cloudy') return [{ lab: 'Station climatology (MDV) · cloudy cells', key: 'MDV', R: PAPER.mdvCloudy, c: C.mdv }, { lab: 'STMAC · cloudy cells', key: 'STL', R: PAPER.stmacCloudy, c: C.stmac }];
  if (state.econSrc === 'paper' || !state.res) return [{ lab: 'Pure temporal (not physical)', key: 'PT', R: PAPER.pt, c: C.pt }, { lab: 'Transformer (trained)', key: 'TF', R: PAPER.tf, c: C.tf },
    { lab: 'Station climatology (MDV)', key: 'MDV', R: PAPER.mdv, c: C.mdv }, { lab: 'STMAC', key: 'STL', R: PAPER.stmac, c: C.stmac }];
  const r = state.res;
  return [{ lab: 'Pure temporal', key: 'PT', R: r.rPT, c: C.pt }, { lab: 'Station climatology (MDV)', key: 'MDV', R: r.rMDV, c: C.mdv },
    { lab: 'STMAC · trivial sheaf', key: 'STT', R: r.rSTT, c: C.triv }, { lab: 'STMAC · longitude sheaf', key: 'STL', R: r.rSTL, c: C.stmac }];
}
function levers() { return { gw: +$('gwSlider').value, pen: +$('penSlider').value, out: +$('outSlider').value / 100 }; }
function updateEcon() {
  const { gw, pen, out } = levers();
  $('gwVal').textContent = gw + ' GW'; $('penVal').textContent = '$' + pen + '/MWh'; $('outVal').textContent = Math.round(out * 100) + '%';
  const methods = econMethods();
  const best = methods[methods.length - 1];
  const clim = methods.find(m => m.lab.indexOf('climatology') >= 0) || methods[0];
  const tf = methods.find(m => m.lab.indexOf('Transformer') >= 0);
  const cST = cost(gw, best.R, pen, out) / 1e6;
  $('saveNum').textContent = '$' + (cST >= 100 ? cST.toFixed(0) : cST.toFixed(1)) + 'M';
  const ei = $('econInterp');
  if (ei) {
    const cCL = cost(gw, clim.R, pen, out) / 1e6, dCL = cCL - cST;
    let txt = 'At <b>' + gw + ' GW</b> deployed, <b>$' + pen + '/MWh</b> penalties and <b>' + Math.round(out * 100) + '%</b> sensor outage, the reconstruction error of STMAC prices at <b>$' + (cST >= 100 ? cST.toFixed(0) : cST.toFixed(1)) + 'M/yr</b> under Eq. (7). The station climatology costs <b>$' + (cCL >= 100 ? cCL.toFixed(0) : cCL.toFixed(1)) + 'M/yr</b>, so the gap between them is <span class="hl">$' + dCL.toFixed(1) + 'M/yr</span>' +
      (state.econSrc === 'cloudy' ? ' — on cloudy cells the two methods differ by 46.5 W/m², against 12.8 W/m² on clear cells, so this is where the spatial correction earns its keep.'
        : state.econSrc === 'paper' ? ' — averaged over the seven block lengths the two differ by 16.8 W/m²; at 3-day gaps alone it narrows to 2.9 W/m², and on cloudy cells it widens to 46.5 W/m².'
          : ' — at multi-day gaps the two methods differ by only a few W/m², at short gaps by far more.');
    if (tf) { const cTF = cost(gw, tf.R, pen, out) / 1e6; txt += ' The trained Transformer costs <b>$' + (cTF >= 100 ? cTF.toFixed(0) : cTF.toFixed(1)) + 'M/yr</b>, <b>$' + (cTF - cST).toFixed(1) + 'M/yr</b> above STMAC.'; }
    if (methods.some(m => m.lab.indexOf('Pure temporal') >= 0)) txt += ' The pure-temporal row is a reference only: its RMSE exceeds the physical irradiance range.';
    if (state.econSrc === 'cloudy') txt += ' These bars apply the errors measured on cloudy cells at full capacity and full outage fraction, so they describe a cloud-dominated stress year and are not a share of the all-cell figure. Cloudy cells are 11.7% of the evaluated data (daily clear-sky index at most 0.70); the Transformer and pure-temporal baselines were not run on this subset, so only the two methods above are priced.';
    if (state.econSrc !== 'live' && state.res) {
      const cL = cost(gw, state.res.rSTL, pen, out) / 1e6, cM = cost(gw, state.res.rMDV, pen, out) / 1e6;
      txt += ' <b>Your current scenario</b> (' + BLOCKS[state.res.params.blockIdx].lab + ' blocks, live ' + (DATA && DATA.kind === 'syn' ? 'synthetic run' : '70-day window') + '): STMAC ' + Math.round(state.res.rSTL) + ' W/m² → $' + cL.toFixed(1) + 'M/yr; climatology ' + Math.round(state.res.rMDV) + ' W/m² → $' + cM.toFixed(1) + 'M/yr at these market settings.';
    } else if (state.res) txt += ' These live figures come from the ' + BLOCKS[state.res.params.blockIdx].lab + ' scenario you just ran on the ' + (DATA && DATA.kind === 'syn' ? 'synthetic run' : '70-day window') + ', so they move every time you change the block length, outage fraction, mask or weights; switch to the paper source for the full-year Table II figures averaged over the seven block lengths.';
    ei.innerHTML = txt;
  }
  const lv = $('econLive');
  if (lv) {
    if (!state.res) lv.innerHTML = '<li>Run a scenario to see the live reading.</li>';
    else {
      const r = state.res, p = r.params, bl = BLOCKS[p.blockIdx];
      const fm = v => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
      const rows = [['Pure temporal', r.rPT], ['Station climatology (MDV)', r.rMDV], ['STMAC · trivial sheaf', r.rSTT], ['STMAC · longitude sheaf', r.rSTL]].map(x => ({ lab: x[0], R: x[1], c: cost(gw, x[1], pen, out) / 1e6 })).sort((a, b) => a.c - b.c);
      const st = rows.find(x => x.lab.indexOf('longitude') >= 0), cl = rows.find(x => x.lab.indexOf('climatology') >= 0), pt = rows.find(x => x.lab.indexOf('Pure') >= 0);
      const perW = gw * out * 4380 * pen / 1e6;
      const items = [];
      items.push('<b>Scenario:</b> ' + bl.lab + ' outages covering ' + Math.round(r.effFrac * 100) + '% of each station’s record (mask seed ' + p.maskSeed + '), ' + (DATA.kind === 'real' ? 'real 1999 record, 22 Oct to 30 Dec' : 'synthetic weather') + ', weights r = ' + p.r + ', γ = ' + p.g +
        (p.r === R_RATIO && p.g === RIDGE ? ' (the paper’s values).' : ' (changed from the paper’s r = 1000, γ = 3).'));
      items.push('<b>Market levers:</b> ' + gw + ' GW deployed, $' + pen + '/MWh penalty, ' + Math.round(out * 100) + '% outage share. At these settings every 1 W/m² of reconstruction error costs about <b>$' + perW.toFixed(2) + 'M per year</b>, so the cost bars are simply the error bars in dollars.');
      items.push('<b>Ranking by annual cost (cheapest first):</b><ul>' + rows.map((x, i) => '<li>' + (i + 1) + '. ' + x.lab + ': ' + Math.round(x.R) + ' W/m² → $' + fm(x.c) + 'M/yr</li>').join('') + '</ul>');
      const d = cl.c - st.c;
      if (d > 0.05) items.push('<b>STMAC against the climatology:</b> STMAC is cheaper by <b>$' + d.toFixed(2) + 'M/yr</b> (' + (cl.R - st.R).toFixed(1) + ' W/m² less error). This is the comparison that matters, because the climatology is the simplest method that stays within the physical range.');
      else if (d < -0.05) items.push('<b>STMAC against the climatology:</b> in this draw the climatology is cheaper by $' + (-d).toFixed(2) + 'M/yr (' + (st.R - cl.R).toFixed(1) + ' W/m²). Single masks can fall either way on long gaps; over the paper’s 20 masks STMAC stays below the climatology at every block length, by 2.6 to 72 W/m².');
      else items.push('<b>STMAC against the climatology:</b> the two are within $' + Math.abs(d).toFixed(2) + 'M/yr of each other. On a gap this long the diurnal prior does most of the work, and the spatial correction adds little.');
      items.push('<b>STMAC against pure temporal:</b> $' + fm(pt.c - st.c) + 'M/yr apart. Read this as a warning about naive smoothing rather than as a saving: at ' + bl.lab + ' blocks pure temporal reaches ' + Math.round(pt.R) + ' W/m²' + (pt.R > 1400 ? ', beyond the physical range of sunlight' : '') + '.');
      const gs = r.rSTT - r.rSTL;
      items.push('<b>Solar-time alignment:</b> the longitude sheaf is ' + (gs > 0.05 ? gs.toFixed(2) + ' W/m² better than' : gs < -0.05 ? (-gs).toFixed(2) + ' W/m² worse than' : 'within ' + Math.abs(gs).toFixed(2) + ' W/m² of') + ' the trivial sheaf here, worth $' + Math.abs(gs * perW).toFixed(3) + 'M/yr. The paper finds the alignment significant only for gaps up to 6 hours, worth 1.59, 1.06 and 0.30 W/m² at 30 minutes, 2 hours and 6 hours.');
      if (DATA.kind === 'real') items.push('<b>Why these figures are lower than the paper’s:</b> Table II uses full-year means over 20 masks averaged across the seven block lengths (STMAC 147 W/m²). This page runs one mask on a 70-day winter window with weaker sunlight, so both the errors and the dollar figures are smaller. The ordering of the methods is what carries over.');
      items.push('<b>What to try next:</b> shorten the block to 30 min or 2 h and pure temporal becomes the cheapest; lengthen it to 3 or 7 days and the climatology catches up with STMAC; double the penalty rate and every bar doubles; set γ = 0 to see what removing the pull toward climatology does on long gaps.');
      lv.innerHTML = items.map(t => '<li>' + t + '</li>').join('');
    }
  }
  drawCost(methods, gw, pen, out);
  renderCostInsight();
}
function drawCost(methods, gw, pen, out) {
  const cv = $('costChart'), h = boxH(cv);
  const { ctx, w } = sizeCanvas(cv, h); sizeCanvas($('costOv'), h);
  const maxC = Math.max(...methods.map(m => cost(gw, m.R, pen, out))) / 1e6;
  const bh = Math.min(34, (h - 20) / methods.length - 16);
  ctx.font = FONT; costGeom = [];
  methods.forEach((m, i) => {
    const y = 16 + i * (bh + 28), cM = cost(gw, m.R, pen, out) / 1e6, bw = Math.max(3, cM / maxC * (w - 124));
    ctx.fillStyle = C.muted; ctx.fillText(m.lab + '  ·  R=' + Math.round(m.R) + ' W/m²', 0, y - 5);
    ctx.fillStyle = m.c; ctx.globalAlpha = .85; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, y, bw, bh, 5) : ctx.rect(0, y, bw, bh); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = C.ink; ctx.fillText('$' + (cM >= 100 ? cM.toFixed(0) : cM.toFixed(1)) + 'M/yr', bw + 8, y + bh / 2 + 4);
    costGeom.push({ y0: y - 18, y1: y + bh + 6, y, bw, bh, m, cM });
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
    if (i >= 0) { const g = costGeom[i]; showTip('<div class="t">' + g.m.lab + '</div>' + tipRow('RMSE', f1(g.m.R) + ' W/m²', g.m.c) + tipRow('Annual cost', money(g.cM) + '/yr') + '<div class="n">Click to read this bar</div>', e.clientX, e.clientY); }
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
  if (!m) {
    if (f) state.focus.cost = null;
    setInsight('costInsight', { pill: 'Cost bars', html: '<p class="ins-hint">Click a bar to see what it costs, how far it sits from STMAC, and at which penalty the gap passes $1M a year.</p>' });
    return;
  }
  const { gw, pen, out } = levers();
  const perW = gw * out * 4380 * pen / 1e6, c = cost(gw, m.R, pen, out) / 1e6;
  const st = methods.find(x => x.key === 'STL'), cSt = cost(gw, st.R, pen, out) / 1e6, dR = m.R - st.R, dC = c - cSt;
  const maxC = Math.max(...methods.map(x => cost(gw, x.R, pen, out))) / 1e6;
  const srcLab = state.econSrc === 'live' ? 'this live run' : state.econSrc === 'cloudy' ? 'the paper’s cloudy-cell figures' : 'the paper’s Table II figures';
  let h = '<div class="ins-grid">' + tile('RMSE', f1(m.R) + ' W/m²', '', m.c) + tile('Annual cost', money(c) + '/yr', (100 * c / maxC).toFixed(0) + '% of the tallest bar') +
    tile('Cost per W/m²', '$' + perW.toFixed(2) + 'M/yr', 'at these levers') + (m.key !== 'STL' ? tile(dC >= 0 ? 'Above STMAC' : 'Below STMAC', money(Math.abs(dC)) + '/yr', sg(dR, 1) + ' W/m²') : '') + '</div>';
  h += '<p>Under Eq. (7), ' + gw + ' GW × (R/1000) × ' + Math.round(out * 100) + '% outage × 4,380 h × $' + pen + '/MWh turns every 1 W/m² of error into <b>$' + perW.toFixed(2) + 'M</b> a year. With R = ' + f1(m.R) + ' W/m² (from ' + srcLab + '), <b>' + m.lab + '</b> prices at <b>' + money(c) + '/yr</b>.</p>';
  if (m.key !== 'STL') {
    if (dR > 0) {
      const penStar = 1e6 / (gw * 1000 * (dR / 1000) * out * 4380);
      h += '<p>It sits <b>' + f1(dR) + ' W/m²</b> above STMAC, so it costs <b>' + money(dC) + '/yr</b> more. Holding capacity and outage fixed, that gap passes $1M a year once the penalty exceeds <b>$' + (penStar < 100 ? penStar.toFixed(2) : penStar.toFixed(0)) + '/MWh</b>' + (penStar <= pen ? ' (it already does at $' + pen + '/MWh).' : ' (the current rate is $' + pen + '/MWh).') + ' To match STMAC’s cost it would need to cut its error by ' + (100 * dR / m.R).toFixed(1) + '%.</p>';
    } else h += '<p>It sits <b>' + f1(-dR) + ' W/m² below</b> STMAC here, so it is <b>' + money(-dC) + '/yr</b> cheaper in this reading.' + (m.key === 'PT' ? ' Short gaps favour pure temporal, as the paper reports for blocks up to 2 hours.' : '') + '</p>';
    if (m.key === 'PT' && m.R > PHYS_MAX) h += '<p>An RMSE of ' + f0(m.R) + ' W/m² exceeds the [0, ' + PHYS_MAX + '] W/m² physical range, so treat this bar as a warning about naive smoothing, not as a cost anyone would pay.</p>';
  } else {
    const others = methods.filter(x => x.key !== 'STL').map(x => [x, cost(gw, x.R, pen, out) / 1e6 - cSt]).sort((a, b) => a[1] - b[1]);
    h += '<p>' + (others.length ? 'The nearest other bar is <b>' + others[0][0].lab + '</b>, ' + (others[0][1] >= 0 ? money(others[0][1]) + '/yr more expensive.' : money(-others[0][1]) + '/yr cheaper.') : '') + ' Halving STMAC’s error would save ' + money(c / 2) + '/yr at these levers; because Eq. (7) is linear in every factor, doubling the penalty or the capacity doubles every bar.</p>';
  }
  setInsight('costInsight', { pill: 'Cost · ' + m.lab, html: h, focused: true, flash, onReset: () => { state.focus.cost = null; drawCostOverlay(); renderCostInsight(true); } });
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
      '<tr><td>Pure temporal (11 banded solves)</td><td>' + fmtMs(tm.pt) + '</td></tr><tr><td>Outage mask</td><td>' + fmtMs(tm.mask) + '</td></tr>' +
      '<tr><td>Climatology fill + error statistics</td><td>' + fmtMs(tm.mdv + tm.stats) + '</td></tr><tr><td>Total in the solver</td><td>' + fmtMs(tm.total) + '</td></tr>' +
      '<tr><td>Round trip incl. data transfer</td><td>' + fmtMs(r.wall) + '</td></tr></table>' +
      '<p>Everything ran ' + where + '. This session has run <b>' + lg.length + '</b> scenario' + (lg.length === 1 ? '' : 's') + '; the median headline solve is <b>' + fmtMs(median(lg.map(x => x.ms))) + '</b>.</p>';
  }
  if (kind === 'params') return '<h3>Trained parameters · 0</h3><p>STMAC has no training set and no fitted model. This session has run <b>' + state.solveLog.length + '</b> reconstruction' + (state.solveLog.length === 1 ? '' : 's') + '; each one recomputed the climatology from the observed cells of its own mask and solved the system from scratch, with nothing learned or carried over between runs.</p>';
  if (kind === 'weights') {
    const paper = state.r === R_RATIO && state.g === RIDGE;
    return '<h3>Weights</h3><p>In use now: <b>r = ' + state.r + ', γ = ' + state.g + '</b>' + (paper ? ', the pair the paper selects by block cross-validation on observed cells.' : '. The paper’s cross-validated pair is r = 1000, γ = 3.') + '</p><p>r sets how much temporal smoothness counts against neighbour agreement; γ sets how strongly long gaps are pulled back to the climatology.</p>' +
      (paper ? '' : '<div class="ins-actions">' + actBtn('Reset to r = 1000, γ = 3', 'data-act="reset-weights"') + '</div>');
  }
  if (kind === 'unknowns') {
    if (!r) return '<h3>Unknown cells</h3><p>The first scenario is still running.</p>';
    const band = r.n * (r.bw + 1), dense = r.n * r.n;
    return '<h3>Unknown cells · ' + r.n.toLocaleString('en-US') + '</h3><table>' +
      '<tr><td>Unknowns n (removed cells)</td><td>' + r.n.toLocaleString('en-US') + '</td></tr><tr><td>Half-bandwidth</td><td>' + r.bw + ' (limit 2N = ' + 2 * N + ')</td></tr>' +
      '<tr><td>Band storage n·(bw+1)</td><td>' + band.toLocaleString('en-US') + ' (' + (band * 8 / 1e6).toFixed(1) + ' MB)</td></tr>' +
      '<tr><td>Dense storage n²</td><td>' + (dense / 1e6).toFixed(0) + ' M (' + (dense * 8 / 1e9).toFixed(1) + ' GB)</td></tr>' +
      '<tr><td>Factorisation work ≈ n·bw²</td><td>' + (r.n * r.bw * r.bw / 1e6).toFixed(1) + ' M</td></tr></table>' +
      '<p>Ordering the unknowns by (time, station) keeps the system of Eq. (6) banded, which is why one exact Cholesky factorisation fits in a browser tab.</p>';
  }
  return '<h3>Transformer baseline</h3><p>The deep-learning baseline of Section V-C needs <b>136,000</b> trained parameters, <b>25</b> epochs on curated training data, and retraining whenever the sensor network changes. Its figures on this page are quoted from the paper; the page does not run it.</p>';
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
  $('bWeights').textContent = 'r = ' + state.r + ' · γ = ' + state.g;
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
  const lab2 = document.createElement('span'); lab2.className = 'chip-lab'; lab2.textContent = 'γ (pull toward climatology)'; eg.appendChild(lab2);
  G_CHOICES.forEach(v => { const c = document.createElement('button'); c.type = 'button'; c.className = 'chip' + (v === state.g ? ' on' : ''); c.setAttribute('aria-pressed', v === state.g ? 'true' : 'false');
    c.textContent = String(v); c.title = 'ridge weight: larger values keep long gaps closer to the station climatology';
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
function setEconSrc(src) {
  state.econSrc = src;
  for (const [id, key] of [['srcPaper', 'paper'], ['srcCloudy', 'cloudy'], ['srcLive', 'live']]) { const el = $(id); if (el) { el.classList.toggle('on', key === src); el.setAttribute('aria-pressed', key === src ? 'true' : 'false'); } }
  updateEcon();
}
$('srcPaper').addEventListener('click', () => setEconSrc('paper'));
$('srcCloudy').addEventListener('click', () => setEconSrc('cloudy'));
$('srcLive').addEventListener('click', () => setEconSrc('live'));
['gwSlider', 'penSlider', 'outSlider'].forEach(id => $(id).addEventListener('input', scheduleEcon));

/* ================= resize, fonts, hero ================= */
function redrawAll() { drawTS(); drawSweep(); updateEcon(); }
if (window.ResizeObserver) {
  const map = new Map([['tsChart', drawTS], ['sweepChart', drawSweep], ['costChart', updateEcon]]);
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
drawMap(); buildDsChips(); buildChips(); buildWeightChips(); drawLegend(); buildSweepLegend(); updateChartHead();
drawTS(); drawSweep(); updateEcon(); renderMapInsight(); renderTsInsight(); renderMetricInsight(); renderSweepInsight();
scheduleStamp();
loadDataset('real').then(ok => { if (ok) requestScenario(); });
window.STMAC = { state, engine, pool, get data() { return DATA; } }; /* handle for debugging and automated tests */
})();

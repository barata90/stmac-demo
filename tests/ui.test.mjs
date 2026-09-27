/* Browser tests (Playwright + node:test). Each test opens a fresh page so tests stay
 * independent. Displayed numbers are checked against the reference of the original page. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { ROOT, SANDBOX_SCRIPTS, startServer, launch, openPage, solved, insight, cardValues, readReference, fmt0, close } from './helpers.mjs';

const ref = readReference().scenarios;
const scen = (kind, blockIdx, extra = {}) => ref.find(s => s.kind === kind && s.blockIdx === blockIdx &&
  s.frac === (extra.frac ?? 0.10) && s.maskSeed === (extra.maskSeed ?? 11) && s.r === (extra.r ?? 1000) && s.g === (extra.g ?? 3) && s.seed === (extra.seed ?? 42));
const expectedCards = s => [s.rPT, s.rSTL, s.rSTT, s.rMDV, s.rS0].map(fmt0);
const T = { timeout: 90000 };
/* snapshot numbers were recorded in Node; Chromium's V8 may round the last bit differently */
function assertClose(actual, expected, what) {
  assert.equal(actual.length, expected.length, what);
  actual.forEach((a, i) => assert.ok(close(a, expected[i]), `${what} [${i}]: ${a} vs reference ${expected[i]}`));
}

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await server?.close(); });

async function fresh(opts) { const o = await openPage(browser, server.url, opts); await solved(o.page); return o; }
async function clickChip(page, group, label) {
  await page.locator('#' + group + ' .chip', { hasText: new RegExp('^' + label + '$') }).click();
  await page.waitForFunction(([g, l]) => /^solved/.test(document.getElementById('status').textContent) &&
    document.querySelector('#' + g + ' .chip.on').textContent === l, [group, label]);
}
async function box(page, sel) { await page.locator(sel).scrollIntoViewIfNeeded(); return page.locator(sel).boundingBox(); }

test('in Chromium, the original and refactored solvers agree bit for bit', T, async () => {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto('about:blank');
  for (const f of SANDBOX_SCRIPTS) await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, f), 'utf8') });
  const picks = [scen('real', 0), scen('real', 6), scen('real', 2, { frac: 0.05, maskSeed: 7930, r: 100, g: 0 }), scen('syn', 3)];
  assert.ok(picks.every(Boolean), 'reference scenarios present');
  const diffs = await page.evaluate(s => stmacDifferential(makeSingleFileSolver, STMACCore, STMAC_NLR1999, s), picks);
  for (const d of diffs) assert.deepEqual(d.new, d.old, JSON.stringify(d.scenario));
  await context.close();
});

test('loads, solves in a Web Worker, and shows the reference numbers', T, async () => {
  const { page, errors, context } = await fresh();
  assert.equal(await page.evaluate(() => window.STMAC.engine.mode), 'worker');
  await page.waitForTimeout(800); /* let the count-up animation finish */
  assert.deepEqual(await cardValues(page), expectedCards(scen('real', 5)));
  assert.equal(await page.locator('#bPat').textContent(), scen('real', 5).n.toLocaleString('en-US'));
  assert.equal(await page.locator('#fx-bg').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('every block length matches the original solver', T, async () => {
  const { page, errors, context } = await fresh();
  for (const [k, lab] of [[0, '30 min'], [1, '2 h'], [2, '6 h'], [3, '12 h'], [4, '1 day'], [6, '7 days']]) {
    await clickChip(page, 'blockChips', lab);
    const res = await page.evaluate(() => { const r = window.STMAC.state.res; return [r.rPT, r.rMDV, r.rSTL, r.rSTT, r.rS0, r.n]; });
    const s = scen('real', k);
    assertClose(res.slice(0, 5), [s.rPT, s.rMDV, s.rSTL, s.rSTT, s.rS0], lab);
    assert.equal(res[5], s.n, lab + ' unknowns');
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('map: stations and edges open readings and drive the chart', T, async () => {
  const { page, errors, context } = await fresh();
  let ins = await insight(page, 'mapInsight');
  assert.equal(ins.pill, 'Network overview');
  assert.match(ins.body, /Solar noon falls between 11:42 \(ah\) and 12:23 \(jn\)/);
  await page.locator('#map .stn[data-v="3"] .node').click();
  ins = await insight(page, 'mapInsight');
  assert.equal(ins.pill, 'Station · jn');
  assert.ok(ins.focused);
  assert.match(ins.body, /leads the network mean by δ = −18\.6 min/);
  assert.match(ins.body, /20 min earlier/);
  assert.match(await page.locator('#chartTitle').textContent(), /jn · Jeddah/);
  await page.locator('#map .stn[data-v="0"] .node').hover();
  assert.match(await page.locator('#tip').innerText(), /Solar Village/);
  await page.locator('#map .edge[data-i="0"][data-j="2"]').dispatchEvent('click');
  ins = await insight(page, 'mapInsight');
  assert.equal(ins.pill, 'Edge · sv – gs');
  assert.match(ins.body, /307 km apart/);
  await page.locator('#mapInsight .ins-reset').click();
  assert.equal((await insight(page, 'mapInsight')).pill, 'Network overview');
  /* keyboard: Enter on a focused station selects it */
  await page.locator('#map .stn[data-v="7"]').focus();
  await page.keyboard.press('Enter');
  assert.equal((await insight(page, 'mapInsight')).pill, 'Station · ab');
  assert.deepEqual(errors, []);
  await context.close();
});

test('reconstruction chart: hover tooltip, click to pin, keyboard navigation', T, async () => {
  const { page, errors, context } = await fresh();
  const b = await box(page, '#tsOv');
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.45);
  await page.waitForTimeout(100);
  assert.match(await page.locator('#tip').innerText(), /clock · solar/);
  await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.45);
  let ins = await insight(page, 'tsInsight');
  assert.match(ins.pill, /^Point · /);
  assert.ok(ins.focused);
  await page.locator('#tsOv').focus();
  const before = ins.pill;
  await page.keyboard.press('Shift+ArrowRight');
  ins = await insight(page, 'tsInsight');
  assert.notEqual(ins.pill, before, 'Shift+ArrowRight moves the pinned time');
  await page.keyboard.press('PageDown');
  ins = await insight(page, 'tsInsight');
  assert.match(ins.pill, /^Gap 2 · sv$/);
  assert.match(await page.locator('#gapLbl').textContent(), /^gap 2\//);
  await page.keyboard.press('PageUp');
  assert.match((await insight(page, 'tsInsight')).pill, /^Gap 1 · sv$/);
  /* legend toggles a series */
  await page.locator('#tsLegend .sl', { hasText: 'STMAC · trivial sheaf' }).click();
  assert.equal(await page.evaluate(() => window.STMAC.state.showTriv), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('error cards and Table I rows open readings', T, async () => {
  const { page, errors, context } = await fresh();
  await page.locator('.card[data-m="MDV"]').click();
  let ins = await insight(page, 'metricInsight');
  assert.equal(ins.pill, 'Method · Station climatology (MDV)');
  assert.equal(await page.locator('.card[data-m="MDV"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#metricInsight .ins-bar').count(), 11);
  assert.equal(await page.evaluate(() => window.STMAC.state.emph), 'MDV');
  await page.locator('#metricInsight .ins-bar').last().click();
  const sel = await page.evaluate(() => window.STMAC.state.sel);
  assert.equal((await insight(page, 'mapInsight')).pill.startsWith('Station · '), true);
  assert.notEqual(sel, null);
  await page.locator('.card[data-m="MDV"]').click(); /* second click clears the focus */
  assert.equal((await insight(page, 'metricInsight')).focused, false);
  assert.equal(await page.locator('#refTable tbody tr[data-k]').count(), 7);
  await page.locator('#refTable tr[data-k="3"]').click();
  ins = await insight(page, 'metricInsight');
  assert.equal(ins.pill, 'Table I · 12 h');
  assert.match(ins.body, /STMAC reaches 89\.9, 2\.0 below the climatology and 33\.5 below the Transformer/);
  await page.locator('.card[data-m="S0"]').click();
  assert.equal((await insight(page, 'metricInsight')).pill, 'Method · STMAC without prior (S0)');
  assert.equal(await page.evaluate(() => window.STMAC.state.showS0), true, 'selecting the S0 card shows its line');
  await page.locator('#refTable tr[data-k="2"]').click();
  ins = await insight(page, 'metricInsight');
  assert.equal(ins.pill, 'Table I · 6 h');
  await page.locator('#metricInsight [data-act="block"]').click();
  await page.waitForFunction(() => /^solved/.test(document.getElementById('status').textContent) && document.querySelector('#blockChips .chip.on').textContent === '6 h');
  ins = await insight(page, 'metricInsight');
  assert.match(ins.body, new RegExp('STMAC ' + scen('real', 2).rSTL.toFixed(1)));
  assert.match(ins.body, /order of the four methods run live (matches|differs)/);
  assert.match(ins.body, /held-out column is the closer reference/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('sweep: values match the original solver and points open readings', T, async () => {
  const { page, errors, context } = await fresh();
  await page.locator('#sweepBtn').click();
  await page.waitForFunction(() => /^done/.test(document.getElementById('sweepStatus').textContent), null, { timeout: 60000 });
  const rows = await page.evaluate(() => window.STMAC.state.sweep.rows.map(r => [r.pt, r.mdv, r.sl, r.st, r.s0]));
  for (let k = 0; k < 7; k++) { const s = scen('real', k); assertClose(rows[k], [s.rPT, s.rMDV, s.rSTL, s.rSTT, s.rS0], 'block ' + k); }
  assert.match((await insight(page, 'sweepInsight')).body, /Without its prior, the joint solver \(S0\) is below the climatology only at 30 min/);
  assert.equal((await insight(page, 'sweepInsight')).pill, 'Sweep overview');
  const b = await box(page, '#sweepOv');
  const x = b.x + 74 + (4.5 / 7) * (b.width - 88);
  await page.mouse.move(x, b.y + b.height / 2);
  await page.waitForTimeout(100);
  assert.match(await page.locator('#tip').innerText(), /1 day blocks/);
  await page.mouse.click(x, b.y + b.height / 2);
  let ins = await insight(page, 'sweepInsight');
  assert.match(ins.pill, /^Sweep · 1 day · /);
  assert.match(ins.body, /Paper Table I at 1 day/);
  await page.locator('#sweepOv').focus();
  await page.keyboard.press('ArrowLeft');
  assert.match((await insight(page, 'sweepInsight')).pill, /^Sweep · 12 h · /);
  await page.locator('#sweepInsight [data-act="block"]').click();
  await page.waitForFunction(() => /^solved/.test(document.getElementById('status').textContent) && document.querySelector('#blockChips .chip.on').textContent === '12 h');
  /* changing a weight marks the sweep as stale instead of silently keeping it */
  await clickChip(page, 'rChips', '100');
  assert.match((await insight(page, 'sweepInsight')).body, /settings have changed since/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('cost bars and header badges open readings', T, async () => {
  const { page, errors, context } = await fresh();
  const b = await box(page, '#costOv');
  await page.mouse.click(b.x + 30, b.y + 16 + 1 * 62 + 10);
  let ins = await insight(page, 'costInsight');
  assert.equal(ins.pill, 'Cost · Station climatology (MDV)');
  assert.match(ins.body, /turns every 1 W\/m² of error into \$0\.05M a year/);
  await page.locator('#penSlider').evaluate(el => { el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(80);
  assert.match((await insight(page, 'costInsight')).body, /\$10\/MWh turns every 1 W\/m² of error into \$0\.18M a year/);
  await page.locator('#srcPaper').click();
  await page.mouse.click(b.x + 30, b.y + 16 + 1 * 62 + 10);
  ins = await insight(page, 'costInsight');
  assert.equal(ins.pill, 'Cost · Transformer (trained)');
  assert.match(ins.body, /exceeds \$0\.90\/MWh/);
  for (const [k, re] of [['solve', /timing breakdown/i], ['unknowns', /Half-bandwidth/], ['weights', /r = 1000, g = 3/], ['params', /no training set/], ['tf', /136,000/]]) {
    await page.locator('.badge[data-pop="' + k + '"]').click();
    assert.equal(await page.locator('#pop').isVisible(), true, k);
    assert.match(await page.locator('#pop .pop-body').innerText(), re, k);
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#pop').isHidden(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('latest request wins under rapid input and dataset switches', T, async () => {
  const { page, errors, context } = await fresh();
  await page.evaluate(async () => {
    const chips = () => [...document.querySelectorAll('#blockChips .chip')];
    for (let i = 0; i < 7; i++) chips()[i].click();
    document.getElementById('sweepBtn').click();
    await new Promise(r => setTimeout(r, 150));
    [...document.querySelectorAll('#dsChips .chip')][1].click();
    await new Promise(r => setTimeout(r, 30));
    chips()[2].click();
    [...document.querySelectorAll('#rChips .chip')][1].click();
    [...document.querySelectorAll('#dsChips .chip')][0].click();
  });
  await page.waitForFunction(() => { const r = window.STMAC.state.res; return r && r.params.blockIdx === 2 && r.params.r === 100 && /^solved/.test(document.getElementById('status').textContent); }, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => { const s = window.STMAC.state; return { ds: s.dataset, data: window.STMAC.data.kind, T: s.res.T, dsKey: s.res.params.dsKey, sweepBtn: document.getElementById('sweepBtn').disabled }; });
  assert.deepEqual(st, { ds: 'real', data: 'real', T: 20160, dsKey: 'real:42', sweepBtn: false });
  assert.deepEqual(errors, []);
  await context.close();
});

test('synthetic weather reproduces the original solver', T, async () => {
  const { page, errors, context } = await fresh();
  await clickChip(page, 'blockChips', '12 h');
  await page.locator('#dsChips .chip', { hasText: 'Synthetic' }).click();
  await page.waitForFunction(() => window.STMAC.state.res && window.STMAC.state.res.T === 8640 && /^solved/.test(document.getElementById('status').textContent));
  const s = scen('syn', 3);
  assertClose(await page.evaluate(() => { const r = window.STMAC.state.res; return [r.rPT, r.rMDV, r.rSTL, r.rSTT, r.rS0]; }), [s.rPT, s.rMDV, s.rSTL, s.rSTT, s.rS0], 'synthetic');
  assert.deepEqual(errors, []);
  await context.close();
});

test('phone layout: no horizontal overflow, touch opens readings', T, async () => {
  const { page, errors, context } = await fresh({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  await page.locator('#map .stn[data-v="7"] .node').tap();
  assert.equal((await insight(page, 'mapInsight')).pill, 'Station · ab');
  const b = await box(page, '#tsOv');
  await page.touchscreen.tap(b.x + b.width * 0.55, b.y + b.height * 0.5);
  assert.match((await insight(page, 'tsInsight')).pill, /^Point · /);
  assert.equal(await page.evaluate(() => document.getElementById('tip').classList.contains('on')), false, 'no hover tooltip on touch');
  assert.deepEqual(errors, []);
  await context.close();
});

test('reduced motion: page works and the background parallax is off', T, async () => {
  const { page, errors, context } = await fresh({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('fx-lite')), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('fx-bg')).animationName), 'none');
  assert.deepEqual(errors, []);
  await context.close();
});

test('file:// fallback: the solver runs on the main thread and gives the same numbers', T, async () => {
  const url = pathToFileURL(path.join(ROOT, 'index.html')).href;
  const { page, errors, context } = await openPage(browser, url);
  await solved(page, 60000);
  assert.equal(await page.evaluate(() => window.STMAC.engine.mode), 'main');
  const s = scen('real', 5);
  assertClose(await page.evaluate(() => { const r = window.STMAC.state.res; return [r.rPT, r.rMDV, r.rSTL, r.rSTT]; }), [s.rPT, s.rMDV, s.rSTL, s.rSTT], 'file://');
  /* browsers block web fonts on file:// pages; anything else is a real error */
  const other = errors.filter(e => !/font|preload|ERR_FAILED/i.test(e));
  assert.deepEqual(other, []);
  await context.close();
});

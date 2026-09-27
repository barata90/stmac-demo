/* Performance report (informational, never fails the build: frame rates on shared CI runners
 * vary too much to gate on). Measures the page in headless Chromium and, with --compare,
 * the single-file page it replaced, using the same procedure for both.
 *
 *   node perf.mjs                               # current page only
 *   node perf.mjs --compare /tmp/old/index.html # also measure another page (served from its folder)
 *
 * Prints a Markdown table and appends it to $GITHUB_STEP_SUMMARY when that is set. */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, startServer, launch } from './helpers.mjs';

async function measure(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__lt = [];
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => /\d/.test(document.getElementById('bSolve').textContent), null, { timeout: 90000 });
  const ready = Date.now() - t0;
  const fcp = await page.evaluate(() => { const p = performance.getEntriesByType('paint').find(x => x.name === 'first-contentful-paint'); return p ? p.startTime : NaN; });
  await page.waitForTimeout(6000); /* let one-shot load animations finish */
  const fps = await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    const run = ms => new Promise(res => { let n = 0, worst = 0, last = performance.now(); const s = last;
      (function f(now) { n++; worst = Math.max(worst, now - last); last = now; if (now - s < ms) requestAnimationFrame(f); else res({ fps: n * 1000 / (now - s), worst }); })(s); });
    const idle = await run(2000);
    const pending = run(3000); const H = document.documentElement.scrollHeight; let y = 0;
    const iv = setInterval(() => { y = (y + 60) % H; window.scrollTo(0, y); }, 16);
    const scroll = await pending; clearInterval(iv); window.scrollTo(0, 0);
    return { idle, scroll };
  });
  const lt0 = await page.evaluate(() => window.__lt.length);
  const clicks = await page.evaluate(async () => {
    const out = [];
    for (const lab of ['30 min', '1 day', '7 days']) {
      const chip = [...document.querySelectorAll('#blockChips .chip')].find(c => c.textContent.trim() === lab);
      const t = performance.now(); chip.click();
      await new Promise(r => { const iv = setInterval(() => { if (/^solved/.test(document.getElementById('status').textContent)) { clearInterval(iv); r(); } }, 5); });
      out.push(performance.now() - t);
      await new Promise(r => setTimeout(r, 300));
    }
    return out;
  });
  const clickLong = await page.evaluate(n => window.__lt.slice(n), lt0);
  const sweep = await page.evaluate(async () => {
    const t = performance.now(); document.getElementById('sweepBtn').click();
    await new Promise(r => { const iv = setInterval(() => { if (/^done/.test(document.getElementById('sweepStatus').textContent)) { clearInterval(iv); r(); } }, 10); });
    return performance.now() - t;
  });
  const heap = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : NaN);
  await context.close();
  return { ready, fcp, fps, clicks, clickLong, sweep, heap };
}

const args = process.argv.slice(2);
const cmpIdx = args.indexOf('--compare');
const targets = [['This page', ROOT, 'index.html']];
if (cmpIdx >= 0) { const f = path.resolve(args[cmpIdx + 1]); targets.push(['Compared page', path.dirname(f), path.basename(f)]); }

const browser = await launch();
const results = [];
for (const [name, dir, file] of targets) {
  const server = await startServer(dir);
  try { results.push([name, await measure(browser, server.url + file)]); }
  catch (e) { results.push([name, { error: e.message }]); }
  await server.close();
}
await browser.close();

const f0 = x => Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : 'n/a';
const f1 = x => Number.isFinite(x) ? x.toFixed(1) : 'n/a';
const rows = [
  ['First contentful paint (ms)', r => f0(r.fcp)],
  ['First solve on screen (ms)', r => f0(r.ready)],
  ['Frame rate idle / scrolling (fps)', r => f1(r.fps.idle.fps) + ' / ' + f1(r.fps.scroll.fps)],
  ['Worst frame while scrolling (ms)', r => f0(r.fps.scroll.worst)],
  ['Block-chip click to result (ms)', r => r.clicks.map(f0).join(', ')],
  ['Main-thread long tasks during those clicks', r => r.clickLong.length ? r.clickLong.length + ' (longest ' + f0(Math.max(...r.clickLong)) + ' ms)' : 'none'],
  ['Block-length sweep (ms)', r => f0(r.sweep)],
  ['JS heap (MB)', r => f1(r.heap / 1e6)]];
let md = '### STMAC console performance (headless Chromium, 1440x900, DPR 2)\n\n| Metric | ' + results.map(r => r[0]).join(' | ') + ' |\n|---|' + results.map(() => '---|').join('') + '\n';
for (const [lab, get] of rows) md += '| ' + lab + ' | ' + results.map(([, r]) => r.error ? 'error' : get(r)).join(' | ') + ' |\n';
for (const [name, r] of results) if (r.error) md += '\n' + name + ' could not be measured: ' + r.error + '\n';
md += '\nInformational only. Headless Chromium on a shared runner usually composites without a GPU, which exaggerates rendering costs; compare columns, not absolute values.\n';
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');

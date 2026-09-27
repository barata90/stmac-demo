/* Shared helpers for the test suite: a dependency-free static server, a Node loader for the
 * numerical core, and a small Playwright wrapper that records page errors. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(TESTS_DIR, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8'
};

/* Serve the repository root on a random local port. */
export function startServer(root = ROOT) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (file.endsWith(path.sep)) file = path.join(file, 'index.html');
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ url: 'http://127.0.0.1:' + port + '/', close: () => new Promise(r => server.close(r)) });
  }));
}

/* Scripts that the Node tests and the in-browser differential test both load. */
export const SANDBOX_SCRIPTS = ['assets/js/stmac-core.js', 'assets/data/nlr1999.js', 'tests/reference/single-file-solver.js', 'tests/differential.js'];

/* Load the refactored core, the data payload, the original solver fixture and the
   differential helper into one sandbox, the same way the worker loads its scripts. */
export function loadCore() {
  const ctx = { atob: s => Buffer.from(s, 'base64').toString('binary'), performance, console };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of SANDBOX_SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return { Core: ctx.STMACCore, payload: ctx.STMAC_NLR1999, makeSingleFileSolver: ctx.makeSingleFileSolver, stmacDifferential: ctx.stmacDifferential };
}

/* |a - b| <= tol * max(1, |b|): snapshot values may differ in the last bit across engines */
export const close = (a, b, tol = 1e-12) => a === b || Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

export function readReference() {
  return JSON.parse(fs.readFileSync(path.join(TESTS_DIR, 'reference/solver-reference.json'), 'utf8'));
}

/* Same sampled checksum as differential.js: covers every reconstruction array. */
export function reconChecksum(arrays, N, T) {
  let cs = 0;
  for (const P of arrays) for (let v = 0; v < N; v++) for (let i = 0; i < T; i += 97) cs += P[v * T + i] * ((i % 13) + 1);
  return cs;
}

export async function launch() {
  const { chromium } = await import('playwright');
  return chromium.launch();
}

/* Open the page and collect page errors plus console errors and warnings. */
export async function openPage(browser, url, opts = {}) {
  const context = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, opts));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  return { context, page, errors };
}

export const solved = (page, timeout = 30000) =>
  page.waitForFunction(() => /^solved/.test(document.getElementById('status').textContent), null, { timeout });

export const insight = (page, id) => page.evaluate(id => {
  const b = document.getElementById(id);
  return { pill: b.querySelector('.ins-pill').textContent, body: b.querySelector('.ins-body').innerText.replace(/\s+/g, ' '), focused: b.classList.contains('focused') };
}, id);

export const cardValues = page => page.evaluate(() =>
  ['cPT', 'cSTL', 'cSTT', 'cAdv', 'cS0'].map(id => document.getElementById(id).querySelector('.n').textContent));

/* The page formats integers with en-US grouping and a true minus sign. */
export const fmt0 = x => (Math.round(x) < 0 ? '−' : '') + Math.abs(Math.round(x)).toLocaleString('en-US');

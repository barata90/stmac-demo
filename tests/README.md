# Tests

Regression tests for the live console. They run in CI on every pull request and on every
push to `main` (`.github/workflows/tests.yml`).

## Run locally

```
cd tests
npm ci
npx playwright install chromium   # skip if a matching Chromium is already installed
npm test                          # solver tests, then browser tests
npm run perf                      # performance report (informational)
```

`npm run test:solver` runs only the Node tests (about 20 s, no browser needed).

## What each file checks

`solver.test.mjs` (Node, no browser)

- The data asset `assets/data/nlr1999.js` decodes to exactly the record that the single-file
  page embedded (SHA-256 of the int16 samples).
- Differential test: the original single-file solver (`reference/single-file-solver.js`) and
  the refactored `assets/js/stmac-core.js` run on the same data in the same engine and must
  agree bit for bit on the four RMSEs, the unknown count, the bandwidth, the missing fraction
  and a checksum over every reconstruction array, for 14 scenarios (real and synthetic data,
  all seven block lengths, several weights, fractions and masks).
- Snapshot test: the core still gives the numbers recorded in
  `reference/solver-reference.json`, within 1e-12 relative.
- Invariants: STMAC and the climatology keep observed cells as measured; the correlation
  matrices are symmetric and bounded; the graph matches the single-file page.

`ui.test.mjs` (Playwright, Chromium)

- The same differential test inside Chromium.
- The page solves in a Web Worker and shows the reference numbers; every block length, the
  sweep and the synthetic mode reproduce the original solver.
- Every interactive reading opens and responds: map stations and edges (mouse and keyboard),
  the reconstruction chart (hover, pin, keys), cards, Table I rows, sweep points, cost bars,
  header badges.
- Rapid clicks and dataset switches end in a consistent state (latest request wins).
- Phone layout has no horizontal overflow and touch opens readings; reduced motion turns the
  parallax off; `file://` falls back to the main thread with the same numbers.
- No page errors or console errors or warnings in any of these.

`perf.mjs` measures frame rate, click latency, main-thread long tasks, sweep time and heap in
headless Chromium. It never fails the build: shared runners vary too much. In CI it compares
the page with the single-file page it replaced.

## Why two kinds of solver checks

Different JavaScript engines may round the last bit of `Math` functions differently (for
example Node 22 and Chromium 141 give 83.3170940601945 and 83.31709406019448 for the same
7-day scenario). The differential tests therefore compare the old and new solver inside the
same engine, which is exact everywhere, and the snapshot uses a 1e-12 tolerance.

## Regenerating the reference

The reference comes from the single-file page at commit `473edc3`:

```
git show 473edc3:index.html > /tmp/stmac-single-file.html
node tools/make-reference.mjs /tmp/stmac-single-file.html
```

This rewrites `reference/solver-reference.json` and `reference/single-file-solver.js`. Only
regenerate when the intended behaviour of the solver changes; the point of the fixture is
that it does not follow the new code.

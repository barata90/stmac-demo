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
  agree bit for bit on the five RMSEs (STMAC with both sheaves, climatology, pure temporal,
  S0), the unknown count, the bandwidth, the missing fraction and a checksum over every
  reconstruction array, for 14 scenarios (real and synthetic data, all seven block lengths,
  several weights, fractions and masks).
- Optimality test, independent of the old code: the STMAC and S0 reconstructions satisfy the
  zero-gradient condition of Eq. (6) on every unobserved cell (relative residual below 1e-9).
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
example Node 22 and Chromium 141 give 88.62596870429218 and 88.62596870429216 for STMAC in
the same 7-day scenario; the old and new solvers agree exactly within each engine). The differential tests therefore compare the old and new solver inside the
same engine, which is exact everywhere, and the snapshot uses a 1e-12 tolerance.

## The fixture and its three patches

`reference/single-file-solver.js` is the solver section of the single-file page at commit
`473edc3`, copied unchanged except for patches that align it with the final paper. Each is
listed in the file header and applied by `tools/make-reference.mjs`, which refuses to run if
a patch does not match exactly once:

1. The longitude-sheaf shift is measured from the network-mean longitude (Section III-B)
   instead of the UTC+3 meridian. Every station moves by the same extra sample, so the
   relative shifts and the reconstructions are unchanged.
2. RMSE is scored on unobserved cells at clock hours 8 to 16 (Section V-A and the notebooks'
   `DAYTIME` mask) instead of on cells with clear-sky GHI above 20 W/m².
3. An optional zero prior, for the ablation S0 of Table I (C = 0, g = 0, r = 10).

## Regenerating the reference

The reference comes from the single-file page at commit `473edc3`:

```
git show 473edc3:index.html > /tmp/stmac-single-file.html
node tools/make-reference.mjs /tmp/stmac-single-file.html
```

This rewrites `reference/solver-reference.json` and `reference/single-file-solver.js`. Only
regenerate when the intended behaviour of the solver changes; the point of the fixture is
that it does not follow the new code.

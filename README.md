# STMAC Live Console

**Interactive, in-browser companion to the IEEE SUSTAIN 2026 paper:**
*Training-Free Solar Resource Reconstruction via Cellular Sheaves: A Spatial-Temporal
Framework for Saudi Vision 2030* — Amrin Barata, Faculty of Mathematics and Natural
Sciences, Universitas Syiah Kuala.

**Live demo:** https://barata90.github.io/stmac-demo/

## What this is

A static page (HTML, CSS and JavaScript, no build step) that runs the STMAC reconstruction pipeline
client-side, in JavaScript, on **70 days of the real 1999 Saudi NLR record**
(Oct 22 – Dec 30, 1999; 11 stations, 5-minute GHI) shipped with the page in `assets/data/nlr1999.js`.
Inject realistic block-shaped sensor outages (30 min – 7 days), and the solver
repairs the field in well under a second — no server, no GPU, no training.

That is the point. The paper's central claim is that STMAC is training-free: no training
set, no fitted model, and two scalar weights selected by block cross-validation on observed
cells. A method with no learning loop is portable enough to live inside a web page. The
trained Transformer baseline (136,000 parameters, 25 epochs) could not be demonstrated
this way.

## What runs in the page

- **Station climatology (MDV)** — for every cell, the mean of the observed values at the
  same time of day within a ±15-day window, computed from observed cells only (Eq. 4).
  STMAC reconstructs departures from this prior, and the same field is drawn as a baseline curve.
- **Sheaf-Laplacian spatial coupling** — k = 3 NN graph, Gaussian weights (σ = 300 km).
- **Longitude-sheaf restriction maps** — circular time shifts into local solar time by
  δ = (λ − λ̄)/(15°/h), measured from the network-mean longitude λ̄ as in Section III-B
  (integer-sample shifts here; the reference implementation uses FFT fractional shifts,
  a difference of at most 2.5 minutes).
- **One joint space-time solve** — the constrained problem of Eq. (5) reduces to a sparse
  symmetric positive-definite system over the unobserved cells (Eq. 6). Ordering the
  unknowns by (time, station) makes that system banded with half-bandwidth below 2N, so
  it is solved exactly by one banded Cholesky factorisation in 20 to 130 ms (the paper's
  Python reference uses sparse LU; both give the exact solution). The default weights are
  r = 1000 and g = 3 (the ratios r = αt/αs and g = γ/αs), the pair selected in the paper by
  block cross-validation; the page also lets you move both knobs to see what the selection
  is protecting against.
- **Ablation S0** — the same joint solver without the prior (C = 0, g = 0, r = 10), the S0
  column of Table I, run live next to STMAC.
- **Pure-temporal baseline** — banded Cholesky on `diag(M) + αt·D₂ᵀD₂` per station, αt = 10.
- **Scoring** — RMSE over the removed cells at clock hours 8 to 16 inclusive (08:00 to 16:55
  local time), the `DAYTIME` mask of the analysis notebooks; the paper describes it as
  "between 08:00 and 16:00".
- Live **block-length sweep** reproducing the shape of Fig. 1(a), S0 included, and the
  **Vision 2030 cost model** of Eq. (7), with an RMSE-source toggle between the live run, the
  paper's full-year figures averaged over the seven block lengths (Table II), and the
  cloudy-cell subset of Section V-F.

The JavaScript code implements the same solver as the Python reference
(`stmac_joint.py`). No numerical agreement figure is quoted here or in the paper, because
no comparison log is shipped in this repository.

## Live numbers vs. the paper's Table I

The page quotes Table I in full: the full-year columns (20 masks: pure temporal, climatology,
Transformer, S0, STMAC) and the held-out columns (7 Nov to 31 Dec 1999, 30 masks). Numbers
computed live here will not equal the full-year column. Table I averages 20 mask
realisations over the **full year** (101,805 timestamps); this page embeds a 70-day winter
subset with lower absolute irradiance and draws a single mask at a time. That window
(22 Oct – 30 Dec 1999) overlaps the **held-out period** used for the Transformer comparison,
so the live errors sit closer to the held-out column: with the default mask STMAC runs 58 to
100 W/m² across block lengths, against 61 to 99 W/m² in the paper's held-out column.

The structure carries over. Pure temporal is the most accurate method for gaps up to about
two hours and then collapses by an order of magnitude or more. The station climatology is
nearly flat across block lengths. STMAC stays below the climatology on short and medium
gaps, and on all cells the two converge on multi-day gaps, where the diurnal prior does most
of the work and the spatial correction adds only a few W/m². Without the prior, the joint
solver (S0) beats the climatology only at 30 minutes, as in the paper. Split by sky condition
the convergence disappears: on cloudy cells (11.7% of the evaluation; the notebooks call a
day cloudy at a daily clear-sky index of at most 0.70) STMAC stays 9.1 to 180.1 W/m² below
the climatology at every block length, against 1.3 to 58.9 W/m² on clear cells, where the
margin is not significant beyond a day. Trivial and longitude sheaves differ by a fraction of
a W/m² in a single draw; the paper finds the alignment significant only for gaps up to six
hours (1.59, 1.06 and 0.30 W/m² at 30 minutes, 2 hours and 6 hours).

## Data provenance

The embedded window derives from the 1999 Saudi solar-radiation network record
(11 stations; codes `sv, sk, gs, jn, ah, qa, ma, ab, wd, sh, gn`), cleaned as
described in the paper (SERI-QC sentinel filtering). 0.87% of rows absent from the
all-valid record were linearly interpolated before embedding. Timestamps are Saudi
local clock (UTC+3); station identities were cross-verified by solar-noon inference
from the data itself. Values are quantised to integer W/m². If redistribution terms
of the underlying dataset require it, replace `assets/data/nlr1999.js` with the built-in
synthetic mode (toggle in the UI) before public hosting.

## Analysis notebooks

The experimental pipeline is published under [`notebooks/`](notebooks/), with outputs
preserved from the runs that produced the paper's numbers. Notebook `12` contains the
corrected joint solver, the rerun of every experiment against it, and the baselines added
during the camera-ready revision (station climatology, held-out Transformer evaluation).
Notebook `12b` holds the sheaf ablation inside the climatology formulation and the
per-network weight selection on the satellite field. Notebook `13` rebuilds the paper figure
from the stored CSVs and cross-checks every number quoted in the manuscript against its
artefact. The earlier notebooks record the
experiments as they were first run and are kept for provenance; where their numbers differ
from the paper, notebooks `12` and `12b` are the ones that produced the published values.
See `notebooks/README.md` for the pipeline map and data availability.

## Reading the page interactively

Every figure answers a click with a reading computed from the run on screen; paper figures
are always labelled as such.

- **Map:** hover a station or an edge for its numbers. Click a station for its solar noon,
  longitude-sheaf shift, graph neighbours, per-station errors and cloudy-day count; click an
  edge for its distance, weight and the correlation of the two stations' departures from
  their climatology (solar-time aligned and at equal clock time).
- **Reconstruction chart:** hover for the values of every series at that time; click to pin
  a time and read the errors there, what the graph neighbours measured at the solar-aligned
  time, and the day's clear-sky index. Without a pin, the box summarises the current gap and
  links to the hardest and easiest gaps of the station.
- **Error cards:** click a card for the per-station breakdown, MAE, bias and the range of the
  method's estimates inside the gaps; the chosen series is highlighted in the chart.
- **Table I rows:** click a row to compare the paper's figures with the live run at the same
  block length, or to run that block length.
- **Sweep:** hover a block length for all four errors; click a point for the ordering, the
  margin over the climatology, the growth from 30 minutes and the Table I figures, with a
  button that loads that block length into the reconstruction chart.
- **Cost bars:** click a bar for its annual cost, the cost of 1 W/m² at the current levers,
  the gap to STMAC and the penalty at which that gap passes $1M a year.
- **Badges:** click for the timing breakdown of the last solve, the size of the banded
  system, and the weights in use.

The charts are keyboard accessible: focus a chart and use the arrow keys (the hint under each
chart lists the keys).

## Project layout

```
index.html                  markup only
assets/css/stmac.css        styles
assets/js/stmac-core.js     solver and statistics (no DOM), shared by the worker and the page
assets/js/stmac-worker.js   Web Worker that runs the solver off the main thread
assets/js/app.js            charts, map, controls and the interpretation layer
assets/js/fx.js             static background (painted once)
assets/data/nlr1999.js      the 70-day NLR window, int16, delta-encoded, base64
assets/fonts/               Outfit and IBM Plex Mono (SIL OFL 1.1, licences included)
assets/img/                 favicon and social preview
```

The solver code is unchanged from the single-file version; `stmac-core.js` reproduces its
reconstructions and errors bit for bit. Each scenario runs in a Web Worker, and the
block-length sweep is spread over up to three extra workers, so the page stays responsive
while the factorisations run. When workers are unavailable the same code runs on the main
thread.

## Tests

`tests/` holds the regression suite: a differential test that runs the original single-file
solver next to the refactored one and requires bit-for-bit agreement, browser tests for every
interactive reading, and an informational performance report. It runs in GitHub Actions on
every pull request; see `tests/README.md` to run it locally.

## Run / deploy

- **Locally:** serve the folder, for example `python3 -m http.server 8000`, and open
  `http://localhost:8000/`. Opening `index.html` straight from disk also works, but browsers
  block workers and web fonts on `file://` pages, so the solver then runs on the main thread
  and the fonts fall back to system fonts.
- **GitHub Pages:** push this folder to a repo → Settings → Pages → deploy from
  branch `main`, root. The page appears at `https://<user>.github.io/<repo>/`.

## Cite

> A. Barata, "Training-Free Solar Resource Reconstruction via Cellular Sheaves:
> A Spatial-Temporal Framework for Saudi Vision 2030," IEEE SUSTAIN 2026, KFUPM,
> Saudi Arabia, 2026.

Code: MIT (see LICENSE). The embedded observational data remains subject to the
terms of its original providers.

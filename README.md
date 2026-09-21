# STMAC Live Console

**Interactive, in-browser companion to the IEEE SUSTAIN 2026 paper:**
*Training-Free Solar Resource Reconstruction via Cellular Sheaves: A Spatial-Temporal
Framework for Saudi Vision 2030* — Amrin Barata, Faculty of Mathematics and Natural
Sciences, Universitas Syiah Kuala.

**Live demo:** https://barata90.github.io/stmac-demo/

## What this is

A single self-contained HTML file that runs the STMAC reconstruction pipeline
client-side, in JavaScript, on **70 days of the real 1999 Saudi NLR record**
(Oct 22 – Dec 30, 1999; 11 stations, 5-minute GHI) embedded directly in the page.
Inject realistic block-shaped sensor outages (30 min – 7 days), and the solver
repairs the field in well under a second — no server, no GPU, no training.

That is the point. The paper's central claim is that STMAC is training-free: no training
set, no fitted model, and two scalar weights selected by block cross-validation on observed
cells. A method with no learning loop is portable enough to live inside a web page. The
trained Transformer baseline (136,000 parameters, 25 epochs) could not be demonstrated
this way.

## What runs in the page

- **Station climatology (MDV)** — for every cell, the mean of the observed values at the
  same time of day within a ±15-day window, computed from observed cells only. STMAC
  reconstructs departures from this prior, and the same field is drawn as a baseline curve.
- **Sheaf-Laplacian spatial coupling** — k = 3 NN graph, Gaussian weights (σ = 300 km).
- **Longitude-sheaf restriction maps** — circular time shifts into local solar time
  (integer-sample shifts here; the reference implementation uses FFT fractional shifts,
  a difference of at most 2.5 minutes).
- **One joint space-time solve** — the constrained problem of Eq. (5) reduces to a sparse
  symmetric positive-definite system over the unobserved cells (Eq. 6). Ordering the
  unknowns by (time, station) makes that system banded with half-bandwidth below 2N, so
  it is solved exactly by one banded Cholesky factorisation in 20 to 130 ms. The default
  weights are r = 1000 and γ = 3, the pair selected in the paper by block cross-validation;
  the page also lets you move both knobs to see what the selection is protecting against.
- **Pure-temporal baseline** — banded Cholesky on `diag(M) + αt·D₂ᵀD₂` per station, αt = 10.
- Live **block-length sweep** reproducing the shape of Fig. 1(a), and the **Vision 2030 cost
  model** of Eq. (7), with an RMSE-source toggle between the live run, the paper's full-year
  figures averaged over the seven block lengths, and the cloudy-cell subset of Section V-F.

The JavaScript code implements the same solver as the Python reference
(`stmac_joint.py`). No numerical agreement figure is quoted here or in the paper, because
no comparison log is shipped in this repository.

## Live numbers vs. the paper's Table I

Numbers computed live here will not equal the full-year column of Table I. Table I averages
20 mask realisations over the **full year** (101,805 timestamps); this page embeds a 70-day
winter subset with lower absolute irradiance and draws a single mask at a time. That window
(22 Oct – 30 Dec 1999) overlaps the **held-out period** used for the Transformer comparison,
so the live errors sit closer to the held-out column: STMAC around 54 to 94 W/m² across
block lengths, against 61 to 99 W/m² in the paper.

The structure carries over. Pure temporal is the most accurate method for gaps up to about
two hours and then collapses by an order of magnitude or more. The station climatology is
nearly flat across block lengths. STMAC stays below the climatology on short and medium
gaps, and on all cells the two converge on multi-day gaps, where the diurnal prior does most
of the work and the spatial correction adds only a few W/m². Split by sky condition that
convergence disappears: on cloudy cells (11.7% of the evaluation, daily clear-sky index at
most 0.70) STMAC stays 9.1 to 180.1 W/m² below the climatology at every block length, while
on clear cells the margin is no longer significant beyond a day. Trivial and longitude sheaves differ by a
fraction of a W/m² in a single draw; the paper finds the alignment significant only for gaps
up to six hours.

## Data provenance

The embedded window derives from the 1999 Saudi solar-radiation network record
(11 stations; codes `sv, sk, gs, jn, ah, qa, ma, ab, wd, sh, gn`), cleaned as
described in the paper (SERI-QC sentinel filtering). 0.87% of rows absent from the
all-valid record were linearly interpolated before embedding. Timestamps are Saudi
local clock (UTC+3); station identities were cross-verified by solar-noon inference
from the data itself. Values are quantised to integer W/m². If redistribution terms
of the underlying dataset require it, replace the embedded payload with the built-in
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

## Run / deploy

- **Locally:** open `index.html` in any modern browser. No build, no dependencies.
- **GitHub Pages:** push this folder to a repo → Settings → Pages → deploy from
  branch `main`, root. The page appears at `https://<user>.github.io/<repo>/`.

## Cite

> A. Barata, "Training-Free Solar Resource Reconstruction via Cellular Sheaves:
> A Spatial-Temporal Framework for Saudi Vision 2030," IEEE SUSTAIN 2026, KFUPM,
> Saudi Arabia, 2026.

Code: MIT (see LICENSE). The embedded observational data remains subject to the
terms of its original providers.

# STMAC Live Console

**Interactive, in-browser companion to the IEEE SUSTAIN 2026 paper:**
*Training-Free Solar Resource Reconstruction via Cellular Sheaves: A Spatial-Temporal
Framework for Saudi Vision 2030* — Amrin Barata, BPS—Statistics Indonesia.

**Live demo:** https://barata90.github.io/stmac-demo/

## What this is

A single self-contained HTML file that runs the full STMAC reconstruction pipeline
client-side, in JavaScript, on **70 days of the real 1999 Saudi NLR record**
(Oct 22 – Dec 30, 1999; 11 stations, 5-minute GHI) embedded directly in the page.
Inject realistic block-shaped sensor outages (30 min – 7 days), and the solver
repairs the field in a few hundred milliseconds — no server, no GPU, no training.

That is the point. The paper's central claim is that STMAC is training-free with
O(N²T) per-iteration cost; a method with no learning loop is portable enough to
live inside a web page. The trained Transformer baseline (136,000 parameters,
25 epochs) could not be demonstrated this way.

## What runs in the page

- **Pentadiagonal temporal solves** — banded Cholesky on `diag(M) + αt·D₂ᵀD₂`, per station.
- **Sheaf-Laplacian spatial coupling** — k = 3 NN graph, Gaussian weights (σ = 300 km),
  per-timestamp 11×11 Cholesky with **pattern-grouped factor caching**, as in Algorithm 1.
- **Longitude-sheaf restriction maps** — circular time shifts relative to the network
  mean longitude, matching the reference implementation (integer-sample shifts here;
  the reference uses FFT fractional shifts — difference ≤ 2.5 min).
- **Alternating Tikhonov iteration** (4 iterations, αt = 10, αs = 1). This demo uses a
  proximal-alternating variant: masked cells carry a weak fidelity (β = 0.4) to the
  previous half-step, a standard splitting that preserves Algorithm 1's structure.
- Live **block-length sweep** reproducing the shape of Fig. 1, and the **Vision 2030
  economic model** of Eq. (5) with the paper's tornado sensitivity analysis.

## Live numbers vs. the paper's Table I

Numbers computed live here will not equal Table I, deliberately and for honest reasons:
Table I is the **full-year** record (101,805 timestamps) with the reference FFT-shift
solver; this page embeds a 70-day winter subset (lower absolute irradiance → lower
absolute RMSE) and uses the proximal variant. The **structure is identical**: pure
temporal collapses by an order of magnitude or more as blocks lengthen, STMAC stays
essentially flat, the crossover sits near 6–12 h, and the longitude sheaf consistently
matches or edges out the trivial sheaf. Table I is quoted verbatim in the UI as the
benchmark of record.

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

The full experimental pipeline (data download and QC, graph construction, the STMAC
solver, the block-length sweep of Table I, the Transformer baseline, the persistence
exploration, and the Vision 2030 economics) is published under
[`notebooks/`](notebooks/), with outputs preserved from the runs that produced the
paper's numbers. See `notebooks/README.md` for the pipeline map and data availability.

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

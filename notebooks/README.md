# Analysis notebooks

The complete experimental pipeline behind the paper, in execution order. Cell outputs are
preserved **exactly as produced by the runs that generated the paper's reported numbers**;
markdown commentary was editorially revised for publication, with code cells and their
outputs left byte-for-byte unmodified.

| Notebook | What it does | Paper mapping |
|---|---|---|
| `01_E1_MAC_1D_sanity_check` | Downloads and parses the Solar Village record (1998–2002), validates temporal MAC on synthetic and real GHI, ablates PSNR/RMSE vs sampling rate | Section V-A (E1) |
| `02_E2_spatial_MAC_Saudi_network` | Downloads the remaining 10 stations for 1999, builds the kNN geographic graph, benchmarks spatial-only methods (graph MAC, kriging, IDW), Sakaka case study | Section V-A (E2); graph used in Sections III–IV |
| `03_E3_STMAC_cellular_sheaf` | Formulates STMAC on the cellular sheaf, longitude restriction maps, density sweep, trivial-vs-longitude comparison | Sections III–IV, Section V |
| `03b_E3_block_missingness_headline` | SERI-QC `9900` sentinel cleanup; the block-length sweep that anchors the paper | Section V-B (Fig. 1, Table I) |
| `04_E4_transformer_baseline` | 136k-parameter multi-station Transformer, trained 25 epochs; head-to-head on the identical block sweep | Section V-C (Table I) |
| `05_E5_higher_order_persistence` | Persistence-diagram quality control (superseded in part by E5b) | Section VI-B |
| `05b_E5_persistence_FIX` | Correction of the Wasserstein convention used in E5 | Section VI-B |
| `05c_E5_block_missing_persistence` | Persistence on the block-missing scenario; surfaces the climatology bias of persistence-W1 | Section VI-B (limitation) |
| `06_E6_vision2030_economic_impact` | Eq. (5) economic translation, three Vision 2030 scenarios, tornado sensitivity | Section V-D (Table II, Fig. 3), Section VI-A |

## Data availability

The raw observations are the NLR–KACST Saudi solar-radiation network monthly files
(1998–2003), publicly downloadable; notebooks E1–E2 fetch them directly from a URL
manifest and parse the SERI-QC format from scratch. Derived artefacts
(`multistation_1999_cleaned.parquet`, graph matrices, `stations.json`) are regenerated
by running E1 → E2 → E3b in order. They are not committed to this repository; the
pipeline is the reproducible object.

## Environment

Python ≥ 3.10 with `numpy`, `scipy`, `pandas`, `pyarrow`, `matplotlib`; additionally
`torch` (CPU is sufficient) for E4 and `gudhi` for E5–E5c. No GPU is required anywhere
in the pipeline — a point the paper makes deliberately.

## Relation to the live demo

The demo at the repository root (`index.html`) re-implements the E3b solver in
JavaScript with a proximal-alternating variant and integer solar-time shifts, embedding
a 70-day subset of the same record; see the demo's in-page notes for the exact
correspondences and differences.

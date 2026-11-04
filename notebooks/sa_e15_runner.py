"""
sa_e15_runner.py
================

Penggerak eksperimen E15: membangun masukan (beban, PV, estimasi PV dari rekonstruksi),
menjalankan simulasi penjadwalan dua tahap, dan menyimpan hasil per kasus ke CSV agar bisa
dilanjutkan bila terhenti. Fungsi pekerja berada di modul ini supaya multiprocessing berjalan
di macOS (spawn) maupun Linux (fork).
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd

import sa_load_model as lm
import sa_uc_model as uc

PR = 0.85                      # rasio kinerja PV (AC/DC termasuk suhu dan susut), CF ~0,21
Z_RES = 1.645                  # kuantil 95% satu sisi untuk cadangan berbasis ketidakpastian


def hourly_index(year=1999):
    return pd.date_range(f"{year}-01-01 00:00", f"{year}-12-31 23:00", freq="h")


def solar_up(hours, lats, lons, utc_offset_h=3.0):
    """Indikator matahari di atas horizon per stasiun per jam (titik tengah jam)."""
    import sky_tools as sk
    mid = hours + pd.Timedelta(minutes=30)
    return np.stack([sk.solar_cosz(mid, la, lo, utc_offset_h) > 0 for la, lo in zip(lats, lons)], axis=1)


def postprocess(G_hat, up):
    """Perlakuan seragam untuk semua metode: GHI negatif dipotong nol dan GHI malam = 0."""
    return np.where(up, np.clip(G_hat, 0.0, None), 0.0)


def pv_mw(G, cap_gw):
    """Daya PV per jam (MW) dengan kapasitas dibagi rata ke 11 lokasi stasiun."""
    n = G.shape[1]
    return (cap_gw * 1000.0 / n) * np.minimum(1.0, PR * G / 1000.0)


def sigma_out(missfrac, cap_gw, rmse_wm2):
    """Simpangan baku galat estimasi PV (MW) per jam saat padam, dengan galat antarstasiun
    dianggap independen: sqrt(sum_v (cap_v * PR * RMSE / 1000 * miss_v)^2)."""
    n = missfrac.shape[1]
    s_v = (cap_gw * 1000.0 / n) * PR * rmse_wm2 / 1000.0
    return np.sqrt(((s_v * missfrac) ** 2).sum(1))


def run_case(args):
    """Satu kasus: (key, params). Mengembalikan dict ringkasan. Dipanggil oleh Pool."""
    key, p = args
    t0 = time.time()
    sysm = uc.System(uc.default_fleet_2025(), fuel_price=p["fuel_price"])
    D = np.load(p["load_path"])
    G_true = np.load(p["true_path"])
    z = np.load(p["recon_path"]) if p["method"] != "perfect" else None
    up = np.load(p["up_path"])
    cap = p["cap_gw"]
    PVt = pv_mw(G_true, cap).sum(1)
    if p["method"] == "perfect":
        rows, ust = uc.simulate_year(sysm, D, PVt, PVt)
        np.save(p["ustart_out"], ust)
        R = pd.DataFrame(rows)
        R.to_csv(p["days_out"], index=False)
        out = dict(key=key, n_days=len(R), sec=time.time() - t0)
        for c in ["fuel_mmbtu", "fuel_cost", "start_cost", "voll_cost", "shed_mwh", "curtail_mwh", "pv_used_mwh"]:
            out[c] = float(R[c].sum())
        for k in range(len(sysm.clusters)):
            out[f"fuel_mmbtu_{k}"] = float(R[f"fuel_mmbtu_{k}"].sum())
            out[f"gen_mwh_{k}"] = float(R[f"gen_mwh_{k}"].sum())
            out[f"starts_{k}"] = float(R[f"starts_{k}"].sum())
        return out
    G_hat = postprocess(z[p["method"]], up)
    PVh = pv_mw(G_hat, cap).sum(1)
    extra = None
    if p["reserve"] == "uncertainty":
        extra = Z_RES * sigma_out(z["missfrac"], cap, p["rmse"])
    base = pd.read_csv(p["days_base"])
    ust = np.load(p["ustart_base"])
    err_day = np.abs(PVh - PVt).reshape(-1, 24).sum(1)
    if extra is not None:
        err_day = err_day + extra.reshape(-1, 24).sum(1)
    days = np.flatnonzero(err_day > 1.0)
    rows = uc.simulate_days(sysm, D, PVt, PVh, days, ust, extra_reserve=extra)
    R = pd.DataFrame(rows)
    b = base.set_index("day").loc[days]
    out = dict(key=key, n_days=int(len(days)), sec=time.time() - t0,
               abs_err_mwh=float(np.abs(PVh - PVt).sum()),
               over_mwh=float(np.clip(PVh - PVt, 0, None).sum()),
               under_mwh=float(np.clip(PVt - PVh, 0, None).sum()))
    for c in ["fuel_cost", "start_cost", "voll_cost", "shed_mwh", "curtail_mwh"]:
        out["d_" + c] = float(R[c].sum() - b[c].sum())
    for k in range(len(sysm.clusters)):
        out[f"d_fuel_mmbtu_{k}"] = float(R[f"fuel_mmbtu_{k}"].sum() - b[f"fuel_mmbtu_{k}"].sum())
        out[f"d_gen_mwh_{k}"] = float(R[f"gen_mwh_{k}"].sum() - b[f"gen_mwh_{k}"].sum())
    out["d_fuel_mmbtu"] = float(R["fuel_mmbtu"].sum() - b["fuel_mmbtu"].sum())
    out["d_total_cost"] = out["d_fuel_cost"] + out["d_start_cost"] + out["d_voll_cost"]
    return out

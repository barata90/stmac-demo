"""
sa_uc_model.py
==============

Simulasi penjadwalan dua tahap sistem tenaga Arab Saudi (simpul tunggal, resolusi per jam)
untuk menilai biaya ekonomi galat estimasi daya PV saat sensor irradiansi padam.

Tahap 1 (penjadwalan intrahari): unit commitment MILP per hari dengan kluster pembangkit
(clustered unit commitment), memakai estimasi PV dari rekonstruksi pada sel yang padam.
Tahap 2 (real time): komitmen unit lambat (CCGT, uap) dikunci dari tahap 1; unit cepat
(turbin gas siklus terbuka) boleh dinyalakan ulang; dispatch dioptimalkan ulang terhadap PV
aktual. PV boleh dibatasi (curtailment) tanpa biaya; beban yang tidak terlayani dikenai VOLL.

Biaya galat rekonstruksi = biaya tahap 2 metode tersebut dikurangi biaya tahap 2 dengan
informasi PV sempurna. Biaya bahan bakar dinilai pada opportunity cost (paritas ekspor minyak
mentah), sehingga semua bahan bakar memiliki harga per MMBtu yang sama dan urutan merit hanya
ditentukan oleh efisiensi.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import sparse
from scipy.optimize import LinearConstraint, Bounds, milp

MMBTU_PER_BBL = 5.8          # EIA, minyak mentah
MWH_TO_MMBTU = 3.412142      # 1 MWh = 3,412 MMBtu


@dataclass
class Cluster:
    name: str
    fuel: str                # "gas" atau "liquid"
    installed_mw: float
    unit_mw: float
    efficiency: float        # efisiensi net (fraksi)
    pmin_frac: float
    start_cost_per_mw: float # USD per MW kapasitas unit per start (C&M, Kumar dkk. 2012)
    fast: bool               # boleh di-commit ulang pada tahap real time
    availability: float = 0.95

    @property
    def n_units(self):
        return int(round(self.installed_mw / self.unit_mw))

    @property
    def pmax_unit(self):
        return self.unit_mw * self.availability

    @property
    def heat_rate(self):     # MMBtu per MWh
        return MWH_TO_MMBTU / self.efficiency


@dataclass
class System:
    clusters: list
    fuel_price: float = 11.9       # USD/MMBtu (Brent 69 USD/bbl / 5,8)
    voll: float = 10000.0          # USD/MWh
    res_load: float = 0.03         # aturan 3+5 (WWSIS, GE Energy 2010)
    res_pv: float = 0.05
    mip_gap: float = 1e-8          # celah relatif MILP; selisih biaya harian jauh lebih kecil dari 1e-4
    relax_fast: bool = True        # komitmen unit cepat (OCGT, GT) kontinu: relaksasi kluster
    names: list = field(init=False)

    def __post_init__(self):
        self.names = [c.name for c in self.clusters]


def _build_day(system, demand, pv_avail, u_prev, fixed_u=None, reserve=True, extra_res=None):
    """Rakit dan selesaikan MILP satu hari. Variabel per kluster per jam: u (integer), s (start),
    p (MW); per jam: q (PV terpakai), z (beban tak terlayani)."""
    C = system.clusters; K = len(C); H = len(demand)
    nU = K * H
    iu = lambda k, t: k * H + t
    is_ = lambda k, t: nU + k * H + t
    ip = lambda k, t: 2 * nU + k * H + t
    iq = lambda t: 3 * nU + t
    iz = lambda t: 3 * nU + H + t
    n = 3 * nU + 2 * H
    c = np.zeros(n)
    lb = np.zeros(n); ub = np.full(n, np.inf)
    integ = np.zeros(n)
    for k, cl in enumerate(C):
        for t in range(H):
            c[ip(k, t)] = cl.heat_rate * system.fuel_price
            c[is_(k, t)] = cl.start_cost_per_mw * cl.unit_mw
            integ[iu(k, t)] = 0 if (cl.fast and system.relax_fast) else 1
            ub[iu(k, t)] = cl.n_units
            if fixed_u is not None and not cl.fast:
                lb[iu(k, t)] = ub[iu(k, t)] = fixed_u[k, t]
    for t in range(H):
        c[iz(t)] = system.voll
        ub[iq(t)] = max(pv_avail[t], 0.0)
    rows, cols, vals, lo, hi = [], [], [], [], []
    r = 0
    # keseimbangan daya
    for t in range(H):
        for k in range(K):
            rows.append(r); cols.append(ip(k, t)); vals.append(1.0)
        rows += [r, r]; cols += [iq(t), iz(t)]; vals += [1.0, 1.0]
        lo.append(demand[t]); hi.append(demand[t]); r += 1
    # batas output per kluster
    for k, cl in enumerate(C):
        for t in range(H):
            rows += [r, r]; cols += [ip(k, t), iu(k, t)]; vals += [1.0, -cl.pmax_unit]
            lo.append(-np.inf); hi.append(0.0); r += 1
            rows += [r, r]; cols += [ip(k, t), iu(k, t)]; vals += [1.0, -cl.pmin_frac * cl.pmax_unit]
            lo.append(0.0); hi.append(np.inf); r += 1
    # start-up
    for k in range(K):
        for t in range(H):
            rows += [r, r]; cols += [is_(k, t), iu(k, t)]; vals += [1.0, -1.0]
            if t > 0:
                rows.append(r); cols.append(iu(k, t - 1)); vals.append(1.0)
                lo.append(0.0)
            else:
                lo.append(-float(u_prev[k]))
            hi.append(np.inf); r += 1
    # cadangan berputar (hanya tahap penjadwalan)
    if reserve:
        for t in range(H):
            for k, cl in enumerate(C):
                rows += [r, r]; cols += [iu(k, t), ip(k, t)]; vals += [cl.pmax_unit, -1.0]
            lo.append(system.res_load * demand[t] + system.res_pv * max(pv_avail[t], 0.0)
                      + (0.0 if extra_res is None else float(extra_res[t])))
            hi.append(np.inf); r += 1
    A = sparse.csr_matrix((vals, (rows, cols)), shape=(r, n))
    res = milp(c, constraints=LinearConstraint(A, lo, hi), integrality=integ,
               bounds=Bounds(lb, ub), options={"disp": False, "mip_rel_gap": system.mip_gap,
                                               "time_limit": 120})
    if res.x is None:
        raise RuntimeError(f"MILP gagal: {res.message}")
    x = res.x
    U = x[:nU].reshape(K, H).copy()
    for k, cl in enumerate(C):
        if not (cl.fast and system.relax_fast):
            U[k] = np.round(U[k])
    Sx = x[nU:2 * nU].reshape(K, H)
    P = x[2 * nU:3 * nU].reshape(K, H); Q = x[3 * nU:3 * nU + H]; Z = x[3 * nU + H:]
    return dict(U=U, S=Sx, P=P, Q=Q, Z=Z, obj=res.fun, status=res.status)


def _day_cost(system, rt):
    C = system.clusters
    hr = np.array([c.heat_rate for c in C])
    sc = np.array([c.start_cost_per_mw * c.unit_mw for c in C])
    fuel = rt["P"].sum(1) * hr
    out = {f"fuel_mmbtu_{k}": float(fuel[k]) for k in range(len(C))}
    out.update({f"gen_mwh_{k}": float(rt["P"][k].sum()) for k in range(len(C))})
    out.update({f"starts_{k}": float(rt["S"][k].sum()) for k in range(len(C))})
    return out | dict(
                fuel_mmbtu=float(fuel.sum()), fuel_cost=float(fuel.sum() * system.fuel_price),
                start_cost=float((rt["S"].sum(1) * sc).sum()),
                shed_mwh=float(rt["Z"].sum()), voll_cost=float(rt["Z"].sum() * system.voll),
                pv_used_mwh=float(rt["Q"].sum()))


def simulate_year(system, demand_mw, pv_true_mw, pv_hat_mw, day_hours=24):
    """Simulasi berurutan setahun (keadaan komitmen dibawa antarhari). Mengembalikan
    DataFrame per hari dan keadaan awal komitmen tiap hari."""
    import pandas as pd
    C = system.clusters
    D = len(demand_mw) // day_hours
    u_prev = np.array([c.n_units if not c.fast else 0 for c in C], float) * 0.6
    rows, u_start = [], []
    for d in range(D):
        sl = slice(d * day_hours, (d + 1) * day_hours)
        u_start.append(u_prev.copy())
        sch = _build_day(system, demand_mw[sl], pv_hat_mw[sl], u_prev, reserve=True)
        rt = _build_day(system, demand_mw[sl], pv_true_mw[sl], u_prev, fixed_u=sch["U"], reserve=False)
        r = _day_cost(system, rt)
        r["curtail_mwh"] = float(np.maximum(pv_true_mw[sl], 0).sum() - r["pv_used_mwh"])
        r["day"] = d
        rows.append(r)
        u_prev = rt["U"][:, -1]
    return rows, np.array(u_start)


def simulate_days(system, demand_mw, pv_true_mw, pv_hat_mw, days, u_start, day_hours=24,
                  extra_reserve=None):
    """Simulasi hari-hari tertentu saja (hari yang memuat galat estimasi PV), masing-masing
    dimulai dari keadaan komitmen run informasi sempurna pada hari itu. Hari tanpa galat
    identik dengan run informasi sempurna sehingga tidak perlu dihitung ulang."""
    rows = []
    for d in days:
        sl = slice(d * day_hours, (d + 1) * day_hours)
        ex = None if extra_reserve is None else extra_reserve[sl]
        sch = _build_day(system, demand_mw[sl], pv_hat_mw[sl], u_start[d], reserve=True, extra_res=ex)
        rt = _build_day(system, demand_mw[sl], pv_true_mw[sl], u_start[d], fixed_u=sch["U"],
                        reserve=False)
        r = _day_cost(system, rt)
        r["curtail_mwh"] = float(np.maximum(pv_true_mw[sl], 0).sum() - r["pv_used_mwh"])
        r["day"] = int(d)
        rows.append(r)
    return rows


def default_fleet_2025():
    """Armada termal 2025 (MW terpasang) yang disusun dari Laporan Keberlanjutan Saudi Energy
    2025 (kapasitas aktual SE: gas 23.551 MW, cair 33.097 MW), SEC H1-2025 (94,1 GW terhubung
    ke jaringan, 56,3 GW milik SE) dan WERA akhir 2022 menurut bahan bakar utama (MEES 2023).
    Pembagian teknologi di dalam kelompok bahan bakar adalah asumsi. Ketersediaan mengikuti
    ketersediaan musim panas SEC H1-2025 (siklus gabungan 97,8%, siklus terbuka 96,5%,
    uap 93,3%), karena kapasitas hanya mengikat pada musim panas."""
    return [
        Cluster("CCGT (gas)", "gas", 26000, 500, 0.50, 0.50, 55.0, False, 0.978),
        Cluster("OCGT (gas)", "gas", 20000, 150, 0.32, 0.30, 24.0, True, 0.965),
        Cluster("Uap (minyak)", "liquid", 33000, 400, 0.35, 0.40, 58.0, False, 0.933),
        Cluster("GT (minyak)", "liquid", 7000, 100, 0.28, 0.30, 24.0, True, 0.965),
    ]

"""
sa_load_model.py
================

Estimasi profil beban listrik per jam sistem Arab Saudi (tingkat pembangkitan, termasuk
susut jaringan) dari statistik publik. Tidak ada data beban per jam nasional yang
dipublikasikan, sehingga profil disusun dengan pencocokan momen bertingkat (hierarchical
moment matching) terhadap statistik yang tersedia:

1. Rata-rata, maksimum, dan minimum beban bulanan per wilayah (Central, Eastern, Western,
   Southern), ECRA melalui portal data KAPSARC, 2015 sampai 2019.
2. Pangsa wilayah dari penjualan listrik Saudi Energy 2025 (MEES, 1 Mei 2026).
3. Bentuk harian dari kurva beban harian tipikal ECRA (Krarti dkk., Energies 12(1):87, 2019):
   musim panas 13:00 sekitar 52 GW dan 19:00 sekitar 51 GW pada hari kerja; musim dingin
   13:00 sekitar 26,5 GW dan 19:00 sekitar 30 GW. Jam lain mengikuti siklus suhu harian
   (minimum menjelang fajar, maksimum sore hari).
4. Efek hari Jumat: beban musim panas 10-15% lebih rendah dari hari kerja (ECRA 2019 melalui
   Alanazi dkk., World Electr. Veh. J. 13(5):84, 2022).
5. Beban puncak 2025 sebesar 77,083 GW (GASTAT/KAPSARC; MEES) dan energi tahunan
   tingkat pembangkitan 2025 sebesar 429,1 TWh (Laporan Keberlanjutan Saudi Energy 2025:
   237,82 TWh pembangkitan milik SE + 191,32 TWh pasokan dari pihak lain).

Semua langkah deterministik. Parameter amplitudo harian dikalibrasi per wilayah per bulan
agar maksimum bulanan sama dengan data; minimum bulanan dipakai sebagai validasi.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

REGIONS = ["Central", "Eastern", "Western", "Southern"]

# Pangsa wilayah dari penjualan Saudi Energy 2025 (TWh), MEES 1 Mei 2026, chart 2
SALES_2025 = {"Central": 349.16 - 107.33 - 92.65 - 36.86, "Western": 107.33,
              "Eastern": 92.65, "Southern": 36.86}

PEAK_2025_GW = 77.083
ENERGY_2025_TWH = 237.82 + 191.32

# Templat bentuk harian (nilai relatif terhadap jam tertinggi), jam lokal 0..23.
# Jangkar ECRA 2015 (Krarti dkk. 2019): musim panas 19:00/13:00 = 51/52; musim dingin
# 13:00/19:00 = 26,5/30. Jam lain: interpolasi linear dengan minimum pukul 05:00.
_SUMMER_ANCHORS = {0: 0.93, 2: 0.88, 5: 0.84, 7: 0.86, 9: 0.93, 11: 0.99, 13: 1.00,
                   15: 1.00, 17: 0.99, 19: 51.0 / 52.0, 21: 0.975, 23: 0.95}
_WINTER_ANCHORS = {0: 0.80, 2: 0.75, 5: 0.72, 7: 0.78, 9: 0.86, 11: 0.88, 13: 26.5 / 30.0,
                   15: 0.87, 17: 0.93, 19: 1.00, 21: 0.95, 23: 0.86}
FRIDAY_FACTOR = 0.875          # titik tengah 10-15% lebih rendah (ECRA 2019)


def _template(anchors):
    hrs = np.array(sorted(anchors))
    vals = np.array([anchors[h] for h in hrs])
    x = np.concatenate([hrs, [hrs[0] + 24]])
    y = np.concatenate([vals, [vals[0]]])
    s = np.interp(np.arange(24), x, y)
    return s / s.mean()


S_SUMMER = _template(_SUMMER_ANCHORS)
S_WINTER = _template(_WINTER_ANCHORS)


def monthly_stats(path_parquet, years=range(2015, 2020)):
    """Statistik bulanan ternormalisasi per wilayah: A (rata-rata bulan / rata-rata tahunan),
    rmax (maks / rata-rata), rmin (min / rata-rata). Baris yang tidak konsisten
    (rata-rata > maksimum atau minimum > rata-rata) dibuang sebelum dirata-rata."""
    d = pd.read_parquet(path_parquet)
    d["date"] = pd.to_datetime(d["date"])
    d["region"] = d.indicator.str.split(" ").str[0]
    d["stat"] = d.indicator.str.extract(r"(Average|Maximum|Minimum)")[0]
    p = d.pivot_table(index=["date", "region"], columns="stat", values="value").reset_index()
    p["year"] = p.date.dt.year; p["month"] = p.date.dt.month
    p = p[p.year.isin(list(years))].copy()
    ok = (p.Average <= p.Maximum) & (p.Minimum <= p.Average)
    dropped = p[~ok][["date", "region", "Average", "Maximum", "Minimum"]]
    p = p[ok]
    p["ann"] = p.groupby(["region", "year"]).Average.transform("mean")
    p["A"] = p.Average / p.ann
    p["rmax"] = p.Maximum / p.Average
    p["rmin"] = p.Minimum / p.Average
    st = p.groupby(["region", "month"])[["A", "rmax", "rmin"]].mean()
    for r in REGIONS:                     # normalisasi ulang agar rata-rata A = 1
        st.loc[r, "A"] = (st.loc[r, "A"] / st.loc[r, "A"].mean()).values
    nat = p.groupby(["year", "month"])[["Average", "Maximum", "Minimum"]].sum()
    return st, dropped, nat


def _daily_mean_curve(A_month, days_index):
    """Lintasan rata-rata harian dari 12 nilai bulanan: interpolasi periodik melalui
    titik tengah bulan, lalu dikoreksi perkalian agar rata-rata tiap bulan tepat sama."""
    doy = days_index.dayofyear.values
    mid = np.array([pd.Timestamp(1999, m, 15).dayofyear for m in range(1, 13)])
    x = np.concatenate([mid - 365, mid, mid + 365])
    y = np.tile(A_month, 3)
    from scipy.interpolate import PchipInterpolator
    c = PchipInterpolator(x, y)(doy)
    mon = days_index.month.values
    for m in range(1, 13):
        sel = mon == m
        c[sel] *= A_month[m - 1] / c[sel].mean()
    return c


def daily_factors(days, sigma0, phi=0.7, rho_common=0.7, seed=2025, regions=REGIONS):
    """Faktor harian log-normal dengan komponen AR(1): komponen bersama seluruh wilayah
    (bobot rho_common) dan komponen per wilayah. Menggambarkan variasi beban antarhari akibat
    cuaca yang tidak terlihat pada statistik bulanan. Mengembalikan dict wilayah -> array z
    berdistribusi N(0, 1) stasioner."""
    rng = np.random.default_rng(seed)
    n = len(days)

    def ar1():
        e = rng.standard_normal(n)
        z = np.zeros(n); z[0] = e[0]
        for i in range(1, n):
            z[i] = phi * z[i - 1] + np.sqrt(1 - phi ** 2) * e[i]
        return z
    common = ar1()
    return {r: np.sqrt(rho_common) * common + np.sqrt(1 - rho_common) * ar1() for r in regions}


def regional_hourly(st, hours, region, friday_factor=FRIDAY_FACTOR, z=None, sigma0=0.0):
    """Profil per jam ternormalisasi (rata-rata tahunan = 1) untuk satu wilayah. Rata-rata
    bulanan tepat sama dengan data; amplitudo harian dipilih per bulan dengan kuadrat terkecil
    pada log rasio maksimum dan minimum bulanan terhadap data.
    z: faktor acak harian N(0,1); simpangan log-faktor = sigma0 * (0,5 + 0,5 * bobot pendinginan)."""
    s = st.loc[region]
    A = s.A.values; rmax = s.rmax.values; rmin = s.rmin.values
    days = pd.DatetimeIndex(hours.normalize().unique())
    w_all = (A - A.min()) / (A.max() - A.min())
    dm = _daily_mean_curve(A, days)
    if z is not None and sigma0 > 0:
        wd = w_all[days.month.values - 1]
        dm = dm * np.exp(sigma0 * (0.5 + 0.5 * wd) * z)
    dm = pd.Series(dm, index=days)
    w_m = (A - A.min()) / (A.max() - A.min())          # bobot pendinginan bulanan
    out = np.zeros(len(hours)); alpha = np.zeros(12)
    mon = hours.month.values; hr = hours.hour.values
    fri = (hours.dayofweek.values == 4)
    for m in range(1, 13):
        sel = mon == m
        w = w_m[m - 1]
        shape = (1 - w) * S_WINTER + w * S_SUMMER
        base = dm.reindex(hours[sel].normalize()).values * np.where(fri[sel], friday_factor, 1.0)
        base *= A[m - 1] / base.mean()                   # jaga rata-rata bulanan
        t_max = rmax[m - 1] * A[m - 1]
        t_min = rmin[m - 1] * A[m - 1]

        def build(a):
            x = base * (1 + a * (shape[hr[sel]] - 1))
            return x * (A[m - 1] / x.mean())

        # amplitudo dipilih agar galat log maksimum dan minimum bulanan seimbang (kuadrat terkecil)
        grid = np.linspace(0.0, 4.0, 401)
        errs = []
        for a in grid:
            x = build(a)
            errs.append(np.log(x.max() / t_max) ** 2 + np.log(max(x.min(), 1e-6) / t_min) ** 2)
        a = float(grid[int(np.argmin(errs))])
        x = build(a)
        alpha[m - 1] = a
        out[sel] = x
    return out, alpha


def national_hourly(st, hours, shares=None, peak_gw=PEAK_2025_GW, sigma0=0.0, seed=2025,
                    phi=0.7, rho_common=0.7):
    """Beban nasional per jam (GW). Wilayah dijumlahkan dengan bobot pangsa energi, lalu
    diskalakan perkalian agar puncak tahunan = peak_gw. Energi tahunan menjadi hasil model
    dan dipakai sebagai validasi terhadap data 2025."""
    shares = shares or {r: SALES_2025[r] / sum(SALES_2025.values()) for r in REGIONS}
    days = pd.DatetimeIndex(hours.normalize().unique())
    Z = daily_factors(days, sigma0, phi, rho_common, seed) if sigma0 > 0 else {r: None for r in REGIONS}
    reg = {}; alphas = {}
    for r in REGIONS:
        reg[r], alphas[r] = regional_hourly(st, hours, r, z=Z[r], sigma0=sigma0)
    S = sum(shares[r] * reg[r] for r in REGIONS)
    b = peak_gw / S.max()
    L = b * S
    info = dict(b=b, mean_gw=L.mean(), energy_twh=L.sum() / 1000.0, load_factor=L.mean() / L.max(),
                alphas=alphas, shares=shares, regional={r: b * shares[r] * reg[r] for r in REGIONS},
                sigma0=sigma0, seed=seed)
    return L, info


def top_hours(L, frac=3.0 / 62.1):
    """Jumlah jam dengan beban di atas (1 - frac) x puncak. ECRA 2019: 3 GW teratas dari
    puncak 62,1 GW hanya terjadi 76 jam per tahun (Alanazi dkk., 2022)."""
    return int((L > L.max() * (1 - frac)).sum())

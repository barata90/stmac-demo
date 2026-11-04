"""
st_graph_recent.py
==================

Pembanding rekonstruksi sinyal graf bervariasi waktu (time-varying graph signal recovery)
untuk notebook E14. Ketiga metode bekerja pada sinyal mentah dengan peta restriksi identitas,
sesuai rumusan aslinya, dan tidak memerlukan training.

TVGSR      Qiu dkk., IEEE J-STSP 11(6), 2017. Kehalusan graf pada selisih temporal:
           min_X 1/2 ||J o (X - Y)||_F^2 + nu/2 tr((X D_h)^T L (X D_h))
GraphTRSS  Giraldo dkk., IEEE TSIPN 8, 2022, Pers. (17). Norma Sobolev pada selisih temporal:
           min_X 1/2 ||J o (X - Y)||_F^2 + nu/2 tr((X D_h)^T (L + eps I)^beta (X D_h))
           TVGSR adalah kasus eps = 0, beta = 1.
RTVGSR     Yamagata, Naganuma, Ono, IEEE TSIPN 11, 2025, Pers. (13). Untuk jaringan statis
           L_k = L sehingga rumusan menjadi
           min_X sum_k x_k^T L x_k + lam ||D(X)||_1
           s.t. ||Y - Phi(X + S)||_F <= eps_ball,  ||S||_1 <= eta
           Varian P(X) = X dengan suku temporal l1 (metode M/L pada Tabel II naskah aslinya).
           Dengan eta = 0 (tanpa pencilan yang disuntikkan) S = 0. Diselesaikan dengan
           primal-dual splitting (Algoritma 1 naskah aslinya).

Catatan implementasi
- TVGSR dan GraphTRSS adalah kuadrat konveks dengan minimizer tunggal. Naskah aslinya memakai
  conjugate gradient; di sini sistem normalnya diselesaikan langsung. Dengan vektorisasi
  kolom (indeks t*N + v), matriks diag(J) + nu (D_h D_h^T kron S) berbentuk pita dengan lebar
  setengah 2N - 1, sehingga dekomposisi Cholesky pita (LAPACK pbsv) memberi solusi eksak
  dalam O(N^3 T).
- RTVGSR memakai warm start interpolasi spasial per timestamp, bukan nol pada sel hilang.
  Ini hanya mengubah titik awal iterasi, bukan titik optimum.
- Semua fungsi menerima `prior` opsional (misalnya klimatologi MDV dari sel teramati).
  Bila diberikan, metode bekerja pada anomali Y - prior, lalu prior ditambahkan kembali.
"""

from __future__ import annotations

import time

import numpy as np
from scipy.linalg import solveh_banded, eigh

__all__ = ["sobolev_operator", "solve_sobolev_tv", "tvgsr", "graphtrss", "rtvgsr_pds",
           "objective_sobolev", "noise_sigma_mad"]


# ---------------------------------------------------------------------------
# Operator Sobolev (L + eps I)^beta
# ---------------------------------------------------------------------------
def sobolev_operator(L, eps=0.0, beta=1.0):
    L = np.asarray(L, float)
    if beta == 1.0:
        return L + eps * np.eye(L.shape[0])
    w, V = eigh(L + eps * np.eye(L.shape[0]))
    w = np.clip(w, 0.0, None)
    return (V * w ** beta) @ V.T


def _banded_system(mask, S, nu, jitter=1e-10):
    """Simpan diag(J) + nu (D_h D_h^T kron S) dalam format pita atas untuk solveh_banded.

    Indeks vektor i = t*N + v. Blok diagonal waktu (t, t) bernilai nu * a_tt * S dengan
    a_tt = 1 di ujung dan 2 di tengah; blok (t, t+1) bernilai -nu * S.
    """
    N, T = mask.shape
    u = 2 * N - 1
    n = N * T
    ab = np.zeros((u + 1, n))
    a_tt = np.full(T, 2.0); a_tt[0] = a_tt[-1] = 1.0
    tt = np.arange(T)
    for v in range(N):
        for w in range(N):
            s = S[v, w]
            if w >= v:
                d = w - v
                ab[u - d, tt * N + w] += nu * a_tt * s
            d = N + w - v                      # blok atas (t, t+1)
            if 1 <= d <= u and s != 0.0:
                ab[u - d, (tt[:-1] + 1) * N + w] += -nu * s
    ab[u] += mask.T.ravel().astype(float) + jitter
    return ab


def solve_sobolev_tv(Y, mask, L, nu, eps=0.0, beta=1.0, prior=None, return_info=False):
    """Minimizer eksak GraphTRSS (dan TVGSR bila eps = 0, beta = 1)."""
    t0 = time.time()
    Y = np.asarray(Y, float)
    mask = np.asarray(mask, bool)
    base = None if prior is None else np.asarray(prior, float)
    Z = np.where(mask, Y - (base if base is not None else 0.0), 0.0)
    N, T = Z.shape
    S = sobolev_operator(L, eps, beta)
    ab = _banded_system(mask, S, float(nu))
    rhs = Z.T.ravel()                          # J o Y pada urutan t*N + v
    x = solveh_banded(ab, rhs, lower=False, overwrite_ab=True, check_finite=False)
    X = x.reshape(T, N).T
    if base is not None:
        X = X + base
    info = dict(sec=time.time() - t0, nu=float(nu), eps=float(eps), beta=float(beta))
    return (X, info) if return_info else X


def tvgsr(Y, mask, L, nu, prior=None, return_info=False):
    return solve_sobolev_tv(Y, mask, L, nu, 0.0, 1.0, prior, return_info)


def graphtrss(Y, mask, L, nu, eps, beta, prior=None, return_info=False):
    return solve_sobolev_tv(Y, mask, L, nu, eps, beta, prior, return_info)


def objective_sobolev(X, Y, mask, L, nu, eps=0.0, beta=1.0):
    S = sobolev_operator(L, eps, beta)
    R = np.where(mask, X - Y, 0.0)
    G = np.diff(X, axis=1)
    return 0.5 * float(np.sum(R ** 2)) + 0.5 * nu * float(np.sum(G * (S @ G)))


# ---------------------------------------------------------------------------
# Yamagata dkk. (2025): primal-dual splitting
# ---------------------------------------------------------------------------
def noise_sigma_mad(Y, mask):
    """Taksiran simpangan baku derau pengamatan dari selisih orde dua pada sel teramati
    berurutan (MAD / 0.6745 / sqrt(6)). Dipakai untuk aturan eps_ball naskah aslinya."""
    Y = np.asarray(Y, float); mask = np.asarray(mask, bool)
    d2 = Y[:, 2:] - 2 * Y[:, 1:-1] + Y[:, :-2]
    ok = mask[:, 2:] & mask[:, 1:-1] & mask[:, :-2] & (Y[:, 1:-1] > 0)
    v = d2[ok]
    return float(np.median(np.abs(v - np.median(v))) / 0.6745 / np.sqrt(6.0))


def _spatial_init(Y, mask, L):
    """Interpolasi spasial per timestamp (minimizer x^T L x dengan sel teramati dikunci)."""
    N, T = Y.shape
    X = np.where(mask, Y, 0.0)
    codes = np.zeros(T, dtype=np.int64)
    for j in range(N):
        codes |= mask[j].astype(np.int64) << j
    for c in np.unique(codes):
        cols = np.flatnonzero(codes == c)
        obs = np.array([j for j in range(N) if (c >> j) & 1])
        mis = np.array([j for j in range(N) if not (c >> j) & 1])
        if mis.size == 0:
            continue
        if obs.size == 0:
            X[:, cols] = 0.0
            continue
        Lmm = L[np.ix_(mis, mis)] + 1e-9 * np.eye(mis.size)
        X[np.ix_(mis, cols)] = np.linalg.solve(Lmm, -L[np.ix_(mis, obs)] @ X[np.ix_(obs, cols)])
    return X


def rtvgsr_pds(Y, mask, L, lam, eps_ball=0.0, temporal="l1", vertex="X", prior=None,
               scale=1000.0, max_iter=3000, tol=1e-6, min_iter=100, X0=None, return_info=False):
    """Rumusan Yamagata dkk. (2025), Pers. (13), graf statis, eta = 0 (S = 0).

    min_X sum_k P(X)_k^T L P(X)_k + lam R_t(D(X))   s.t.  ||Phi(X) - Phi(Y)||_F <= eps_ball
    vertex='X'  : P(X) = X     (metode L/M pada Tabel II naskah aslinya)
    vertex='DX' : P(X) = D(X)  (metode H/I)
    R_t = ||.||_1 (temporal='l1') atau ||.||_F^2 (temporal='l2').

    Data diskalakan dengan `scale` (W/m2 -> kW/m2) agar ukuran langkah stabil; lam dan
    eps_ball dinyatakan pada skala itu. Kriteria henti: perubahan relatif X <= tol setelah
    paling sedikit min_iter iterasi, atau max_iter tercapai.
    """
    t0 = time.time()
    Y = np.asarray(Y, float)
    mask = np.asarray(mask, bool)
    base = None if prior is None else np.asarray(prior, float)
    Z = np.where(mask, Y - (base if base is not None else 0.0), 0.0) / scale
    L = np.asarray(L, float)
    N, T = Z.shape
    lmax = float(np.linalg.eigvalsh(L).max())
    beta_lip = 2.0 * lmax * (4.0 if vertex == "DX" else 1.0)   # Lipschitz gradien suku verteks
    g1 = 1.0 / beta_lip
    normA2 = 4.0 + 1.0                         # ||D||^2 <= 4, ||Phi||^2 = 1
    g2 = 0.49 / (g1 * normA2)
    X = _spatial_init(Z, mask, L) if X0 is None else (np.asarray(X0, float) - (base if base is not None else 0.0)) / scale
    V1 = np.zeros((N, T - 1))
    V2 = np.zeros((N, T))
    Zm = Z[mask]
    hist = []
    for it in range(max_iter):
        if vertex == "DX":
            Gd = L @ np.diff(X, axis=1)
            grad = np.zeros_like(X)
            grad[:, :-1] -= 2.0 * Gd
            grad[:, 1:] += 2.0 * Gd
        else:
            grad = 2.0 * (L @ X)
        DtV1 = np.zeros_like(X)
        DtV1[:, :-1] -= V1
        DtV1[:, 1:] += V1
        Xn = X - g1 * (grad + DtV1 + np.where(mask, V2, 0.0))
        Xb = 2.0 * Xn - X
        # dual suku temporal
        W1 = V1 + g2 * np.diff(Xb, axis=1)
        if temporal == "l1":
            V1 = np.clip(W1, -lam, lam)
        else:                                  # prox konjugat dari lam ||.||^2
            V1 = W1 / (1.0 + g2 / (2.0 * lam))
        # dual kendala bola-eps pada sel teramati
        W2 = V2 + g2 * np.where(mask, Xb, 0.0)
        u = W2[mask] / g2
        r = u - Zm
        nr = float(np.linalg.norm(r))
        if nr > eps_ball and nr > 0:
            proj = Zm + r * (eps_ball / nr)
        else:
            proj = u
        V2 = np.zeros_like(V2)
        V2[mask] = W2[mask] - g2 * proj
        rel = float(np.linalg.norm(Xn - X) / (np.linalg.norm(X) + 1e-12))
        X = Xn
        if it % 100 == 0:
            hist.append((it, rel))
        if rel <= tol and it + 1 >= min_iter:
            break
    out = X * scale
    if base is not None:
        out = out + base
    info = dict(iters=it + 1, rel_change=rel, sec=time.time() - t0, lam=float(lam),
                eps_ball=float(eps_ball), temporal=temporal, vertex=vertex, hist=hist)
    return (out, info) if return_info else out


# ---------------------------------------------------------------------------
# Yamagata dkk. (2025) dengan ADMM: optimum sama, konvergensi lebih cepat untuk P(X) = D(X)
# ---------------------------------------------------------------------------
def _banded_general(mask_w, B, C, jitter=1e-10):
    """Pita atas untuk matriks blok-tridiagonal: blok (t, t) = a_tt B + C + diag(mask_w[:, t]),
    blok (t, t+1) = -B, dengan a_tt = 1 di ujung dan 2 di tengah (D_h D_h^T)."""
    N, T = mask_w.shape
    u = 2 * N - 1
    ab = np.zeros((u + 1, N * T))
    a_tt = np.full(T, 2.0); a_tt[0] = a_tt[-1] = 1.0
    tt = np.arange(T)
    for v in range(N):
        for w in range(N):
            if w >= v:
                d = w - v
                ab[u - d, tt * N + w] += a_tt * B[v, w] + C[v, w]
            d = N + w - v
            if 1 <= d <= u and B[v, w] != 0.0:
                ab[u - d, (tt[:-1] + 1) * N + w] += -B[v, w]
    ab[u] += mask_w.T.ravel() + jitter
    return ab


def rtvgsr_admm(Y, mask, L, lam, eps_ball=0.0, temporal="l1", vertex="DX", prior=None,
                scale=1000.0, rho=1.0, max_iter=500, tol=1e-4, X0=None, return_info=False):
    """Rumusan yang sama dengan `rtvgsr_pds`, diselesaikan dengan ADMM.

    Variabel bantu Z1 = X D_h (suku temporal) dan Z2 = Phi(X) (kendala bola-eps). Langkah X
    adalah sistem kuadrat blok-tridiagonal yang difaktorkan sekali (Cholesky pita) lalu dipakai
    ulang. Kriteria henti residu primal dan dual relatif (Boyd dkk., 2011) <= tol.
    """
    from scipy.linalg import cholesky_banded, cho_solve_banded
    t0 = time.time()
    Y = np.asarray(Y, float)
    mask = np.asarray(mask, bool)
    base = None if prior is None else np.asarray(prior, float)
    Zd = np.where(mask, Y - (base if base is not None else 0.0), 0.0) / scale
    L = np.asarray(L, float)
    N, T = Zd.shape
    I = np.eye(N)
    if vertex == "DX":
        B, C = (2.0 * L + rho * I) / rho, np.zeros((N, N))
    else:
        B, C = I, 2.0 * L / rho
    cb = cholesky_banded(_banded_general(mask.astype(float), B, C), lower=False,
                         check_finite=False)
    yo = Zd[mask]
    X = _spatial_init(Zd, mask, L) if X0 is None else \
        (np.asarray(X0, float) - (base if base is not None else 0.0)) / scale
    Z1 = np.diff(X, axis=1); U1 = np.zeros_like(Z1)
    Z2 = X[mask].copy(); U2 = np.zeros_like(Z2)
    for it in range(max_iter):
        A1 = Z1 - U1
        rhs = np.zeros((N, T))
        rhs[:, :-1] -= A1
        rhs[:, 1:] += A1
        rhs[mask] += Z2 - U2
        X = cho_solve_banded((cb, False), rhs.T.ravel(), check_finite=False).reshape(T, N).T
        DX = np.diff(X, axis=1)
        V = DX + U1
        if temporal == "l1":
            Z1n = np.sign(V) * np.maximum(np.abs(V) - lam / rho, 0.0)
        else:
            Z1n = V * rho / (rho + 2.0 * lam)
        q = X[mask] + U2
        r = q - yo
        nr = float(np.linalg.norm(r))
        Z2n = yo + r * (eps_ball / nr) if nr > eps_ball else q
        U1 += DX - Z1n
        U2 += X[mask] - Z2n
        rp = np.sqrt(np.sum((DX - Z1n) ** 2) + np.sum((X[mask] - Z2n) ** 2))
        rd = rho * np.sqrt(np.sum((Z1n - Z1) ** 2) + np.sum((Z2n - Z2) ** 2))
        Z1, Z2 = Z1n, Z2n
        sc_p = max(np.sqrt(np.sum(DX ** 2) + np.sum(X[mask] ** 2)),
                   np.sqrt(np.sum(Z1 ** 2) + np.sum(Z2 ** 2)), 1e-12)
        sc_d = rho * np.sqrt(np.sum(U1 ** 2) + np.sum(U2 ** 2)) + 1e-12
        if rp / sc_p <= tol and rd / sc_d <= tol:
            break
    out = X * scale
    if base is not None:
        out = out + base
    info = dict(iters=it + 1, r_primal=rp / sc_p, r_dual=rd / sc_d, sec=time.time() - t0,
                lam=float(lam), eps_ball=float(eps_ball), temporal=temporal, vertex=vertex,
                rho=float(rho))
    return (out, info) if return_info else out

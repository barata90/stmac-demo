/* Solver tests (no browser).
 * 1. The data asset decodes to exactly the record the single-file page embedded.
 * 2. Differential: the original single-file solver and the refactored core, run on the same
 *    data in the same engine, agree bit for bit (RMSEs, unknowns, bandwidth, reconstructions).
 * 3. Snapshot: the core still gives the recorded reference numbers (1e-12 relative, because
 *    other JavaScript engines may round the last bit of Math functions differently).
 * 4. Invariants of the method and of the new statistics. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadCore, readReference, close } from './helpers.mjs';

const { Core, payload, makeSingleFileSolver, stmacDifferential } = loadCore();
const reference = readReference();
const N = Core.N;
const label = s => `${s.kind} seed ${s.seed}, ${Core.BLOCKS[s.blockIdx].lab}, ${Math.round(s.frac * 100)}% outage, mask ${s.maskSeed}, r ${s.r}, γ ${s.g}`;

test('data asset decodes to the record embedded in the single-file page', () => {
  assert.equal(payload.sha256, reference.dataSha256, 'payload header');
  const U = Core.decodeReal(payload);
  const T = payload.days * payload.samplesPerDay;
  const raw = Buffer.alloc(N * T * 2);
  for (let v = 0; v < N; v++) {
    assert.equal(U[v].length, T);
    for (let i = 0; i < T; i++) {
      assert.ok(Number.isInteger(U[v][i]) && U[v][i] >= -32768 && U[v][i] <= 32767, 'sample out of int16 range');
      raw.writeInt16LE(U[v][i], (v * T + i) * 2);
    }
  }
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), reference.dataSha256);
});

for (const s of reference.scenarios) {
  test('differential, bit for bit: ' + label(s), async () => {
    const [d] = await stmacDifferential(makeSingleFileSolver, Core, payload, [s]);
    assert.deepEqual(d.new, d.old);
  });
}

for (const s of reference.scenarios) {
  test('snapshot and consistency: ' + label(s), async () => {
    const engine = Core.createEngine(() => payload);
    const ld = await engine.handle({ op: 'load', p: { kind: s.kind, seed: s.seed } });
    assert.equal(ld.grid.T, s.T);
    const p = { dsKey: ld.key, blockIdx: s.blockIdx, frac: s.frac, maskSeed: s.maskSeed, r: s.r, g: s.g };
    const o = await engine.handle({ op: 'scenario', p });
    for (const k of ['n', 'bw', 'effFrac']) assert.equal(o[k], s[k], k);
    for (const k of ['rPT', 'rMDV', 'rSTL', 'rSTT']) assert.ok(close(o[k], s[k]), `${k}: ${o[k]} vs reference ${s[k]}`);
    /* the sweep path must give the same numbers as the scenario path */
    const sw = await engine.handle({ op: 'sweepBlock', p: Object.assign({ k: s.blockIdx }, p) });
    assert.deepEqual([sw.pt, sw.mdv, sw.sl, sw.st], [o.rPT, o.rMDV, o.rSTL, o.rSTT]);
    /* per-station statistics use the same cells; totals agree up to summation order */
    for (const [m, r] of [['PT', 'rPT'], ['MDV', 'rMDV'], ['STL', 'rSTL'], ['STT', 'rSTT']]) {
      assert.ok(close(o.stats[m].rmse, o[r], 1e-9), m + ' stats rmse');
      assert.equal(o.stats[m].st.reduce((a, x) => a + x.n, 0), o.stats[m].n);
    }
  });
}

test('STMAC and the climatology keep observed cells as measured', async () => {
  const engine = Core.createEngine(() => payload);
  const ld = await engine.handle({ op: 'load', p: { kind: 'real', seed: 42 } });
  const o = await engine.handle({ op: 'scenario', p: { dsKey: ld.key, blockIdx: 4, frac: 0.1, maskSeed: 11, r: 1000, g: 3 } });
  const U = Core.decodeReal(payload), T = ld.grid.T;
  let worstSTL = 0, worstSTT = 0, missing = 0;
  for (let v = 0; v < N; v++) for (let i = 0; i < T; i++) {
    const j = v * T + i;
    if (o.M[j]) {
      worstSTL = Math.max(worstSTL, Math.abs(o.STL[j] - U[v][i]));
      worstSTT = Math.max(worstSTT, Math.abs(o.STT[j] - U[v][i]));
      assert.equal(o.MDV[j], U[v][i]);
    } else missing++;
  }
  assert.ok(worstSTL < 1e-9, 'longitude sheaf changed an observed cell by ' + worstSTL);
  assert.ok(worstSTT < 1e-9, 'trivial sheaf changed an observed cell by ' + worstSTT);
  assert.equal(missing, o.n);
});

test('pair correlations are symmetric, bounded, and 1 on the diagonal', async () => {
  const engine = Core.createEngine(() => payload);
  const ld = await engine.handle({ op: 'load', p: { kind: 'real', seed: 42, withArrays: true } });
  for (const M of [ld.corrAligned, ld.corrClock, ld.corrDaily]) {
    for (let i = 0; i < N; i++) {
      assert.equal(M[i][i], 1);
      for (let j = 0; j < N; j++) {
        assert.equal(M[i][j], M[j][i]);
        assert.ok(M[i][j] >= -1 - 1e-12 && M[i][j] <= 1 + 1e-12);
      }
    }
  }
  assert.equal(ld.kDaily.length, N);
  assert.equal(ld.kDaily[0].length, payload.days);
});

test('graph: k-NN edges are symmetric with Gaussian weights of the stated sigma', () => {
  const { W, D } = Core.buildGraph();
  let edges = 0;
  for (let i = 0; i < N; i++) {
    let deg = 0;
    for (let j = 0; j < N; j++) {
      assert.equal(W[i][j], W[j][i]);
      if (W[i][j] > 0) {
        deg++;
        assert.ok(Math.abs(W[i][j] - Math.exp(-(D[i][j] ** 2) / (2 * Core.GRAPH_SIGMA ** 2))) < 1e-12);
        if (j > i) edges++;
      }
    }
    assert.ok(deg >= Core.GRAPH_K, 'station ' + i + ' has fewer than k neighbours');
  }
  assert.equal(edges, 19);
  /* same graph as the single-file page */
  assert.deepEqual(makeSingleFileSolver().buildGraph().W.map(r => Array.from(r)), W.map(r => Array.from(r)));
});

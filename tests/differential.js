/* Differential check shared by the Node and browser tests (plain script, no imports).
 * Runs the original single-file solver (reference/single-file-solver.js) and the refactored
 * core on the same data in the same JavaScript engine, so the comparison is exact even though
 * different engines may round the last bit of Math functions differently. */
function stmacChecksum(arrays, N, T) {
  var cs = 0;
  for (var a = 0; a < arrays.length; a++) for (var v = 0; v < N; v++) for (var i = 0; i < T; i += 97) cs += arrays[a][v * T + i] * ((i % 13) + 1);
  return cs;
}
async function stmacDifferential(makeSingleFileSolver, Core, payload, scenarios) {
  var OLD = makeSingleFileSolver(), N = OLD.N, realU = null, out = [];
  var graph = OLD.buildGraph();
  var engine = Core.createEngine(function () { return payload; });
  for (var q = 0; q < scenarios.length; q++) {
    var s = scenarios[q], U, CS;
    if (s.kind === 'real') { OLD.setReal(); realU = realU || Core.decodeReal(payload); U = realU; CS = OLD.computeCS(); }
    else { OLD.setSyn(); var d = OLD.genData(s.seed); U = d.U; CS = d.CS; }
    var T = OLD.T;
    var mk = OLD.buildBlockMask(OLD.BLOCKS[s.blockIdx].s, s.frac, s.maskSeed), M = mk.M;
    var stl = OLD.stmacJoint(U, M, graph.Lg, s.r, s.g, true, OLD.MDV_WIN);
    var pt = OLD.pureTemporal(U, M, OLD.AT);
    var stt = OLD.stmacJoint(U, M, graph.Lg, s.r, s.g, false, OLD.MDV_WIN);
    var mdv = OLD.climFill(U, M, stl.C);
    var flat = function (R) { var o = new Float64Array(N * T); for (var v = 0; v < N; v++) o.set(R[v], v * T); return o; };
    var oldRes = { rPT: OLD.rmseMasked(U, CS, pt, M), rMDV: OLD.rmseMasked(U, CS, mdv, M), rSTL: OLD.rmseMasked(U, CS, stl.R, M),
      rSTT: OLD.rmseMasked(U, CS, stt.R, M), n: stl.n, bw: stl.bw, effFrac: mk.frac,
      checksum: stmacChecksum([flat(stl.R), flat(pt), flat(stt.R), flat(mdv)], N, T) };
    var ld = await engine.handle({ op: 'load', p: { kind: s.kind, seed: s.seed } });
    var o = await engine.handle({ op: 'scenario', p: { dsKey: ld.key, blockIdx: s.blockIdx, frac: s.frac, maskSeed: s.maskSeed, r: s.r, g: s.g } });
    var newRes = { rPT: o.rPT, rMDV: o.rMDV, rSTL: o.rSTL, rSTT: o.rSTT, n: o.n, bw: o.bw, effFrac: o.effFrac,
      checksum: stmacChecksum([o.STL, o.PT, o.STT, o.MDV], N, T) };
    out.push({ scenario: s, old: oldRes, new: newRes });
  }
  return out;
}

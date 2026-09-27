/* STMAC solver worker: keeps every factorisation off the main thread so the page stays
 * responsive while the solver runs. Messages: {id, op, p} -> {id, ok, out} | {id, ok:false, error}.
 * Large typed arrays in the reply are transferred, not copied. */
'use strict';
/* forward the page's cache-busting query (?v=...) to the scripts this worker imports */
const VQ = self.location.search || '';
importScripts('stmac-core.js' + VQ);
const engine = self.STMACCore.createEngine(function () {
  if (!self.STMAC_NLR1999) importScripts('../data/nlr1999.js' + VQ);
  return self.STMAC_NLR1999;
});
self.onmessage = function (e) {
  const msg = e.data || {};
  engine.handle(msg).then(function (out) {
    const transfer = out && out.transfer ? out.transfer : [];
    if (out) delete out.transfer;
    self.postMessage({ id: msg.id, ok: true, out: out }, transfer);
  }, function (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err && err.stack || err) });
  });
};

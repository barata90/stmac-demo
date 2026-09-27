/* Background layer: replaces the Three.js WebGL scene (a 670 KB library that re-rendered the
 * whole viewport every frame). The aurora glow, particle field, two glow rings and film grain
 * are painted once into a single static canvas. It is repainted only when the viewport grows
 * noticeably, so it costs nothing while the page is idle or scrolling. */
(function () {
  'use strict';
  var cv = document.getElementById('fx-bg');
  if (!cv || !cv.getContext) return;
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var conn = navigator.connection || {};
  if (mm('(prefers-reduced-motion: reduce)') || conn.saveData === true ||
      (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2) {
    document.documentElement.classList.add('fx-lite'); /* disables the scroll parallax */
  }
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var WHITE = '255,255,255', GOLD = '212,175,55', TEAL = '0,245,212';

  function glow(ctx, x, y, rx, ry, rgb, a) {
    ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.2832); ctx.fill(); ctx.restore();
  }
  function dots(ctx, W, H, count, rMin, rMax, seed) {
    var r = rng(seed);
    for (var i = 0; i < count; i++) {
      var roll = r(), c = roll < 0.72 ? WHITE : roll < 0.94 ? GOLD : TEAL;
      var x = r() * W, y = r() * H, rad = rMin + r() * (rMax - rMin), a = 0.18 + r() * 0.62;
      var g = ctx.createRadialGradient(x, y, 0, x, y, rad * 3);
      g.addColorStop(0, 'rgba(' + c + ',' + a + ')'); g.addColorStop(0.35, 'rgba(' + c + ',' + (a * 0.45) + ')'); g.addColorStop(1, 'rgba(' + c + ',0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad * 3, 0, 6.2832); ctx.fill();
    }
  }
  function ring(ctx, cx, cy, rx, ry, rot, rgb, alpha, lw) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.strokeStyle = 'rgba(' + rgb + ',' + alpha + ')'; ctx.lineWidth = lw;
    ctx.shadowColor = 'rgba(' + rgb + ',' + Math.min(1, alpha * 1.6) + ')'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, 6.2832); ctx.stroke(); ctx.restore();
  }
  function grain(ctx, W, H) {
    var t = document.createElement('canvas'); t.width = t.height = 128;
    var tc = t.getContext('2d'), img = tc.createImageData(128, 128), r = rng(3);
    for (var i = 0; i < img.data.length; i += 4) { var v = 255 * r(); img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 10; }
    tc.putImageData(img, 0, 0);
    ctx.fillStyle = ctx.createPattern(t, 'repeat'); ctx.fillRect(0, 0, W, H);
  }
  var painted = { w: 0, h: 0 };
  function paint() {
    var W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    painted = { w: window.innerWidth, h: window.innerHeight };
    cv.width = W; cv.height = H; /* device-pixel ratio 1 is enough for soft glows */
    var ctx = cv.getContext('2d'), area = W * H;
    ctx.clearRect(0, 0, W, H);
    glow(ctx, W * 0.12, H * 0.08, 600, 380, GOLD, 0.12);
    glow(ctx, W * 0.92, H * 0.22, 700, 420, TEAL, 0.09);
    glow(ctx, W * 0.50, H * 0.92, 520, 320, GOLD, 0.07);
    dots(ctx, W, H, Math.min(900, Math.round(area / 2600)), 0.35, 0.9, 7);
    dots(ctx, W, H, Math.min(260, Math.round(area / 9000)), 0.8, 1.6, 19);
    ring(ctx, W * 0.70, H * 0.66, W * 0.34, H * 0.085, -0.18, GOLD, 0.22, 1.1);
    ring(ctx, W * 0.24, H * 0.28, W * 0.22, H * 0.10, 0.32, TEAL, 0.17, 0.9);
    grain(ctx, W, H);
  }
  paint();
  var timer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      /* ignore the small height changes of mobile URL bars */
      if (window.innerWidth > painted.w * 1.12 || window.innerHeight > painted.h * 1.2 || window.innerWidth < painted.w * 0.8) paint();
    }, 250);
  }, { passive: true });
})();

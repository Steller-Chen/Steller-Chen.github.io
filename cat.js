/* Interactive cat avatar. The head and ears are cut out of the photo into
   their own layers (over a copy of the photo with the head painted out), so
   the cat can tilt its head, twitch its ears, blink and breathe. Reactions
   depend on where it is petted and on which profile link is hovered. */
(function () {
  var stage = document.getElementById('cat-stage');
  if (!stage) return;
  var img = stage.querySelector('.avatar-img');
  var plate = stage.querySelector('.cat-plate');
  var head = stage.querySelector('.cat-head');
  var bubble = stage.querySelector('.cat-bubble');
  var fx = stage.querySelector('.cat-fx');
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var alive = false;

  // Outlines in photo coordinates (percent of the square source image).
  var SHAPES = {
    head: [[41.5, 21], [44.5, 15.5], [55, 10], [60, 9.5], [66, 11.5], [73, 15], [75.5, 21], [78.5, 28], [76, 35.5], [69, 39.5], [58, 41], [49, 39.5], [43, 35], [40, 28]],
    earL: [[43.5, 18], [45.5, 10], [49.5, 0.8], [54, 4], [58.5, 9], [57.5, 14], [51, 17]],
    earR: [[63.5, 13.5], [70, 9], [79, 8], [78.5, 14], [76, 23], [70, 21]]
  };

  // Click regions, also in photo coordinates.
  var REGIONS = [
    { name: 'ear', box: [44, 0, 58, 14] },
    { name: 'ear', box: [64, 8, 80, 22] },
    { name: 'nose', box: [51, 24, 61, 33] },
    { name: 'head', box: [41, 10, 77, 37] },
    { name: 'paws', box: [37, 80, 70, 97] },
    { name: 'tail', box: [4, 74, 36, 92] },
    { name: 'belly', box: [38, 37, 76, 80] }
  ];

  // ---- Layers -------------------------------------------------------------

  function maskUrl(points) {
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>" +
      "<filter id='f'><feGaussianBlur stdDeviation='0.5'/></filter>" +
      "<polygon points='" + points.join(' ') + "' filter='url(#f)'/></svg>";
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  function canvas(size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }

  function fillShapes(ctx, size) {
    [SHAPES.head, SHAPES.earL, SHAPES.earR].forEach(function (pts) {
      ctx.beginPath();
      pts.forEach(function (p, i) { ctx[i ? 'lineTo' : 'moveTo'](p[0] * size / 100, p[1] * size / 100); });
      ctx.closePath();
      ctx.fill();
    });
  }

  // Fill the head area from its surroundings (pull-push interpolation), so
  // whatever a moving head or ear uncovers looks like background.
  function paintOutHead(size) {
    var small = canvas(size), sctx = small.getContext('2d');
    sctx.drawImage(img, 0, 0, size, size);
    var hole = canvas(size), hctx = hole.getContext('2d');
    fillShapes(hctx, size);
    var pixels = sctx.getImageData(0, 0, size, size);
    var mask = hctx.getImageData(0, 0, size, size).data;

    var w = size, n = w * w;
    var lv = { w: w, R: new Float32Array(n), G: new Float32Array(n), B: new Float32Array(n), A: new Float32Array(n) };
    for (var i = 0; i < n; i++) {
      var a = mask[i * 4 + 3] > 0 ? 0 : 1;
      lv.R[i] = pixels.data[i * 4] * a; lv.G[i] = pixels.data[i * 4 + 1] * a; lv.B[i] = pixels.data[i * 4 + 2] * a; lv.A[i] = a;
    }
    var levels = [lv];
    while (w > 1) {
      var nw = Math.ceil(w / 2), nn = nw * nw;
      var next = { w: nw, R: new Float32Array(nn), G: new Float32Array(nn), B: new Float32Array(nn), A: new Float32Array(nn) };
      for (var y = 0; y < nw; y++) for (var x = 0; x < nw; x++) {
        var r = 0, g = 0, b = 0, al = 0, cnt = 0;
        for (var dy = 0; dy < 2; dy++) for (var dx = 0; dx < 2; dx++) {
          var X = 2 * x + dx, Y = 2 * y + dy;
          if (X >= w || Y >= w) continue;
          var j = Y * w + X;
          r += lv.R[j]; g += lv.G[j]; b += lv.B[j]; al += lv.A[j]; cnt++;
        }
        var k = y * nw + x;
        next.R[k] = r / cnt; next.G[k] = g / cnt; next.B[k] = b / cnt; next.A[k] = al / cnt;
      }
      levels.push(next);
      lv = next; w = nw;
    }
    var top = levels[levels.length - 1];
    var C = { w: 1, R: [top.R[0] / top.A[0]], G: [top.G[0] / top.A[0]], B: [top.B[0] / top.A[0]] };
    for (var L = levels.length - 2; L >= 0; L--) {
      var f = levels[L], fw = f.w, F = { w: fw, R: new Float32Array(fw * fw), G: new Float32Array(fw * fw), B: new Float32Array(fw * fw) };
      for (var yy = 0; yy < fw; yy++) for (var xx = 0; xx < fw; xx++) {
        var idx = yy * fw + xx, fa = f.A[idx];
        if (fa >= 1) { F.R[idx] = f.R[idx]; F.G[idx] = f.G[idx]; F.B[idx] = f.B[idx]; continue; }
        // Bilinear sample of the coarser, already filled level.
        var cx = Math.min(Math.max((xx + 0.5) / 2 - 0.5, 0), C.w - 1), cy = Math.min(Math.max((yy + 0.5) / 2 - 0.5, 0), C.w - 1);
        var x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.min(x0 + 1, C.w - 1), y1 = Math.min(y0 + 1, C.w - 1);
        var tx = cx - x0, ty = cy - y0;
        var i00 = y0 * C.w + x0, i10 = y0 * C.w + x1, i01 = y1 * C.w + x0, i11 = y1 * C.w + x1;
        var w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        F.R[idx] = f.R[idx] + (1 - fa) * (C.R[i00] * w00 + C.R[i10] * w10 + C.R[i01] * w01 + C.R[i11] * w11);
        F.G[idx] = f.G[idx] + (1 - fa) * (C.G[i00] * w00 + C.G[i10] * w10 + C.G[i01] * w01 + C.G[i11] * w11);
        F.B[idx] = f.B[idx] + (1 - fa) * (C.B[i00] * w00 + C.B[i10] * w10 + C.B[i01] * w01 + C.B[i11] * w11);
      }
      C = F;
    }
    for (var p = 0; p < n; p++) {
      if (mask[p * 4 + 3] === 0) continue;
      pixels.data[p * 4] = C.R[p]; pixels.data[p * 4 + 1] = C.G[p]; pixels.data[p * 4 + 2] = C.B[p]; pixels.data[p * 4 + 3] = 255;
    }
    sctx.putImageData(pixels, 0, 0);
    return small;
  }

  function buildLayers() {
    try {
      var N = img.naturalWidth;
      var fill = paintOutHead(256);
      plate.width = plate.height = N;
      var pctx = plate.getContext('2d');
      pctx.drawImage(img, 0, 0, N, N);
      var patch = canvas(N), qctx = patch.getContext('2d');
      qctx.imageSmoothingQuality = 'high';
      qctx.drawImage(fill, 0, 0, N, N);
      var shapes = canvas(N);
      fillShapes(shapes.getContext('2d'), N);
      qctx.globalCompositeOperation = 'destination-in';
      qctx.drawImage(shapes, 0, 0);
      pctx.drawImage(patch, 0, 0);
      [['.cat-head-img', SHAPES.head], ['.cat-ear-l', SHAPES.earL], ['.cat-ear-r', SHAPES.earR]].forEach(function (part) {
        var el = stage.querySelector(part[0]), url = maskUrl(part[1]);
        el.style.webkitMaskImage = url;
        el.style.maskImage = url;
      });
      alive = true;
      stage.classList.add('alive');
    } catch (e) {
      // Without the painted-out plate the cat still blinks; it just keeps its head still.
    }
  }
  if (img.complete && img.naturalWidth) setTimeout(buildLayers, 0);
  else img.addEventListener('load', function () { setTimeout(buildLayers, 0); });

  // ---- Pose, eyes, words -------------------------------------------------

  var hoverPose = null, followPose = null;

  function setPose(p, quick) {
    if (!alive || reduceMotion) return;
    p = p || {};
    head.style.setProperty('--head-r', (p.r || 0) + 'deg');
    head.style.setProperty('--head-x', (p.x || 0) + '%');
    head.style.setProperty('--head-y', (p.y || 0) + '%');
    head.style.setProperty('--ear-l', (p.el || 0) + 'deg');
    head.style.setProperty('--ear-r', (p.er || 0) + 'deg');
    stage.classList.toggle('quick', !!quick);
  }

  function eyes(state, slow) {
    stage.classList.remove('eyes-half', 'eyes-squint', 'eyes-closed');
    stage.classList.toggle('eyes-slow', !!slow);
    if (state) stage.classList.add('eyes-' + state);
  }

  function blink() {
    stage.classList.remove('blink');
    void stage.offsetWidth;
    stage.classList.add('blink');
    setTimeout(function () { stage.classList.remove('blink'); }, 260);
  }

  var bubbleTimer;
  function say(text) {
    clearTimeout(bubbleTimer);
    bubble.textContent = text;
    bubble.classList.add('show');
    bubbleTimer = setTimeout(function () { bubble.classList.remove('show'); }, 1700);
  }
  function maybe(text) { return Math.random() < 0.5 ? text : null; }

  function hearts(count) {
    var r = stage.getBoundingClientRect();
    for (var i = 0; i < count; i++) {
      var el = document.createElement('span');
      el.textContent = '♥';
      el.style.left = r.width * (0.56 + (Math.random() - 0.5) * 0.12) + 'px';
      el.style.top = r.height * 0.16 + 'px';
      el.style.setProperty('--dx', (Math.random() * 20 - 10).toFixed(0) + 'px');
      el.style.animationDelay = i * 250 + 'ms';
      fx.appendChild(el);
      setTimeout(el.remove.bind(el), 1700 + i * 250);
    }
  }

  // A reaction is a list of steps, each held for `ms`, then the cat settles.
  var timers = [], busyUntil = 0;
  function play(steps) {
    timers.forEach(clearTimeout);
    timers = [];
    var t = 0;
    steps.forEach(function (s) {
      timers.push(setTimeout(function () { apply(s); }, t));
      t += s.ms || 300;
    });
    busyUntil = Date.now() + t;
    timers.push(setTimeout(settle, t));
  }
  function apply(s) {
    if (s.pose) setPose(s.pose, s.quick);
    if ('eyes' in s) eyes(s.eyes, s.slow);
    if (s.blink) blink();
    if ('purr' in s) stage.classList.toggle('purr', s.purr);
    if (s.say) say(s.say);
    if (s.hearts) hearts(s.hearts);
  }
  function settle() {
    stage.classList.remove('purr');
    eyes(null, true);
    setPose(hoverPose || followPose);
  }
  function busy() { return Date.now() < busyUntil; }

  function twitch(left, deg) {
    var p = left ? { el: -deg } : { er: deg };
    return [{ pose: p, quick: true, ms: 110 }, { pose: {}, quick: true, ms: 120 }, { pose: p, quick: true, ms: 110 }, { pose: {}, quick: true, ms: 200 }];
  }

  // s is -1 when the click was left of the cat's face, +1 when right of it.
  var REACTIONS = {
    head: [
      function (s) { return [{ pose: { r: 5 * s, x: 0.6 * s, y: 0.5 }, eyes: 'squint', slow: true, purr: true, say: maybe('purr…'), hearts: 1, ms: 1500 }, { purr: false, ms: 200 }]; },
      function (s) { return [{ pose: { r: -2 * s, y: 0.8 }, eyes: 'closed', slow: true, ms: 800 }, { eyes: null, slow: true, ms: 500 }, { hearts: 1, ms: 300 }]; },
      function (s) { return [{ pose: { r: 3 * s, y: 1.2, el: -6, er: 6 }, eyes: 'half', slow: true, say: maybe('mrrr'), ms: 1400 }]; }
    ],
    ear: [
      function (s) { return twitch(s < 0, 14).concat([{ blink: true, ms: 200 }]); },
      function (s) { return [{ pose: { r: -4 * s, el: s < 0 ? -18 : 0, er: s > 0 ? 18 : 0 }, quick: true, say: maybe('mrrp.'), ms: 500 }, { pose: { r: -2 * s }, ms: 600 }]; },
      function () { return [{ pose: { el: -16, er: 16, y: 0.6 }, eyes: 'half', say: maybe('mrr.'), ms: 1100 }, { eyes: null, ms: 200 }]; }
    ],
    nose: [
      function (s) { return [{ pose: { y: -1.4, r: -2 * s }, quick: true, blink: true, say: maybe('*sniff*'), ms: 500 }, { pose: { y: -0.6 }, ms: 500 }]; },
      function () { return [{ pose: { y: 0.5 }, quick: true, ms: 150 }, { pose: { y: -0.2 }, quick: true, ms: 150 }, { pose: { y: 0.5 }, quick: true, ms: 150 }, { pose: {}, quick: true, say: maybe('*sniff sniff*'), ms: 500 }]; },
      function (s) { return [{ eyes: 'closed', pose: { r: 4 * s }, say: maybe('mew'), ms: 600 }, { eyes: null, ms: 300 }]; }
    ],
    belly: [
      function (s) { return [{ pose: { y: 2.2, r: 2 * s, el: -10, er: 10 }, say: maybe('mrr.'), ms: 1100 }]; },
      function (s) { return [{ pose: { r: -2 * s, y: 0.6 }, eyes: 'squint', slow: true, purr: true, ms: 1500 }, { purr: false, ms: 100 }]; },
      function (s) { return [{ pose: { r: -5 * s, x: -0.6 * s }, blink: true, say: maybe('hm?'), ms: 900 }]; }
    ],
    paws: [
      function (s) { return [{ pose: { y: 2.8 }, ms: 700 }, { pose: { y: 2.4, r: 3 * s }, blink: true, say: maybe('mrrp?'), ms: 700 }]; },
      function () { return [{ pose: { y: 2, el: 5, er: -5 }, ms: 500 }, { pose: { y: 1.5, el: 5, er: -5 }, blink: true, ms: 700 }]; }
    ],
    tail: [
      function () { return [{ pose: { r: -7, x: -1.2, el: -8 }, ms: 900 }, { pose: { r: -5, x: -1 }, blink: true, say: maybe('…'), ms: 700 }]; },
      function () { return [{ pose: { el: -14, er: 14, r: 3 }, eyes: 'half', say: maybe('mrr.'), ms: 1100 }, { eyes: null, ms: 200 }]; }
    ],
    elsewhere: [
      function (s) { return [{ pose: { r: 8 * s, x: 0.8 * s, el: 4, er: -4 }, say: maybe('meow?'), ms: 1200 }]; },
      function (s) { return [{ pose: { r: 4 * s, x: 0.6 * s }, ms: 600 }, { eyes: 'closed', slow: true, ms: 600 }, { eyes: null, slow: true, ms: 500 }]; },
      function (s) { return twitch(Math.random() < 0.5, 12).concat([{ pose: { r: 2 * s }, blink: true, ms: 500 }]); }
    ]
  };

  var last = {}, recent = [];
  function pick(list, key) {
    var i;
    do { i = Math.floor(Math.random() * list.length); } while (list.length > 1 && i === last[key]);
    last[key] = i;
    return list[i];
  }

  function night() { var h = new Date().getHours(); return h >= 23 || h < 6; }

  function react(region, s) {
    var now = Date.now();
    recent = recent.filter(function (t) { return now - t < 3000; });
    recent.push(now);
    if (recent.length >= 7) {
      recent = [];
      play([{ pose: { r: -6, x: -1, el: -16, er: 16 }, eyes: 'half', say: 'mrr.', ms: 1800 }, { eyes: null, ms: 200 }]);
      return;
    }
    if (region === 'elsewhere' && night() && Math.random() < 0.4) {
      play([{ pose: { y: 1 }, eyes: 'half', slow: true, say: maybe('zzz'), ms: 1600 }]);
      return;
    }
    play(pick(REACTIONS[region], region)(s));
  }

  function regionAt(clientX, clientY) {
    var r = img.getBoundingClientRect();
    var u = (clientX - r.left) / r.width * 100, v = (clientY - r.top) / r.height * 100;
    var side = u < 58 ? -1 : 1;
    for (var i = 0; i < REGIONS.length; i++) {
      var b = REGIONS[i].box;
      if (u >= b[0] && u <= b[2] && v >= b[1] && v <= b[3]) return { name: REGIONS[i].name, side: side };
    }
    return { name: 'elsewhere', side: side };
  }

  stage.addEventListener('click', function (e) {
    var hit = regionAt(e.clientX, e.clientY);
    react(hit.name, hit.side);
  });
  stage.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    var names = Object.keys(REACTIONS);
    react(names[Math.floor(Math.random() * names.length)], Math.random() < 0.5 ? -1 : 1);
  });

  // ---- Profile links: quiet, wordless reactions --------------------------

  function towards(el) {
    var a = el.getBoundingClientRect(), c = stage.getBoundingClientRect();
    var dx = a.left + a.width / 2 - (c.left + c.width / 2), dy = a.top + a.height / 2 - (c.top + c.height / 2);
    return { s: Math.max(-1, Math.min(1, dx / 150)), up: dy < -40 };
  }

  var LINKS = [
    { // Email: ears perk up and the head turns towards the link.
      match: function (href) { return /^mailto:/i.test(href); },
      enter: function (d) {
        hoverPose = { r: 6 * d.s, x: 0.6 * d.s, y: d.up ? -1 : 0, el: 5, er: -5 };
        play([{ pose: hoverPose, blink: true, ms: 400 }]);
      }
    },
    { // CV: an approving slow blink.
      match: function (href) { return /\.pdf($|\?)/i.test(href); },
      enter: function (d) {
        hoverPose = { r: 4 * d.s, y: d.up ? -0.6 : 0.6 };
        play([{ pose: hoverPose, eyes: 'closed', slow: true, ms: 650 }, { eyes: null, slow: true, ms: 400 }]);
      }
    },
    { // Google Scholar: reading glasses, head tipped down.
      match: function (href) { return /scholar\.google/i.test(href); },
      enter: function (d) {
        hoverPose = { r: 3 * d.s, y: d.up ? -0.4 : 1.6 };
        stage.classList.add('glasses');
        play([{ pose: hoverPose, ms: 400 }]);
      }
    }
  ];

  var activeLink = null;
  function linkEnter(cfg, el) {
    if (activeLink === el) return;
    activeLink = el;
    cfg.enter(towards(el));
  }
  function linkLeave(el) {
    if (activeLink !== el) return;
    activeLink = null;
    hoverPose = null;
    stage.classList.remove('glasses');
    if (!busy()) settle();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.profile-links a'), function (a) {
    var href = a.getAttribute('href') || '';
    var cfg = LINKS.filter(function (l) { return l.match(href); })[0];
    if (!cfg) return;
    a.addEventListener('mouseenter', function () { linkEnter(cfg, a); });
    a.addEventListener('mouseleave', function () { linkLeave(a); });
    a.addEventListener('focus', function () { linkEnter(cfg, a); });
    a.addEventListener('blur', function () { linkLeave(a); });
    a.addEventListener('touchstart', function () {
      linkEnter(cfg, a);
      setTimeout(function () { linkLeave(a); }, 2000);
    }, { passive: true });
  });

  // ---- Following the pointer and idling -----------------------------------

  var lastMove = 0, frame = 0;
  if (window.matchMedia && matchMedia('(pointer: fine)').matches) {
    document.addEventListener('mousemove', function (e) {
      lastMove = Date.now();
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = 0;
        var c = stage.getBoundingClientRect();
        var dx = e.clientX - (c.left + c.width / 2), dy = e.clientY - (c.top + c.height * 0.3);
        if (Math.abs(dx) > 700 || Math.abs(dy) > 500) followPose = null;
        else {
          var k = Math.max(-1, Math.min(1, dx / 260)), m = Math.max(-1, Math.min(1, dy / 300));
          followPose = { r: 4 * k, x: 0.4 * k, y: 0.8 * m };
        }
        if (!busy() && !hoverPose) setPose(followPose);
      });
    });
    document.addEventListener('mouseleave', function () {
      followPose = null;
      if (!busy() && !hoverPose) setPose(null);
    });
  }

  // Small things a cat does on its own; head movements wait for a still pointer.
  var IDLE = [
    { w: 34, run: function () { blink(); } },
    { w: 8, run: function () { blink(); setTimeout(blink, 320); } },
    { w: 12, run: function () { play(twitch(true, 10)); } },
    { w: 12, run: function () { play(twitch(false, 10)); } },
    { w: 10, still: true, run: function () { var s = Math.random() < 0.5 ? -1 : 1; play([{ pose: { r: 3 * s, x: 0.3 * s }, ms: 1700 }]); } },
    { w: 8, run: function () { play([{ eyes: 'closed', slow: true, ms: 700 }, { eyes: null, slow: true, ms: 400 }]); } },
    { w: 8, still: true, run: function () { play([{ pose: { r: -4, x: -0.4 }, ms: 1100 }, { pose: { r: 3, x: 0.3 }, ms: 1100 }, { pose: {}, blink: true, ms: 400 }]); } },
    { w: 8, run: function () { play([{ eyes: 'half', slow: true, pose: { y: 0.6 }, ms: night() ? 5000 : 2600 }]); } }
  ];
  (function idle() {
    setTimeout(function () {
      var still = Date.now() - lastMove > 2500;
      if (!busy() && !activeLink && !document.hidden) {
        var options = IDLE.filter(function (o) { return still || !o.still; });
        var total = options.reduce(function (t, o) { return t + o.w; }, 0), roll = Math.random() * total;
        for (var i = 0; i < options.length; i++) { roll -= options[i].w; if (roll < 0) { options[i].run(); break; } }
      }
      idle();
    }, 2500 + Math.random() * 3500);
  })();
})();

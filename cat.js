/* Interactive cat avatar: different reactions depending on where the cat is
   petted, and on which profile link (Email / CV / Google Scholar) is hovered. */
(function () {
  var stage = document.getElementById('cat-stage');
  if (!stage) return;
  var crop = stage.querySelector('.avatar-crop');
  var img = stage.querySelector('.avatar-img');
  var lean = stage.querySelector('.cat-lean');
  var bubble = stage.querySelector('.cat-bubble');
  var fx = stage.querySelector('.cat-fx');
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Regions in photo coordinates (fractions of the square source image).
  var REGIONS = [
    { name: 'ear', box: [0.44, 0.00, 0.58, 0.14] },
    { name: 'ear', box: [0.66, 0.08, 0.80, 0.22] },
    { name: 'nose', box: [0.51, 0.24, 0.61, 0.33] },
    { name: 'head', box: [0.41, 0.10, 0.76, 0.36] },
    { name: 'paws', box: [0.37, 0.80, 0.70, 0.97] },
    { name: 'tail', box: [0.04, 0.74, 0.36, 0.92] },
    { name: 'belly', box: [0.38, 0.36, 0.75, 0.80] }
  ];

  // Each reaction: what the cat says, how the avatar moves, which face
  // overlay it shows, and which particles float up.
  var REACTIONS = {
    head: [
      { say: 'purrrrr…', anim: 'a-purr', face: 'squint', fx: ['💛', '💛', '✨'] },
      { say: 'More scritches, please.', anim: 'a-nod', face: 'squint', fx: ['♥', '♥'] },
      { say: '喵～', anim: 'a-tilt', face: 'blush', fx: ['💕'] },
      { say: 'Right there. Yes. Perfect.', anim: 'a-purr', face: 'squint', fx: ['✨', '💛'] },
      { say: 'You may continue.', anim: 'a-nod', face: 'blink', fx: ['👑'] }
    ],
    ear: [
      { say: 'Hey, that’s my ear!', anim: 'a-shake', face: 'blink', fx: ['❗'] },
      { say: '*ear twitch*', anim: 'a-wiggle', fx: ['〰️'] },
      { say: 'I can hear you thinking.', anim: 'a-tilt', fx: ['👂'] },
      { say: 'Ears are not buttons.', anim: 'a-shake', fx: ['💢'] }
    ],
    nose: [
      { say: 'boop!', anim: 'a-squish', face: 'blink', fx: ['✨'] },
      { say: '*sniff sniff*… fish?', anim: 'a-nod', fx: ['🐟'] },
      { say: 'Achoo!', anim: 'a-shake', face: 'blink', fx: ['💨', '✨'] },
      { say: 'Boop accepted. Boop returned.', anim: 'a-squish', fx: ['👃', '🐾'] }
    ],
    belly: [
      { say: 'It’s a trap!', anim: 'a-shake', fx: ['💢', '🐾'] },
      { say: 'Okay… just this once.', anim: 'a-purr', face: 'blush', fx: ['💗', '💗'] },
      { say: 'Belly rubs cost one treat.', anim: 'a-tilt', fx: ['🍤'] },
      { say: 'So fluffy, right?', anim: 'a-squish', face: 'squint', fx: ['☁️', '✨'] }
    ],
    paws: [
      { say: 'Toe beans! 🫘', anim: 'a-hop', fx: ['🐾', '🐾', '🐾'] },
      { say: 'High five!', anim: 'a-hop', face: 'blink', fx: ['✋', '✨'] },
      { say: 'These paws write code at night.', anim: 'a-nod', fx: ['⌨️'] },
      { say: '*kneads the sofa*', anim: 'a-purr', face: 'squint', fx: ['🍞'] }
    ],
    tail: [
      { say: 'Not the tail!', anim: 'a-shake', fx: ['😾'] },
      { say: 'swish… swish…', anim: 'a-wiggle', fx: ['〰️', '〰️'] },
      { say: 'Wheee!', anim: 'a-spin', fx: ['🌀'] },
      { say: 'That’s attached to me, you know.', anim: 'a-tilt', fx: ['❓'] }
    ],
    elsewhere: [
      { say: 'Meow?', anim: 'a-tilt', fx: ['❔'] },
      { say: 'My window. Birds live out there.', anim: 'a-nod', fx: ['🐦'] },
      { say: 'This is my sofa now.', anim: 'a-squish', fx: ['🛋️'] },
      { say: 'Sunbeam acquired.', anim: 'a-purr', face: 'squint', fx: ['☀️'] }
    ]
  };

  var LINKS = {
    email: {
      match: function (a) { return /^mailto:/i.test(a.getAttribute('href') || ''); },
      say: ['Write to my human! ✉️', 'Inbox is open 📬', 'Say hi — I’ll make sure it gets read.'],
      face: 'blush', fx: ['✉️', '💌']
    },
    cv: {
      match: function (a) { return /\.pdf($|\?)/i.test(a.getAttribute('href') || ''); },
      say: ['My human’s résumé 📄', 'Hire them, they feed me on time 🐟', 'Two pages of good stuff ✨'],
      face: 'blink', fx: ['📄', '⭐']
    },
    scholar: {
      match: function (a) { return /scholar\.google/i.test(a.getAttribute('href') || ''); },
      say: ['Papers! Citations! Science! 🤓', 'I review every paper. By sitting on it.', 'Read the CoRL one 📚'],
      face: 'glasses', fx: ['📚', '🎓']
    }
  };

  var MILESTONES = { 10: 'Ten pets! You’re my favourite visitor 💛', 25: 'Okay, I’m officially your cat now.', 50: 'Fifty?! Please go read a paper 📚' };

  var last = {};
  var pets = 0;
  var recent = [];
  var bubbleTimer, faceTimer, hovering = null;

  function pick(list, key) {
    var i;
    do { i = Math.floor(Math.random() * list.length); } while (list.length > 1 && i === last[key]);
    last[key] = i;
    return list[i];
  }

  function say(text, ms) {
    clearTimeout(bubbleTimer);
    bubble.textContent = text;
    bubble.classList.remove('show');
    void bubble.offsetWidth;
    bubble.classList.add('show');
    if (ms !== Infinity) bubbleTimer = setTimeout(function () { bubble.classList.remove('show'); }, ms || 2200);
  }

  function animate(cls) {
    if (!cls) return;
    crop.className = crop.className.replace(/\ba-\w+/g, '').trim();
    void crop.offsetWidth;
    crop.classList.add(cls);
  }
  crop.addEventListener('animationend', function (e) {
    if (e.target === crop) crop.className = crop.className.replace(/\ba-\w+/g, '').trim();
  });

  function face(kind, ms) {
    clearTimeout(faceTimer);
    stage.classList.remove('blink', 'squint', 'blush', 'glasses');
    if (!kind) return;
    void stage.offsetWidth;
    stage.classList.add(kind);
    if (ms !== Infinity) faceTimer = setTimeout(function () { stage.classList.remove(kind); }, ms || 1600);
  }

  function burst(symbols, x, y) {
    if (!symbols) return;
    var r = stage.getBoundingClientRect();
    if (x == null) { x = r.width / 2; y = r.height * 0.35; }
    symbols.forEach(function (s, i) {
      var el = document.createElement('span');
      el.textContent = s;
      el.style.left = x + (i - (symbols.length - 1) / 2) * 14 + 'px';
      el.style.top = y + 'px';
      el.style.setProperty('--dx', (Math.random() * 50 - 25).toFixed(0) + 'px');
      el.style.setProperty('--rot', (Math.random() * 40 - 20).toFixed(0) + 'deg');
      el.style.animationDelay = i * 90 + 'ms';
      fx.appendChild(el);
      setTimeout(function () { el.remove(); }, 1500 + i * 90);
    });
  }

  function regionAt(clientX, clientY) {
    var r = img.getBoundingClientRect();
    var u = (clientX - r.left) / r.width, v = (clientY - r.top) / r.height;
    for (var i = 0; i < REGIONS.length; i++) {
      var b = REGIONS[i].box;
      if (u >= b[0] && u <= b[2] && v >= b[1] && v <= b[3]) return REGIONS[i].name;
    }
    return 'elsewhere';
  }

  function react(region, x, y) {
    pets++;
    var now = Date.now();
    recent = recent.filter(function (t) { return now - t < 3000; });
    recent.push(now);

    if (MILESTONES[pets]) {
      animate('a-hop'); face('blush'); say(MILESTONES[pets], 3000); burst(['🎉', '💛', '🎉'], x, y);
      return;
    }
    if (recent.length >= 7) {
      recent = [];
      animate('a-shake'); face(null); say('Too many pets! Cooldown, human. 😾', 2600); burst(['💢', '💢'], x, y);
      return;
    }
    var hour = new Date().getHours();
    if (region === 'elsewhere' && (hour >= 23 || hour < 6) && Math.random() < 0.5) {
      animate('a-nod'); face('squint'); say('zZz… it’s late, go to sleep.', 2400); burst(['💤', '🌙'], x, y);
      return;
    }
    var r = pick(REACTIONS[region], region);
    animate(r.anim); face(r.face); say(r.say); burst(r.fx, x, y);
  }

  stage.addEventListener('click', function (e) {
    var r = stage.getBoundingClientRect();
    react(regionAt(e.clientX, e.clientY), e.clientX - r.left, e.clientY - r.top);
    dismissHint();
  });
  stage.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    var names = Object.keys(REACTIONS);
    react(names[Math.floor(Math.random() * names.length)]);
    dismissHint();
  });

  // Lean toward the hovered link and show a link-specific reaction.
  function leanToward(el) {
    if (!el || reduceMotion) { lean.style.removeProperty('--lean-x'); lean.style.removeProperty('--lean-y'); lean.style.removeProperty('--lean-r'); return; }
    var a = el.getBoundingClientRect(), c = stage.getBoundingClientRect();
    var dx = a.left + a.width / 2 - (c.left + c.width / 2), dy = a.top + a.height / 2 - (c.top + c.height / 2);
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    lean.style.setProperty('--lean-x', (dx / d * 8).toFixed(1) + 'px');
    lean.style.setProperty('--lean-y', (dy / d * 8).toFixed(1) + 'px');
    lean.style.setProperty('--lean-r', (dx / d * 7).toFixed(1) + 'deg');
  }

  function linkEnter(key, el) {
    if (hovering === key) return;
    hovering = key;
    var cfg = LINKS[key];
    leanToward(el);
    face(cfg.face, Infinity);
    say(pick(cfg.say, 'link-' + key), Infinity);
    burst(cfg.fx);
    if (key === 'cv') animate('a-nod'); else if (key === 'email') animate('a-hop'); else animate('a-tilt');
    dismissHint();
  }
  function linkLeave(key) {
    if (hovering !== key) return;
    hovering = null;
    leanToward(null);
    face(null);
    bubbleTimer = setTimeout(function () { bubble.classList.remove('show'); }, 250);
  }

  Array.prototype.forEach.call(document.querySelectorAll('.profile-links a'), function (a) {
    var key = Object.keys(LINKS).filter(function (k) { return LINKS[k].match(a); })[0];
    if (!key) return;
    a.addEventListener('mouseenter', function () { linkEnter(key, a); });
    a.addEventListener('mouseleave', function () { linkLeave(key); });
    a.addEventListener('focus', function () { linkEnter(key, a); });
    a.addEventListener('blur', function () { linkLeave(key); });
    // Touch screens have no hover: react on tap, then calm down after a moment.
    a.addEventListener('touchstart', function () {
      linkEnter(key, a);
      setTimeout(function () { linkLeave(key); }, 2200);
    }, { passive: true });
  });

  // Occasional idle blink, and a one-time hint that the cat is interactive.
  (function idle() {
    setTimeout(function () {
      if (!hovering && !document.hidden) face('blink', 700);
      idle();
    }, 5000 + Math.random() * 7000);
  })();

  var hintTimer = null;
  function dismissHint() { clearTimeout(hintTimer); hintTimer = null; }
  var seen = false;
  try { seen = sessionStorage.getItem('cat-hint') === '1'; sessionStorage.setItem('cat-hint', '1'); } catch (e) {}
  if (!seen) hintTimer = setTimeout(function () { if (!hovering) say('psst… pet me 🐾', 2600); }, 2500);
})();

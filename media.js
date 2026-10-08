/* Research media: local MP4s, original animated results, and official-source discovery.
   No stock videos, synthetic rollouts, or other projects' results are substituted. */
(() => {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const config = JSON.parse(document.getElementById('research-media-config').textContent);
  const timers = new WeakMap();

  function prepare(video, frame) {
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;
    video.addEventListener('loadeddata', () => {
      frame.classList.add('ready');
      frame.classList.remove('unavailable');
      clearTimeout(timers.get(video));
      if (!reduced) video.play().catch(() => frame.classList.add('paused'));
    });
    video.addEventListener('play', () => frame.classList.remove('paused'));
    video.addEventListener('timeupdate', () => {if(video.currentTime>0.12) frame.classList.add('playing');});
    video.addEventListener('pause', () => frame.classList.add('paused'));
    const toggle = frame.querySelector('.media-toggle');
    if (toggle) toggle.addEventListener('click', () => {
      if (video.paused) video.play().catch(() => {}); else video.pause();
    });
    if (reduced) { video.autoplay = false; video.pause(); frame.classList.add('paused'); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) video.pause();
        else if (!reduced && video.readyState >= 2) video.play().catch(() => {});
      }), {threshold: 0.15}).observe(video);
    }
  }

  document.querySelectorAll('.research-media video').forEach(video => {
    const frame = video.closest('.media-frame');
    prepare(video, frame);
    if (video.getAttribute('src') || video.querySelector('source')) {
      video.addEventListener('error', () => frame.classList.add('unavailable'));
      if (video.readyState >= 2) frame.classList.add('ready');
    }
  });
  document.querySelectorAll('.research-media img.animated-result').forEach(img => {
    const frame = img.closest('.media-frame');
    img.addEventListener('error', () => { img.hidden = true; frame.classList.add('unavailable'); });
    img.addEventListener('load', () => { img.hidden = false; frame.classList.add('ready'); });
  });

  // Resolve URLs only from an official page, its source, or its repository tree.
  // All requests are public, unauthenticated reads. Never execute fetched HTML.
  async function request(url, asJSON = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const r = await fetch(url, {signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return asJSON ? await r.json() : await r.text();
    } finally { clearTimeout(timer); }
  }
  function safeURL(value, base) {
    if (!value || value.includes('{{') || value.includes('${')) return null;
    try {
      const url = new URL(value, base);
      return url.protocol === 'https:' ? url.href : null;
    } catch (_) { return null; }
  }
  function candidatesFromHTML(text, base) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const values = [];
    doc.querySelectorAll('video, video source, [data-video], [data-video-src]').forEach(el => {
      ['src', 'data-src', 'data-video', 'data-video-src'].forEach(a => {
        const v = el.getAttribute(a); if (v) values.push(v);
      });
    });
    // Some official pages define videos in a JS/JSON array rather than <source>.
    for (const m of text.matchAll(/["']([^"'<>\n]+\.(?:mp4|webm)(?:\?[^"'<>\n]*)?)["']/gi)) values.push(m[1]);
    return [...new Set(values.map(v => safeURL(v, base)).filter(v => v && /\.(mp4|webm)(?:[?#]|$)/i.test(v)))];
  }
  function score(url, item) {
    let s = 0;
    item.prefer.forEach((word, i) => { if (url.toLowerCase().includes(word)) s += 15 - i; });
    if (/(comparison|baseline|ablation|failure|input|reference|mask)/i.test(url)) s -= 30;
    return s;
  }
  async function discover(item) {
    const cacheKey = 'cc-media-v13:' + item.id;
    try {
      const saved = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (saved && Date.now() - saved.savedAt < 3600000 && saved.urls?.length) return saved.urls;
    } catch (_) {}
    let urls = [];
    for (const source of item.sources) {
      try {
        urls = candidatesFromHTML(await request(source), item.page);
        if (urls.length) break;
      } catch (_) {}
    }
    if (!urls.length && item.repo) {
      try {
        const meta = await request('https://api.github.com/repos/' + item.repo, true);
        const branch = meta.default_branch;
        const tree = await request('https://api.github.com/repos/' + item.repo + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1', true);
        urls = (tree.tree || []).filter(f => f.type === 'blob' && f.path.toLowerCase().startsWith(item.prefix.toLowerCase()) && /\.(mp4|webm)$/i.test(f.path))
          .map(f => 'https://raw.githubusercontent.com/' + item.repo + '/' + branch + '/' + f.path.split('/').map(encodeURIComponent).join('/'));
      } catch (_) {}
    }
    urls.sort((a, b) => score(b, item) - score(a, item));
    if (urls.length) { try { sessionStorage.setItem(cacheKey, JSON.stringify({savedAt: Date.now(), urls})); } catch (_) {} }
    return urls.slice(0, 3);
  }
  async function loadDiscovered(item) {
    const holder = document.getElementById(item.id)?.querySelector('.research-media');
    if (!holder) return;
    const frame = holder.querySelector('.media-frame');
    const video = holder.querySelector('video');
    const urls = await discover(item);
    if (!urls.length) { frame.classList.add('unavailable'); return; }
    let n = 0;
    const next = () => {
      if (n >= urls.length) { frame.classList.add('unavailable'); return; }
      video.src = urls[n++];
      video.load();
    };
    video.addEventListener('error', next);
    next();
  }
  config.discover.forEach(item => {
    const row = document.getElementById(item.id);
    if (!row) return;
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) { io.disconnect(); loadDiscovered(item); }
      }, {rootMargin: '500px'});
      io.observe(row);
    } else loadDiscovered(item);
  });
})();

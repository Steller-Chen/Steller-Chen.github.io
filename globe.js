/* Rotating visitor globe with privacy-conscious, city-level visitor dots.
   The globe renders entirely offline from a small land/ocean mask texture;
   live data appears when data-endpoint points at the Cloudflare Worker
   (cloudflare/visitor-worker.js). No fabricated visits or markers are shown. */
(() => {
  'use strict';
  const holder = document.getElementById('visitor-widget');
  if (!holder) return;
  const canvas = holder.querySelector('canvas');
  const summary = document.getElementById('visitor-summary');
  const note = document.getElementById('visitor-help');
  const ctx = canvas.getContext('2d', {alpha:true});
  if (!ctx) { summary.textContent = 'Globe preview unavailable in this browser.'; return; }

  /* ---------- look & feel ---------- */
  const OCEAN = [232, 242, 250];      // bright, airy water
  const LAND  = [164, 190, 214];      // light slate-blue land
  const MARK  = '#f0694c';            // coral visitor dots
  const MARK_HALO = 'rgba(240,105,76,.22)';
  const TILT  = 22 * Math.PI / 180;   // axial tilt toward the viewer
  const SPEED = (2 * Math.PI) / 60;   // one revolution per minute
  const FRAME_MS = 1000 / 24;
  const LIGHT = (() => { const v=[-0.45, 0.62, 0.64]; const n=Math.hypot(...v); return v.map(x=>x/n); })();

  /* ---------- geometry ---------- */
  const cssSize = Math.max(200, Math.round(holder.clientWidth || 320));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const N = Math.round(cssSize * dpr);
  canvas.width = canvas.height = N;
  canvas.style.width = canvas.style.height = cssSize + 'px';
  const C = N / 2, R = N / 2 - 1.5 * dpr;
  const TWO_PI = Math.PI * 2;
  const cosT = Math.cos(TILT), sinT = Math.sin(TILT);

  const dst = ctx.createImageData(N, N);
  const px = dst.data;
  const inside = [];
  const lonArr = new Float32Array(N * N);   // longitude in the sphere's own frame
  const vArr = new Float32Array(N * N);     // texture row fraction [0,1]
  const light = new Float32Array(N * N);
  const cover = new Uint8Array(N * N);      // anti-aliased edge coverage
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const idx = y * N + x;
    let nx = (x + 0.5 - C) / R, ny = -(y + 0.5 - C) / R;
    const rho = Math.hypot(nx, ny);
    const coverage = Math.max(0, Math.min(1, 0.5 + (1 - rho) * R));
    if (coverage <= 0) { px[idx * 4 + 3] = 0; continue; }
    if (rho > 1) { nx /= rho; ny /= rho; }
    const z = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    // view -> sphere frame (undo the tilt about the x axis)
    const ys = ny * cosT + z * sinT;
    const zs = -ny * sinT + z * cosT;
    lonArr[idx] = Math.atan2(nx, zs);
    vArr[idx] = (Math.PI / 2 - Math.asin(Math.max(-1, Math.min(1, ys)))) / Math.PI;
    const diffuse = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + z * LIGHT[2]);
    light[idx] = (0.86 + 0.14 * diffuse) * (0.93 + 0.07 * z);
    cover[idx] = Math.round(coverage * 255);
    inside.push(idx);
  }

  /* ---------- texture (land/ocean mask) ---------- */
  let land = null, TW = 0, TH = 0;
  const texture = new Image();
  texture.decoding = 'async';
  texture.onload = () => {
    const off = document.createElement('canvas');
    off.width = texture.naturalWidth; off.height = texture.naturalHeight;
    const oc = off.getContext('2d', {willReadFrequently:true});
    oc.drawImage(texture, 0, 0);
    const data = oc.getImageData(0, 0, off.width, off.height).data;
    TW = off.width; TH = off.height;
    land = new Float32Array(TW * TH);
    // The mask uses a dark ocean, a mid coast tone and a brighter land tone: map green to [0,1].
    for (let i = 0; i < TW * TH; i++) {
      land[i] = Math.max(0, Math.min(1, (data[i * 4 + 1] - 49) / 72));
    }
    lastPaint = 0;
    requestAnimationFrame(draw);
  };
  texture.onerror = () => { summary.textContent = 'Unable to load globe texture.'; };
  texture.src = holder.getAttribute('data-texture') || 'assets/earth-surface.png';

  /* ---------- animation state ---------- */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let speed = reduceMotion ? 0 : SPEED;
  let offset = 1.75;                 // start facing Asia-Pacific
  let lastPaint = 0;
  let visible = true;
  const marked = [];
  const countryCentres = window.COUNTRY_CENTRES || {};

  function paint() {
    const scale = TW / TWO_PI;
    const rowMax = TH - 1;
    for (const i of inside) {
      let u = (lonArr[i] + offset) * scale + TW / 2;
      u = ((u % TW) + TW) % TW;
      const u0 = u | 0, fu = u - u0, u1 = (u0 + 1) % TW;
      const v = vArr[i] * rowMax;
      const v0 = Math.min(rowMax, v | 0), fv = v - v0, v1 = Math.min(rowMax, v0 + 1);
      const r0 = v0 * TW, r1 = v1 * TW;
      const l = (land[r0 + u0] * (1 - fu) + land[r0 + u1] * fu) * (1 - fv) +
                (land[r1 + u0] * (1 - fu) + land[r1 + u1] * fu) * fv;
      const k = light[i], p = i * 4;
      px[p]     = (OCEAN[0] + (LAND[0] - OCEAN[0]) * l) * k;
      px[p + 1] = (OCEAN[1] + (LAND[1] - OCEAN[1]) * l) * k;
      px[p + 2] = (OCEAN[2] + (LAND[2] - OCEAN[2]) * l) * k;
      px[p + 3] = cover[i];
    }
    ctx.clearRect(0, 0, N, N);
    ctx.putImageData(dst, 0, 0);

    // Soft limb darkening and a faint gloss, clipped to the disc.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    let g = ctx.createRadialGradient(C, C, R * 0.55, C, C, R);
    g.addColorStop(0, 'rgba(70,100,130,0)');
    g.addColorStop(1, 'rgba(70,100,130,.17)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, N, N);
    g = ctx.createRadialGradient(C - R * 0.38, C - R * 0.42, 0, C - R * 0.38, C - R * 0.42, R * 0.9);
    g.addColorStop(0, 'rgba(255,255,255,.30)');
    g.addColorStop(0.45, 'rgba(255,255,255,.06)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, N, N);
    ctx.restore();

    ctx.beginPath(); ctx.arc(C, C, R, 0, TWO_PI);
    ctx.strokeStyle = 'rgba(60,90,120,.22)'; ctx.lineWidth = 1 * dpr; ctx.stroke();

    // Visitor markers (sphere frame -> tilted view frame).
    for (const m of marked) {
      const lon = m.lon * Math.PI / 180, lat = m.lat * Math.PI / 180;
      const diff = lon - offset, coslat = Math.cos(lat);
      const xs = coslat * Math.sin(diff), ys = Math.sin(lat), zs = coslat * Math.cos(diff);
      const yv = ys * cosT - zs * sinT, zv = ys * sinT + zs * cosT;
      if (zv < 0.04) continue;
      const X = C + R * xs, Y = C - R * yv;
      const fade = Math.min(1, zv * 4);
      const rad = dpr * Math.min(4.5, 2.0 + Math.log1p(m.count) * 0.8);
      ctx.globalAlpha = fade;
      ctx.beginPath(); ctx.arc(X, Y, rad * 2.4, 0, TWO_PI); ctx.fillStyle = MARK_HALO; ctx.fill();
      ctx.beginPath(); ctx.arc(X, Y, rad, 0, TWO_PI); ctx.fillStyle = MARK; ctx.fill();
      ctx.beginPath(); ctx.arc(X, Y, rad + 0.9 * dpr, 0, TWO_PI); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1 * dpr; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function draw(t) {
    if (!land) return;
    if (!lastPaint || t - lastPaint >= FRAME_MS) {
      if (lastPaint && speed) offset += Math.min(250, t - lastPaint) / 1000 * speed;
      lastPaint = t;
      paint();
    }
    if (speed && visible) requestAnimationFrame(draw);
  }

  // Pause the animation while the globe is scrolled out of view.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      const wasVisible = visible;
      visible = entries.some((e) => e.isIntersecting);
      if (visible && !wasVisible) { lastPaint = 0; requestAnimationFrame(draw); }
    }, {threshold: 0.05}).observe(holder);
  }

  /* ---------- live data ---------- */
  if (location.protocol === 'file:') {
    summary.textContent = 'Globe preview · no visits are recorded from a local file';
    return;
  }
  // GitHub Pages is a static host: a relative /api/visitors endpoint cannot exist there.
  // Live data needs an absolute endpoint (the Cloudflare Worker) set via data-endpoint.
  const endpoint = holder.getAttribute('data-endpoint') || '/api/visitors';
  const externalEndpoint = /^https?:\/\//i.test(endpoint);
  if (location.hostname.toLowerCase().endsWith('.github.io') && !externalEndpoint) {
    summary.textContent = 'Globe preview · live visitor tracking not connected yet';
    note.textContent = 'The globe is interactive. Real visitor countries and totals require an analytics service.';
    return;
  }

  async function getStats() {
    try {
      const response = await fetch(endpoint, {cache:'no-store', credentials:'omit'});
      if (!response.ok) throw Error('no backend');
      const data = await response.json();
      if (!data.enabled || typeof data.visits !== 'number') throw Error('not configured');
      const list = Array.isArray(data.countries) ? data.countries : [];
      const cities = Array.isArray(data.cities)
        ? data.cities.filter(c => Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon)) && Number(c.count) > 0)
        : [];
      marked.length = 0;
      if (cities.length) {
        // City-level dots (approximate coordinates from the backend, ~10 km granularity).
        const covered = new Set();
        for (const c of cities) { marked.push({lon:Number(c.lon), lat:Number(c.lat), count:Number(c.count)}); covered.add(c.country); }
        // Countries whose visits carried no coordinates still get a dot at the country centre.
        for (const entry of list) {
          const centre = countryCentres[entry.country];
          if (centre && !covered.has(entry.country) && Number(entry.count) > 0) marked.push({lon:centre[0], lat:centre[1], count:entry.count});
        }
      } else {
        for (const entry of list) {
          const centre = countryCentres[entry.country];
          if (centre && Number(entry.count) > 0) marked.push({lon:centre[0], lat:centre[1], count:entry.count});
        }
      }
      if (speed === 0 && marked.length) {
        // Static globe (reduced motion): face the busiest location and repaint once so the dots show.
        const top = marked.reduce((a, b) => (b.count > a.count ? b : a), marked[0]);
        offset = top.lon * Math.PI / 180;
        lastPaint = 0;
        requestAnimationFrame(draw);
      }
      const countries = list.filter(item => item.country !== 'XX' && Number(item.count) > 0).length;
      const cityCount = cities.filter(c => c.city && c.city !== 'Unknown').length;
      summary.textContent = data.visits.toLocaleString() + ' visits · ' + countries + ' countries' + (cityCount ? ' · ' + cityCount + ' cities' : '');
      note.textContent = cities.length
        ? 'Approximate city-level data. No IP addresses are stored.'
        : 'Approximate country-level data. No IP addresses are stored.';
      return true;
    } catch (e) {
      summary.textContent = 'Globe is ready · live counts activate when the site is deployed with its analytics backend';
      return false;
    }
  }

  async function registerAndFetch() {
    // Only record on real deployed sites, and no more than once per browser per day.
    const ok = await getStats();
    if (!ok || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      const key = 'cheng-chen-visit-day';
      if (localStorage.getItem(key) === today) return;
      const r = await fetch(endpoint, {method:'POST', credentials:'omit', headers:{'Content-Type':'text/plain'}, body:'visit'});
      if (r.ok) { localStorage.setItem(key, today); await getStats(); }
    } catch (_) {}
  }
  registerAndFetch();
})();

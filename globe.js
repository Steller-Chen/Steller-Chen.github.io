/* Real rotating globe + privacy-conscious country-level visitor telemetry.
   Globe renders offline; live data activates when /api/visitors is deployed.
   No fabricated visits or markers are shown. */
(() => {
  'use strict';
  const holder = document.getElementById('visitor-widget');
  if (!holder) return;
  const canvas = holder.querySelector('canvas');
  const summary = document.getElementById('visitor-summary');
  const note = document.getElementById('visitor-help');
  const ctx = canvas.getContext('2d', {alpha:true, willReadFrequently:false});
  if (!ctx) { summary.textContent = 'Globe preview unavailable in this browser.'; return; }
  const N = 240, R = 108, C = N / 2;
  canvas.width = canvas.height = N;
  const points = [];
  const dst = ctx.createImageData(N,N);
  const px = dst.data;
  const normLon = new Float32Array(N*N);
  const textureY = new Uint16Array(N*N);
  const light = new Float32Array(N*N);
  const inside = [];
  const TWO_PI = Math.PI * 2;
  for (let y=0; y<N; y++) for (let x=0; x<N; x++) {
    const idx = y*N+x;
    const nx = (x-C)/R, ny = -(y-C)/R;
    const rho = nx*nx + ny*ny;
    if (rho > 1) { px[idx*4+3]=0; continue; }
    const z = Math.sqrt(1-rho);
    normLon[idx] = Math.atan2(nx,z);
    textureY[idx] = Math.round((Math.PI/2 - Math.asin(ny))/Math.PI*511);
    const diffuse = Math.max(0.09, 0.62*z + 0.34*(-nx) + 0.13*ny);
    light[idx] = 0.35 + .70*diffuse;
    inside.push(idx);
    px[idx*4+3]=255;
  }
  const texture = new Image();
  texture.decoding = 'sync';
  let texPixels=null, texWidth=0, texHeight=0;
  let speed = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.10;
  let offset = -1.82;
  let last=0, lastPaint=0;
  const marked = [];
  const countryCentres = window.COUNTRY_CENTRES || {};
  function draw(t) {
    if (texPixels && (t-lastPaint >= 42 || !lastPaint)) {
      if (last) offset += Math.min(100,t-last)/1000*speed;
      lastPaint=t;
      const angleOffset = offset / TWO_PI * texWidth;
      const scale = texWidth / TWO_PI;
      for (const i of inside) {
        let tx = Math.floor(normLon[i]*scale+angleOffset+texWidth/2);
        tx = (tx % texWidth + texWidth) % texWidth;
        const txy = 4*(textureY[i]*texWidth + tx), p=4*i, k=light[i];
        px[p] = Math.min(255,texPixels[txy]*k+5);
        px[p+1] = Math.min(255,texPixels[txy+1]*k+6);
        px[p+2] = Math.min(255,texPixels[txy+2]*k+12);
      }
      ctx.clearRect(0,0,N,N);
      ctx.putImageData(dst,0,0);
      ctx.beginPath(); ctx.arc(C,C,R,0,TWO_PI);ctx.strokeStyle='rgba(35,74,109,.55)';ctx.lineWidth=1;ctx.stroke();
      for (const m of marked) {
        const lon = m.lon * Math.PI/180, lat=m.lat * Math.PI/180;
        const diff = lon-offset;
        const coslat = Math.cos(lat), z=coslat*Math.cos(diff);
        if (z < 0.06) continue;
        const x = C+R*coslat*Math.sin(diff), y=C-R*Math.sin(lat);
        const rad = Math.min(4, 2.1+Math.log1p(m.count)/2.5);
        ctx.beginPath();ctx.arc(x,y,rad*2,0,TWO_PI);ctx.fillStyle='rgba(240,197,99,.22)';ctx.fill();
        ctx.beginPath();ctx.arc(x,y,rad,0,TWO_PI);ctx.fillStyle='#f6c66c';ctx.fill();
        ctx.beginPath();ctx.arc(x,y,rad+.8,0,TWO_PI);ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=.65;ctx.stroke();
      }
    }
    last=t;
    if (speed !== 0) requestAnimationFrame(draw);
  }
  texture.onload=() => {
    const off=document.createElement('canvas');off.width=texture.naturalWidth;off.height=texture.naturalHeight;
    texWidth=off.width;texHeight=off.height;
    const oc=off.getContext('2d',{willReadFrequently:true});oc.drawImage(texture,0,0);
    texPixels=oc.getImageData(0,0,off.width,off.height).data;
    // The low-resolution source texture has 512 rows; this keeps the lookup exact.
    if (texHeight!==512) {for (const i of inside) textureY[i]=Math.round(textureY[i]*(texHeight-1)/511);}
    requestAnimationFrame(draw);
  };
  texture.onerror=() => { summary.textContent='Unable to load globe texture.'; };
  texture.src = holder.getAttribute('data-texture') || 'assets/earth-surface.png';
  const pageProtocol=location.protocol;
  if (pageProtocol === 'file:') {
    summary.textContent='Globe preview · no visits are recorded from a local file';
    return;
  }
  // GitHub Pages is a static host: a relative /api/visitors endpoint cannot exist there.
  // Live data needs an absolute endpoint (the Cloudflare Worker in cloudflare/visitor-worker.js)
  // set via data-endpoint. Without one, show the real rotating globe with an explicit preview label.
  const endpoint=holder.getAttribute('data-endpoint') || '/api/visitors';
  const externalEndpoint=/^https?:\/\//i.test(endpoint);
  if (location.hostname.toLowerCase().endsWith('.github.io') && !externalEndpoint) {
    summary.textContent='Globe preview · live visitor tracking not connected yet';
    note.textContent='The globe is interactive. Real visitor countries and totals require an analytics service.';
    return;
  }
  async function getStats() {
    try {
      const response=await fetch(endpoint,{cache:'no-store',credentials:'omit'});
      if (!response.ok) throw Error('no backend');
      const data=await response.json();
      if (!data.enabled || typeof data.visits!=='number') throw Error('not configured');
      const list=Array.isArray(data.countries) ? data.countries : [];
      const cities=Array.isArray(data.cities) ? data.cities.filter(c => Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon)) && Number(c.count)>0) : [];
      marked.length=0;
      if (cities.length) {
        // City-level dots (approximate coordinates from the backend, ~10 km granularity).
        const covered=new Set();
        for(const c of cities){ marked.push({lon:Number(c.lon),lat:Number(c.lat),count:Number(c.count)}); covered.add(c.country); }
        // Countries whose visits carried no coordinates still get a dot at the country centre.
        for(const entry of list){
          const center = countryCentres[entry.country];
          if(center && !covered.has(entry.country) && Number(entry.count)>0) marked.push({lon:center[0],lat:center[1],count:entry.count});
        }
      } else {
        for(const entry of list){
          const center = countryCentres[entry.country];
          if(center && Number(entry.count)>0) marked.push({lon:center[0],lat:center[1],count:entry.count});
        }
      }
      const countries=list.filter(item => item.country!=='XX' && Number(item.count)>0).length;
      const cityCount=cities.filter(c => c.city && c.city!=='Unknown').length;
      summary.textContent=data.visits.toLocaleString()+' visits · '+countries+' countries'+(cityCount ? ' · '+cityCount+' cities' : '');
      note.textContent=cities.length
        ? 'Approximate city-level data. No IP addresses are stored.'
        : 'Approximate country-level data. No IP addresses are stored.';
      return true;
    } catch (e) {
      summary.textContent='Globe is ready · live counts activate when the site is deployed with its analytics backend';
      return false;
    }
  }
  async function registerAndFetch() {
    // Only record on real deployed sites, and no more than once per browser per day.
    const ok=await getStats();
    if (!ok || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
    const today = new Date().toISOString().slice(0,10);
    try {
      const key='cheng-chen-visit-day';
      if (localStorage.getItem(key)===today) return;
      const r=await fetch(endpoint,{method:'POST',credentials:'omit',headers:{'Content-Type':'text/plain'},body:'visit'});
      if(r.ok){localStorage.setItem(key,today);await getStats();}
    } catch (_) {};
  }
  registerAndFetch();
})();

/**
 * Visitor-globe backend for https://steller-chen.github.io/
 * Runs as a Cloudflare Worker with a D1 database bound as `DB`.
 *
 * Privacy: only aggregates are stored — a visit count per (country, city) with
 * the city's approximate coordinates (rounded to 0.1°, ~10 km), all taken from
 * Cloudflare's own request.cf geolocation. No IP addresses, user agents,
 * per-visit timestamps or cookies. The browser de-duplicates its own visits
 * to one per day via localStorage (see globe.js).
 *
 * API (any path works; the site uses /api/visitors):
 *   GET  -> {enabled:true, visits, countries:[{country,count}], cities:[{country,city,lat,lon,count}]}
 *   POST -> records one visit for the caller's location (only from allowed origins)
 *
 * Setup (Cloudflare dashboard, free plan):
 *   1. Workers & Pages -> Create -> Worker -> paste this file -> Deploy
 *   2. Storage & Databases -> D1 -> Create database (any name)
 *   3. Worker -> Settings -> Bindings -> Add -> D1 database
 *        variable name: DB   database: the one from step 2
 *   4. (optional) Settings -> Variables -> ALLOWED_ORIGINS
 *        comma-separated list; default is the homepage origin below.
 * The table is created automatically on first request.
 */

const DEFAULT_ORIGINS = ['https://steller-chen.github.io'];
const MAX_CITIES = 400; // cap the GET payload; cities are returned by count, descending

function allowedOrigins(env) {
  const raw = (env.ALLOWED_ORIGINS || '').trim();
  if (!raw) return DEFAULT_ORIGINS;
  return raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

function corsHeaders(origin, allowed) {
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    // Stats are public; writes are restricted to the homepage origin.
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : '*',
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}

async function ensureTable(db) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS visits (' +
        'country TEXT NOT NULL, ' +
        'city TEXT NOT NULL, ' +
        'lat REAL, ' +
        'lon REAL, ' +
        'count INTEGER NOT NULL DEFAULT 0, ' +
        'updated_at TEXT, ' +
        'PRIMARY KEY (country, city))'
    )
    .run();
}

async function readStats(db) {
  const { results } = await db
    .prepare('SELECT country, city, lat, lon, count FROM visits WHERE count > 0 ORDER BY count DESC')
    .all();
  const rows = results || [];
  const byCountry = new Map();
  const cities = [];
  let visits = 0;
  for (const r of rows) {
    const count = Number(r.count) || 0;
    visits += count;
    byCountry.set(r.country, (byCountry.get(r.country) || 0) + count);
    if (cities.length < MAX_CITIES && r.lat !== null && r.lon !== null) {
      cities.push({ country: r.country, city: r.city, lat: Number(r.lat), lon: Number(r.lon), count });
    }
  }
  const countries = [...byCountry]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count);
  return { enabled: true, visits, countries, cities };
}

function locationOf(request) {
  const cf = request.cf || {};
  const country = /^[A-Z]{2}$/.test(cf.country || '') ? cf.country : 'XX';
  let city = String(cf.city || cf.region || '').trim().slice(0, 80);
  if (!city) city = 'Unknown';
  const lat = Number.parseFloat(cf.latitude);
  const lon = Number.parseFloat(cf.longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
  return {
    country,
    city,
    lat: hasCoords ? Math.round(lat * 10) / 10 : null,
    lon: hasCoords ? Math.round(lon * 10) / 10 : null,
  };
}

export default {
  async fetch(request, env) {
    const origin = (request.headers.get('Origin') || '').replace(/\/+$/, '');
    const allowed = allowedOrigins(env);
    const headers = corsHeaders(origin, allowed);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (!env.DB) {
      return json(
        { enabled: false, error: 'D1 database binding "DB" is missing (Worker -> Settings -> Bindings).' },
        503,
        headers
      );
    }

    try {
      await ensureTable(env.DB);

      if (request.method === 'GET' || request.method === 'HEAD') {
        return json(await readStats(env.DB), 200, headers);
      }

      if (request.method === 'POST') {
        // Browsers always send Origin on cross-origin POSTs; only the homepage may count visits.
        if (!allowed.includes(origin)) {
          return json({ error: 'origin not allowed' }, 403, headers);
        }
        const loc = locationOf(request);
        const now = new Date().toISOString();
        await env.DB
          .prepare(
            'INSERT INTO visits (country, city, lat, lon, count, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5) ' +
              'ON CONFLICT(country, city) DO UPDATE SET count = count + 1, ' +
              'lat = COALESCE(excluded.lat, lat), lon = COALESCE(excluded.lon, lon), updated_at = ?5'
          )
          .bind(loc.country, loc.city, loc.lat, loc.lon, now)
          .run();
        const stats = await readStats(env.DB);
        return json({ enabled: true, visits: stats.visits }, 200, headers);
      }

      return json({ error: 'method not allowed' }, 405, headers);
    } catch (err) {
      return json({ enabled: false, error: String((err && err.message) || err) }, 500, headers);
    }
  },
};

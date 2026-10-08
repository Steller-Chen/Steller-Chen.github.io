/**
 * Visitor-globe backend for https://steller-chen.github.io/
 * Runs as a Cloudflare Worker with a D1 database bound as `DB`.
 *
 * Privacy: only country-level aggregates are stored (ISO 3166-1 alpha-2 code
 * taken from Cloudflare's request.cf.country). No IP addresses, user agents,
 * timestamps per visit, or cookies. The browser de-duplicates its own visits
 * to one per day via localStorage (see globe.js).
 *
 * API (any path works; the site uses /api/visitors):
 *   GET  -> {enabled:true, visits:<total>, countries:[{country:"SG", count:12}, ...]}
 *   POST -> records one visit for the caller's country (only from allowed origins)
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

function allowedOrigins(env) {
  const raw = (env.ALLOWED_ORIGINS || '').trim();
  if (!raw) return DEFAULT_ORIGINS;
  return raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

function corsHeaders(origin, allowed) {
  const h = {
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  // Stats are public; writes are restricted to the homepage origin.
  h['Access-Control-Allow-Origin'] = allowed.includes(origin) ? origin : '*';
  return h;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}

async function ensureTable(db) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS visits (' +
        'country TEXT PRIMARY KEY, ' +
        'count INTEGER NOT NULL DEFAULT 0, ' +
        'updated_at TEXT)'
    )
    .run();
}

async function readStats(db) {
  const { results } = await db
    .prepare('SELECT country, count FROM visits WHERE count > 0 ORDER BY count DESC')
    .all();
  const countries = (results || []).map((r) => ({ country: r.country, count: Number(r.count) || 0 }));
  const visits = countries.reduce((sum, c) => sum + c.count, 0);
  return { enabled: true, visits, countries };
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
        const cfCountry = (request.cf && request.cf.country) || '';
        const country = /^[A-Z]{2}$/.test(cfCountry) ? cfCountry : 'XX';
        const now = new Date().toISOString();
        await env.DB
          .prepare(
            'INSERT INTO visits (country, count, updated_at) VALUES (?1, 1, ?2) ' +
              'ON CONFLICT(country) DO UPDATE SET count = count + 1, updated_at = ?2'
          )
          .bind(country, now)
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

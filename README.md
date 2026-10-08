# Cheng Chen — Academic Homepage

Static academic homepage (layout adapted from Jon Barron's public homepage), published at
<https://steller-chen.github.io/>.

## Deployment

GitHub Pages serves the `main` branch root directly (no build step; `.nojekyll` disables Jekyll).
Every push to `main` goes live within a minute or two.

## Files

- `index.html`, `stylesheet.css`, `media.js` — homepage and research previews
- `globe.js`, `country-centres.js` — 3D visitor globe, fed by the Cloudflare Worker below
- `assets/` — cat portrait, paper posters/videos, globe texture, favicon
- `Cheng_Chen_CV_Physical_Intelligence.pdf` — CV; the "CV" link opens it in a new browser tab
- `media-sources.json` — media manifest used by `media.js`

## Live visitor globe (optional backend)

The globe renders on its own; real visitor counts and country dots need a tiny backend because
GitHub Pages is static. `cloudflare/visitor-worker.js` is a Cloudflare Worker (free plan) backed by
a D1 database that stores **only per-city visit totals with approximate (0.1°) coordinates** — no IP addresses. Deploy it (instructions
at the top of the file), then set `data-endpoint` on `#visitor-widget` in `index.html` to the
Worker URL, e.g. `https://visitor-globe.<your-subdomain>.workers.dev/api/visitors`.

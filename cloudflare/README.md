# Cloudflare Workers Free + R2

Live deployment (`main` branch): https://ares.disra.net

Workers URL: https://ares-path.mdikiisra98.workers.dev

ARES runs on Cloudflare without a separate backend or a Workers Paid upgrade.
Workers Static Assets serves the Vite build. A private R2 binding supplies the
bootstrap metadata, routing grid, map imagery, and 3D terrain.

The browser calculates routes in a dedicated Web Worker, keeping computation
off the UI thread and outside Cloudflare's Free 10 ms CPU budget. It downloads
the gzip-compressed grid (about 24 MiB) once per page session and verifies its
SHA-256 before using it. The model retains the original 1423 × 949 grid at
approximately 5 m resolution and uses bounded typed arrays. The grid and search
workspace alone occupy about 73 MiB of client memory, with additional browser
overhead and 3D resources. Slow connections/devices can take longer on first use.

`/api/v1/bootstrap` advertises browser routing. The frontend automatically uses
the browser worker for planning, waypoint validation, emergency return, and
energy-loss scenarios. The Python backend does not advertise browser routing,
so the same frontend continues using the original HTTP API in offline mode.
Server routing endpoints in the Cloudflare deployment return HTTP 409 with an
explanation; this deployment does not offer a server-side routing API.

The R2 bucket remains private. Only explicitly allowed assets and the prepared
public scientific grid/metadata are served through the Worker. Python reference
fixtures and source rasters are not exposed. There is no database or user-data
storage. Workers Free and R2 usage limits still apply.

## Prepare and verify

Generate the normal processed data and web assets first (see the root README),
then run from the repository root with the application's Python dependencies:

```bash
python scripts/web/export_worker.py
cd app
npm ci
npm test
npm run build
cd ../cloudflare
npm ci
npm test
npx wrangler deploy --dry-run
```

The exporter generates Python reference plans locally. Tests compare recommended
and alternative routes, every route vertex, mission metrics, stop visits, return
envelope vertices, checkpoint science values, and emergency return against those
references. Data-dependent tests skip when no export is present; generate the
export before using the tests as a deployment gate.

## Publish

```bash
cd cloudflare
npx wrangler login
npx wrangler r2 bucket create ares-path-data  # once per account
cd ..
python scripts/web/upload_worker.py --account-id YOUR_ACCOUNT_ID
cd cloudflare
npm run deploy
```

`npm run deploy` publishes the main `ares-path` Worker and attaches the custom
domain `ares.disra.net`, including Cloudflare-managed DNS and HTTPS. Deployments
are manual; pushing `main` runs validation without automatically publishing it.

The upload script obtains the current OAuth/API token from Wrangler in memory.
No token is printed or saved in the repository. It uploads only the compressed
grid, metadata, and asset directories, about 44 MiB across 590 objects. Reference
fixtures and the uncompressed grid are excluded. Use `--routing-only` to upload
only the compressed grid and metadata when other assets are already uploaded.

Before replacing a dataset, change `vars.DATA_PREFIX` in `wrangler.jsonc`, upload
the new prefix, then deploy. Assets use a one-hour browser/edge cache. Routing
URLs include a dataset version; purge the asset cache if existing imagery or
terrain URLs need to change immediately.

After deploying, run the browser test against the public URL:

```bash
cd app
PLAYWRIGHT_BASE_URL=https://YOUR_WORKER.workers.dev PLAYWRIGHT_CHANNEL=chromium npx playwright test tests/e2e/cloudflare.spec.ts
```

This test loads the planner, then compares all browser-worker operations against
Python results and verifies that no routing POST requests reach Cloudflare.
The original `mission.spec.ts` also contains offline HTTP API-specific checks.

## Local Worker runtime

```bash
cd cloudflare
npx wrangler r2 object put ares-path-data/jezero-v1/grid.bin.gz --file ../data/processed/cloudflare/grid.bin.gz --content-type application/gzip --local
npx wrangler r2 object put ares-path-data/jezero-v1/metadata.json --file ../data/processed/cloudflare/metadata.json --local
npx wrangler dev
```

Upload imagery/terrain to local R2 as well for a complete local demo, or use the
published deployment. Health: `/api/v1/health`; bootstrap: `/api/v1/bootstrap`.

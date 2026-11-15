# ARES Path

ARES Path is an offline Marswalk route-planning and 3D exploration prototype for the NASA Space Apps Challenge. It combines real Jezero topography, imagery, geology, mineral indicators, rover context, and an explainable return-safety model.

## Data pipeline

The repository keeps only compact, reviewable samples. Source rasters and intermediate products are reproduced locally from official NASA and USGS sources.

```powershell
python -m pip install -r requirements-data.txt
python scripts/data/fetch.py --tier core
python scripts/data/preprocess.py --aoi data/aoi/jezero_delta_traverse.geojson
python scripts/data/validate.py
```

See [data/README.md](data/README.md) for sources, storage policy, CRS, and scientific limitations.

## Architecture

- `app/` — React, TypeScript, Vite, OpenLayers, and React Three Fiber.
- `server/` — FastAPI routing, waypoint validation, and local asset service.
- `scripts/web/` — reproducible browser-ready map and terrain assets.
- `data/processed/` — generated local routing, web, and 3D assets (not tracked).

The planner uses a map-first interface with curated science targets and user-created checkpoints. MarsWalk shares the same mission state and route.

## Install

Install the application dependencies once:

```powershell
python -m pip install -r requirements-app.txt
cd app
npm install
cd ..
python scripts/web/build_assets.py
```

## Development

Run the backend and frontend in separate terminals. From the repository root:

```powershell
python -m uvicorn server.main:app --reload --host 127.0.0.1 --port 8000
```

From `app/` in another terminal:

```powershell
npm run dev
```

Open `http://127.0.0.1:5173`. API documentation is available at `http://127.0.0.1:8000/api/docs`. Vite proxies local API, map, thumbnail, and terrain requests to FastAPI.

### Detailed MarsWalk terrain

With the prepared 1 m HiRISE DTM present, generate the optional 2 m near terrain
and lossless normal maps at their measured slope:

```bash
python scripts/web/build_assets.py --scene-only --fine-lod --normal-maps
```

For sharper textures, pass `--imagery-source data/processed/rasters/hirise_ortho_025m.tif`
after preparing a 25 cm crop of dataset D-03 using the same AOI, projection, and
`crop_raster(..., resolution=0.25)` utility in `scripts/data/preprocess.py`.
The builder preserves the source's available resolution, uses one contrast
stretch across tiles, and supplies smaller textures for distant/mobile terrain.
Elevation remains at 1:1 scale. Surface colour and the fixed sun direction are
illustrative; no synthetic rocks or displacement are added. These generated
assets stay local until the deployment dataset is explicitly updated.

## Prepared offline demo

Start the prepared offline demo with:

```powershell
.\scripts\run_demo.ps1
```

The launcher serves the React planner, FastAPI routing service, local map layers, and MarsWalk terrain at `http://127.0.0.1:8000`. No third-party service is required during the demo.

## Mission analyst with 9Router (optional)

The local Mission Analyst explains route results, inspects selected locations, and proposes planner-validated mission changes. Answers include NASA/USGS citations plus deterministic coverage, completeness, and confidence labels. The routing engine—not the language model—remains the source of all route and GO/NO-GO results.

Run development in three terminals:

1. Start 9Router and create a smart combo named `ares-mission-analyst`.
2. Copy `.env.example` to `.env`, set `ARES_LLM_ENABLED=true`, and optionally set `NINEROUTER_API_KEY`.
3. Start FastAPI and Vite with the commands in **Development** above.

ARES connects to `http://127.0.0.1:20128/v1` by default. The server checks `/v1/models`; the Advisor panel reports when 9Router is unreachable or the combo is missing. It uses ordinary JSON completions rather than model-specific tool calling, so 9Router can switch providers safely.

Mission proposals are previews. Applying one sends it back to the backend, rejects stale proposals, validates its permitted changes, and recalculates the route. With the analyst disabled, unavailable, or absent from the Cloudflare deployment, planning and MarsWalk continue unchanged.

Evaluate the configured 9Router combo against the bilingual 30-prompt intent set with:

```powershell
python scripts/evaluate_analyst.py
```

The command exits unsuccessfully when intent accuracy is below 90%.

## Cloudflare deployment

Production at https://ares.disra.net now runs on a Dokploy VM with the Python
backend and Mission Analyst. See [deploy/README.md](deploy/README.md) for releases.
The Cloudflare deployment below remains available at its Workers URL.

The application can also run entirely on Cloudflare Workers with a private R2
bucket. A browser Web Worker calculates routes from a compact export of the
original 5 m grid, while Static Assets serves React and R2 supplies terrain and
imagery. This fits the Workers Free CPU budget without a separate backend.
See [cloudflare/README.md](cloudflare/README.md) for export, verification, and
deployment commands.

## Device support

The planner adapts from 360 px mobile screens to wide desktop displays. Desktop uses a collapsible mission sidebar, tablet uses an overlay panel, and mobile uses a bottom sheet. MarsWalk supports keyboard/mouse and touch controls, with automatic terrain quality scaling on smaller devices.

## Test

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD="1"
python -m pytest tests -q
cd app
npm test
npm run build
npm run test:e2e
```

MarsWalk is a third-person orbital-data reconstruction. It does not resolve every small rock, ledge, or overhang and is not flight-certified.

## Troubleshooting

- Missing routing raster: run the data fetch and preprocess commands in `data/README.md`.
- Missing web or terrain assets: run `python scripts/web/build_assets.py`.
- Port already in use: stop the existing process on port 8000 or 5173 before starting development.
- Blank terrain: confirm `data/processed/3d/scene.json` exists and check the browser console for failed local asset requests.

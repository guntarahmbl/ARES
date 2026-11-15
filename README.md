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

## Prepared offline demo

Start the prepared offline demo with:

```powershell
.\scripts\run_demo.ps1
```

The launcher serves the React planner, FastAPI routing service, local map layers, and MarsWalk terrain at `http://127.0.0.1:8000`. No third-party service is required during the demo.

## Route advisor (optional)

The planner has an advisor panel that answers questions about the current route and proposes changes. It talks to any OpenAI-compatible chat endpoint, and every provider preset has a free tier.

1. Copy `.env.example` to `.env`.
2. Set one key: `GEMINI_API_KEY` (Google AI Studio), `GROQ_API_KEY` or `OPENROUTER_API_KEY`. For a local model, set `ARES_LLM_PROVIDER=ollama` instead.
3. Restart the server. The **Advisor** button appears in the header.

Free model line-ups change; if the default model is rejected, set `ARES_LLM_MODEL` to one your account lists. Hosted free tiers are rate-limited and may use prompts to improve their products, so use Ollama if the plan must stay on the machine.

The advisor only reads the planner's figures. Each proposal is re-planned by the routing engine before it is shown, and nothing changes until you choose **Apply to plan**. Without a key the panel explains how to set one up and the rest of the app is unaffected.

## Cloudflare deployment

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

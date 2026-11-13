# ARES Path

Astronaut Route & Exploration Safety Planner, implementing the local Jezero mission flow in [PRD_ARES_PATH_REVISION_DICKY.md](PRD_ARES_PATH_REVISION_DICKY.md).

The application now uses measured NASA/USGS terrain and imagery, interpreted geology, CRISM spectral indicators, rover localizations, twelve surface photos, and historical MEDA measurements. EVA resources, habitat, visit durations and scoring remain explicit assumptions.

## Run or download

Requires Node.js 22.12+.

```sh
npm ci
npm run dev
npm run build
```

Open **`dist/ares-path.html`** directly for the complete offline application. It contains all browser data, images, styles and Three.js. No server, account, API key or runtime network access is required. `dist/index.html` with `dist/assets/` is the deployable web build. External archive links open only when selected.

## Demonstration

1. Compare the recommended and alternative round trips through three observed rover stops. Defaults: 100 min, 60 abstract energy units, maximum slope 25°, reserve 20%.
2. Inspect the HiRISE imagery, derived elevation/slope, regional geology, three CRISM parameters and segmented rover traverse. Disable the return-envelope overlay to inspect the underlying image clearly.
3. Open each science stop for four downloaded surface photographs, camera position, product IDs, dates, credits, geology and spectral context.
4. Reorder/remove stops, move the hypothetical habitat before departure, or close an area. Routes recalculate with hard slope, nodata and closure exclusions.
5. Preview the EVA in 2D or 3D, or scrub the route position. Elapsed time includes visits; energy and the return envelope track cumulative consumption.
6. Apply **−20% energy**. The model removes lower-priority remaining stops when needed to preserve reserve. **Return now** generates a minimum-energy return, checking time and reserve separately.
7. Inspect the historical MEDA chart/table, export a JSON mission briefing, or reset the complete scenario.

## Data and reproduction

The local study has 81×81 routing nodes at 5 m spacing, centered at 77.405123636° E, 18.451193185° N. Native source windows and original tables/labels are retained locally under ignored `data/raw/`; compact reproducible outputs are versioned under `data/prepared/`.

```sh
python -m venv .venv-data
.venv-data/bin/pip install -r requirements-data.txt
.venv-data/bin/python scripts/data/demo.py --download
```

Without `--download`, this reprocesses existing originals and validates them. Large raster products are acquired by HTTP range requests for the required native pixels, avoiding multi-gigabyte full mosaics. All layers are transformed into one Mars CRS. See [data acquisition report](docs/data-acquisition.md), [prepared source metadata](data/prepared/sources.json), and [validation report](data/prepared/validation.json).

The upstream regional pipeline remains available in `scripts/data/{fetch,preprocess,validate}.py` and [data/README.md](data/README.md). Its broader kilometer-scale area is separate from this local EVA dataset. `validate_local.py` validates the assets used by the app.

## Verification

```sh
npm test
npm run test:browser
.venv-data/bin/python -m unittest discover -s tests -p 'test_*.py'
.venv-data/bin/python scripts/data/validate_local.py
```

The browser suite opens the standalone file in Playwright Chromium and checks photos, provenance, CRISM, MEDA, planning, adaptation, simulation, emergency return, 3D, closures, habitat, export and mobile layout. It rejects page errors and runtime HTTP requests. Install Chromium with `npx playwright install chromium` if needed. Test screenshots are generated under `dist/`.

## Architecture and limitations

`src/data.js` adapts the prepared dataset. `src/planner.js` implements deterministic least-cost routing, feasibility, adaptation and directed return-cost fields. `src/map.js` and `src/scene.js` share the measured grid. `src/main.js` manages mission state, evidence and export. `scripts/standalone.mjs` creates the offline artifact.

Regional geology has 100–200 m registration uncertainty and never determines obstacles. CRISM retains its native 18 m information limit; resampling is not higher-resolution mineral detection. Surface photos are linked to camera site/drive, not georeferenced rock footprints. MEDA sols 307–313 predate the local rover stops at sols 645–647 and are historical context, not a forecast. DTM-derived terrain omits unresolved obstacles. Energy, speed and scores are heuristics, with no physiological or operational validation. See [implementation status](docs/implementation-status.md).

The active specification is **Revision Dicky v2.0**, which supersedes v1.0 and makes a directly controllable 3D Marswalk a P0 requirement. This commit preserves the measured-data planner baseline before that simulation is implemented.

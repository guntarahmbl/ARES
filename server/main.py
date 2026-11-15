from __future__ import annotations

import json
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .analyst import (
    AnalystQuery,
    AnalystResponse,
    ApplyProposalRequest,
    ApplyProposalResponse,
    ProviderError,
    RateLimitError,
    StaleProposalError,
    analyst_status,
    apply_proposal,
    get_llm_config,
    query_analyst,
)
from .config import APP_DIST, DATA_ROOT, DEFAULT_MISSION, HABITAT_RADIUS_M, SCENE_ROOT, WEB_ROOT
from .routing import RoutingEngine, RoutingError, get_engine
from .schemas import (
    EnergyLossRequest,
    EnergyLossResponse,
    MissionConfig,
    ReturnRouteRequest,
    RoutePlanResponse,
    WaypointValidationRequest,
    WaypointValidationResponse,
)


app = FastAPI(title="ARES Path API", version="1.0.0", docs_url="/api/docs")


@app.get("/api/v1/health")
def health(engine: RoutingEngine = Depends(get_engine)) -> dict:
    return {
        "status": "ok",
        "grid": {"width": int(engine.elevation.shape[1]), "height": int(engine.elevation.shape[0]), "resolution_m": engine.resolution},
        "web_assets": WEB_ROOT.exists(),
        "marswalk_assets": (SCENE_ROOT / "scene.json").exists(),
    }


@app.get("/api/v1/bootstrap")
def bootstrap(engine: RoutingEngine = Depends(get_engine)) -> dict:
    def load_json(path: Path, fallback: dict) -> dict:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback

    aoi = load_json(DATA_ROOT / "aoi" / "jezero_delta_traverse.geojson", {"type": "FeatureCollection", "features": []})
    geology = load_json(DATA_ROOT / "samples" / "geology_units.geojson", {"type": "FeatureCollection", "features": []})
    traverse = load_json(DATA_ROOT / "samples" / "rover_traverse_simplified.geojson", {"type": "FeatureCollection", "features": []})
    waypoints = load_json(DATA_ROOT / "samples" / "science_waypoints.geojson", {"type": "FeatureCollection", "features": []})
    scene = load_json(SCENE_ROOT / "scene.json", engine.scene)
    surface_images = []
    csv_path = DATA_ROOT / "samples" / "surface_images.csv"
    if csv_path.exists():
        import csv
        with csv_path.open(encoding="utf-8", newline="") as stream:
            surface_images = list(csv.DictReader(stream))
    return {
        "aoi": aoi,
        "geology": geology,
        "traverse": traverse,
        "waypoints": waypoints,
        "surface_images": surface_images,
        "science_evidence": engine.science_evidence,
        "default_mission": DEFAULT_MISSION,
        "habitat_zone": {"center": DEFAULT_MISSION["habitat"], "radius_m": HABITAT_RADIUS_M},
        "scene": scene,
        "layers": [
            {"id": "imagery", "label": "HiRISE imagery", "url": "/assets/web/basemap.webp", "kind": "measured"},
            {"id": "slope", "label": "Slope", "url": "/assets/web/slope.webp", "kind": "derived"},
            {"id": "hazard", "label": "Traversability", "url": "/assets/web/hazard.webp", "kind": "derived"},
            {"id": "crism", "label": "CRISM OLINDEX3", "url": "/assets/web/crism.webp", "kind": "interpreted"},
        ],
        "limitations": engine.assumptions,
        "bounds_projected": [engine.bounds.left, engine.bounds.bottom, engine.bounds.right, engine.bounds.top],
    }


@app.post("/api/v1/routes/plan", response_model=RoutePlanResponse)
def plan_route(mission: MissionConfig, engine: RoutingEngine = Depends(get_engine)) -> RoutePlanResponse:
    return engine.plan(mission)


@app.post("/api/v1/waypoints/validate", response_model=WaypointValidationResponse)
def validate_waypoint(request: WaypointValidationRequest, engine: RoutingEngine = Depends(get_engine)) -> dict:
    return engine.validate_waypoint(request.longitude, request.latitude)


@app.post("/api/v1/routes/return")
def return_route(request: ReturnRouteRequest, engine: RoutingEngine = Depends(get_engine)) -> dict:
    try:
        route = engine.emergency_route(request.mission, request.position.longitude, request.position.latitude)
    except RoutingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"route": route, "reserve_after_return": request.remaining_energy - route.metrics.energy_units}


@app.post("/api/v1/scenarios/energy-loss", response_model=EnergyLossResponse)
def energy_loss(request: EnergyLossRequest, engine: RoutingEngine = Depends(get_engine)) -> EnergyLossResponse:
    new_budget = request.mission.energy_budget * (1 - request.loss_pct / 100)
    mission = request.mission.model_copy(update={"energy_budget": new_budget})
    plan = engine.plan(mission)
    status = "replanned" if plan.feasible else "return_required" if plan.primary else "infeasible"
    return EnergyLossResponse(mission=mission, plan=plan, status=status)


@app.get("/api/v1/assistant/status")
def assistant_status() -> dict:
    return analyst_status()


@app.post("/api/v1/assistant/query", response_model=AnalystResponse)
def assistant_query(payload: AnalystQuery, request: Request) -> AnalystResponse:
    config = get_llm_config()
    if config is None:
        raise HTTPException(status_code=503, detail="The local ARES Mission Analyst is disabled.")
    engine = get_engine()
    client_id = request.client.host if request.client else "local"
    try:
        return query_analyst(engine, config, payload, client_id)
    except RateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/v1/assistant/proposals/apply", response_model=ApplyProposalResponse)
def assistant_apply_proposal(payload: ApplyProposalRequest, engine: RoutingEngine = Depends(get_engine)) -> ApplyProposalResponse:
    try:
        return apply_proposal(engine, payload)
    except StaleProposalError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


if WEB_ROOT.exists():
    app.mount("/assets/web", StaticFiles(directory=WEB_ROOT), name="web-assets")
if SCENE_ROOT.exists():
    app.mount("/assets/3d", StaticFiles(directory=SCENE_ROOT), name="scene-assets")
if (DATA_ROOT / "samples" / "thumbnails").exists():
    app.mount("/assets/thumbnails", StaticFiles(directory=DATA_ROOT / "samples" / "thumbnails"), name="thumbnails")

if (APP_DIST / "assets").exists() and (APP_DIST / "index.html").exists():
    app.mount("/assets/app", StaticFiles(directory=APP_DIST / "assets"), name="app-assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        candidate = APP_DIST / path
        return FileResponse(candidate if candidate.is_file() else APP_DIST / "index.html")

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = REPO_ROOT / "data"
RASTER_ROOT = DATA_ROOT / "processed" / "rasters"
WEB_ROOT = DATA_ROOT / "processed" / "web"
SCENE_ROOT = DATA_ROOT / "processed" / "3d"
APP_DIST = REPO_ROOT / "app" / "dist"

MARS_GEOGRAPHIC = "+proj=longlat +R=3396190 +no_defs"
MARS_ANALYSIS = "+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +R=3396190 +units=m +no_defs"

DEFAULT_HABITAT = (77.450885729, 18.444627146)
HABITAT_RADIUS_M = 250.0
ABSOLUTE_MAX_SLOPE_DEG = 30.0
BASE_WALK_SPEED_M_S = 0.8
DEFAULT_VISIT_DURATION_MIN = 15.0

DEFAULT_MISSION = {
    "habitat": {"longitude": DEFAULT_HABITAT[0], "latitude": DEFAULT_HABITAT[1]},
    "route_stops": [
        {"type": "science", "id": "WP-01"},
        {"type": "science", "id": "WP-02"},
        {"type": "science", "id": "WP-03"},
    ],
    "max_duration_min": 720.0,
    "energy_budget": 45000.0,
    "preferred_max_slope_deg": 18.0,
    "return_reserve_pct": 20.0,
}

ROUTE_WEIGHTS = {
    "slope": 4.0,
    "roughness": 1.5,
    "uphill": 0.75,
    "alternative_corridor": 2.5,
}


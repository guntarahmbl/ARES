from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.config import DEFAULT_MISSION
from server.main import app


client = TestClient(app)
pytestmark = pytest.mark.skipif(
    not Path("data/processed/rasters/routing_elevation_5m.tif").exists(),
    reason="Processed routing fixtures are generated locally",
)


def test_health_reports_real_grid() -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["grid"]["width"] == 1423
    assert payload["marswalk_assets"] is True


def test_default_mission_has_two_routes_and_reserve() -> None:
    response = client.post("/api/v1/routes/plan", json=DEFAULT_MISSION)
    assert response.status_code == 200
    payload = response.json()
    assert payload["feasible"] is True
    assert payload["primary"]["metrics"]["distance_m"] > 1000
    assert payload["alternative"]["coordinates"] != payload["primary"]["coordinates"]
    assert payload["primary"]["metrics"]["return_reserve_units"] > 0
    assert payload["calculation_ms"] < 5000


def test_habitat_outside_zone_is_rejected_safely() -> None:
    mission = {**DEFAULT_MISSION, "habitat": {"longitude": 77.36, "latitude": 18.48}}
    response = client.post("/api/v1/routes/plan", json=mission)
    assert response.status_code == 200
    assert response.json()["feasible"] is False
    assert "250 m" in response.json()["warnings"][0]


def test_waypoint_validation_returns_terrain_and_science_context() -> None:
    response = client.post("/api/v1/waypoints/validate", json={"longitude": 77.439073689, "latitude": 18.464058093})
    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is True
    assert payload["terrain"]["traversable"] is True
    assert payload["terrain"]["slope_deg"] <= 30
    assert payload["science_context"]["geology_symbol"]


def test_custom_stop_routes_without_increasing_science_score() -> None:
    mission = {
        **DEFAULT_MISSION,
        "route_stops": [{
            "type": "custom",
            "id": "USR-test",
            "name": "Test checkpoint",
            "longitude": 77.439073689,
            "latitude": 18.464058093,
            "visit_duration_min": 5,
        }],
    }
    response = client.post("/api/v1/routes/plan", json=mission)
    assert response.status_code == 200
    payload = response.json()
    assert payload["primary"]["stop_visits"][0]["type"] == "custom"
    assert payload["primary"]["metrics"]["science_score"] == 0


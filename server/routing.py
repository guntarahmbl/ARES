from __future__ import annotations

import json
import math
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer
from scipy.ndimage import binary_dilation
from skimage.graph import MCP_Geometric, route_through_array
from shapely.geometry import Point, shape

from .config import (
    ABSOLUTE_MAX_SLOPE_DEG,
    BASE_WALK_SPEED_M_S,
    DATA_ROOT,
    DEFAULT_VISIT_DURATION_MIN,
    HABITAT_RADIUS_M,
    MARS_ANALYSIS,
    MARS_GEOGRAPHIC,
    RASTER_ROOT,
    ROUTE_WEIGHTS,
    SCENE_ROOT,
)
from .schemas import CustomRouteStop, MissionConfig, RouteCandidate, RouteMetrics, RoutePlanResponse


class RoutingError(RuntimeError):
    pass


class RoutingEngine:
    def __init__(self) -> None:
        self.to_projected = Transformer.from_crs(MARS_GEOGRAPHIC, MARS_ANALYSIS, always_xy=True)
        self.to_geographic = Transformer.from_crs(MARS_ANALYSIS, MARS_GEOGRAPHIC, always_xy=True)
        self.waypoints = self._load_waypoints()
        self._load_grid()
        self.scene = self._load_scene()
        self.science_evidence = self._load_science_evidence()

    def _load_grid(self) -> None:
        required = {
            "elevation": RASTER_ROOT / "routing_elevation_5m.tif",
            "slope": RASTER_ROOT / "slope_5m.tif",
            "roughness": RASTER_ROOT / "roughness_5m.tif",
            "mask": RASTER_ROOT / "traversability_mask_5m.tif",
        }
        missing = [str(path) for path in required.values() if not path.exists()]
        if missing:
            raise FileNotFoundError(f"Processed routing rasters are missing: {missing}")
        with rasterio.open(required["elevation"]) as source:
            self.elevation = source.read(1).astype(np.float32)
            self.transform = source.transform
            self.crs = source.crs
            self.nodata = source.nodata
            self.bounds = source.bounds
            self.resolution = abs(source.transform.a)
        with rasterio.open(required["slope"]) as source:
            self.slope = source.read(1).astype(np.float32)
        with rasterio.open(required["roughness"]) as source:
            self.roughness = source.read(1).astype(np.float32)
        with rasterio.open(required["mask"]) as source:
            self.mask = source.read(1).astype(bool)

        valid = self.mask & np.isfinite(self.elevation) & (self.elevation != self.nodata)
        valid &= np.isfinite(self.slope) & (self.slope >= 0)
        rough_values = self.roughness[valid & np.isfinite(self.roughness) & (self.roughness >= 0)]
        low, high = np.percentile(rough_values, (2, 98)) if rough_values.size else (0.0, 1.0)
        self.roughness_normalized = np.clip((self.roughness - low) / max(high - low, 1e-6), 0, 1)
        self.base_valid = valid

    def _load_waypoints(self) -> dict[str, dict[str, Any]]:
        path = DATA_ROOT / "samples" / "science_waypoints.geojson"
        data = json.loads(path.read_text(encoding="utf-8"))
        return {feature["properties"]["id"]: feature for feature in data["features"]}

    def _load_scene(self) -> dict[str, Any]:
        path = SCENE_ROOT / "scene.json"
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        center_x = (self.bounds.left + self.bounds.right) / 2
        center_y = (self.bounds.bottom + self.bounds.top) / 2
        return {"origin": {"x": center_x, "y": center_y, "elevation": 0.0}}

    def _load_science_evidence(self) -> dict[str, dict[str, Any]]:
        geology_path = DATA_ROOT / "samples" / "geology_units.geojson"
        self.geology = json.loads(geology_path.read_text(encoding="utf-8"))["features"] if geology_path.exists() else []
        self.crism_paths = {
            "olindex3": RASTER_ROOT / "crism_olindex3_5m.tif",
            "d2300": RASTER_ROOT / "crism_d2300_5m.tif",
            "min2295_2480": RASTER_ROOT / "crism_min2295_2480_5m.tif",
        }
        evidence: dict[str, dict[str, Any]] = {}
        for waypoint_id, waypoint in self.waypoints.items():
            longitude, latitude = waypoint["geometry"]["coordinates"]
            evidence[waypoint_id] = self.science_context(longitude, latitude)
        valid = [item["crism"]["olindex3"] for item in evidence.values() if item["crism"]["olindex3"] is not None]
        low, high = (min(valid), max(valid)) if valid else (0.0, 1.0)
        for item in evidence.values():
            value = item["crism"]["olindex3"]
            item["mineral_interest"] = round((value - low) / max(high - low, 1e-9), 3) if value is not None else 0.0
        return evidence

    def science_context(self, longitude: float, latitude: float) -> dict[str, Any]:
        point = Point(longitude, latitude)
        unit = next((feature["properties"] for feature in self.geology if shape(feature["geometry"]).covers(point)), {})
        indicators: dict[str, float | None] = {}
        x, y = self.to_projected.transform(longitude, latitude)
        for name, path in self.crism_paths.items():
            if not path.exists():
                indicators[name] = None
                continue
            with rasterio.open(path) as source:
                value = next(source.sample([(x, y)], masked=True))[0]
                indicators[name] = round(float(value), 6) if np.isfinite(value) and value != source.nodata else None
        return {
            "geology_unit": unit.get("name") or unit.get("unit") or "Mapped Jezero unit",
            "geology_symbol": unit.get("symbol") or unit.get("symbol_noSub") or "—",
            "crism": indicators,
            "classification": "interpreted",
        }

    def validate_waypoint(self, longitude: float, latitude: float) -> dict[str, Any]:
        x, y = self.to_projected.transform(longitude, latitude)
        inside = self.bounds.left <= x <= self.bounds.right and self.bounds.bottom <= y <= self.bounds.top
        warnings: list[str] = []
        if not inside:
            return {
                "valid": False,
                "coordinate": {"longitude": longitude, "latitude": latitude},
                "terrain": {"traversable": False},
                "science_context": {},
                "warnings": ["The checkpoint is outside the prepared Jezero area."],
            }
        row, col = self.projected_to_cell(x, y)
        valid = bool(self.base_valid[row, col] and self.slope[row, col] <= ABSOLUTE_MAX_SLOPE_DEG)
        if not self.base_valid[row, col]:
            warnings.append("No valid terrain data is available at this location.")
        elif self.slope[row, col] > ABSOLUTE_MAX_SLOPE_DEG:
            warnings.append(f"Slope exceeds the {ABSOLUTE_MAX_SLOPE_DEG:.0f}° hard limit.")
        context = self.science_context(longitude, latitude)
        context["mineral_interest"] = None
        if context["crism"].get("olindex3") is None:
            warnings.append("CRISM coverage is unavailable at this checkpoint.")
        return {
            "valid": valid,
            "coordinate": {"longitude": longitude, "latitude": latitude},
            "terrain": {
                "elevation_m": round(float(self.elevation[row, col]), 2),
                "slope_deg": round(float(self.slope[row, col]), 2),
                "roughness": round(float(self.roughness_normalized[row, col]), 3),
                "traversable": valid,
            },
            "science_context": context,
            "warnings": warnings,
        }

    def projected_to_cell(self, x: float, y: float) -> tuple[int, int]:
        row, col = rasterio.transform.rowcol(self.transform, x, y)
        row = int(np.clip(row, 0, self.elevation.shape[0] - 1))
        col = int(np.clip(col, 0, self.elevation.shape[1] - 1))
        return row, col

    def coordinate_to_cell(self, longitude: float, latitude: float) -> tuple[int, int]:
        return self.projected_to_cell(*self.to_projected.transform(longitude, latitude))

    def cell_to_coordinates(self, row: int, col: int) -> tuple[float, float, float, float, float]:
        x, y = rasterio.transform.xy(self.transform, row, col)
        lon, lat = self.to_geographic.transform(x, y)
        elevation = float(self.elevation[row, col])
        origin = self.scene["origin"]
        local_x = x - origin["x"]
        local_y = elevation - origin.get("elevation", 0.0)
        local_z = origin["y"] - y
        return lon, lat, local_x, local_y, local_z

    def is_valid_habitat(self, mission: MissionConfig) -> bool:
        default = self.to_projected.transform(77.450885729, 18.444627146)
        current = self.to_projected.transform(mission.habitat.longitude, mission.habitat.latitude)
        if math.dist(default, current) > HABITAT_RADIUS_M:
            return False
        row, col = self.coordinate_to_cell(mission.habitat.longitude, mission.habitat.latitude)
        return bool(self.base_valid[row, col] and self.slope[row, col] <= 20)

    def _cost_surface(self, preferred_slope: float) -> np.ndarray:
        hard_valid = self.base_valid & (self.slope <= ABSOLUTE_MAX_SLOPE_DEG)
        slope_ratio = np.clip(self.slope / max(preferred_slope, 1), 0, 2)
        cost = 1 + ROUTE_WEIGHTS["slope"] * slope_ratio**2
        cost += ROUTE_WEIGHTS["roughness"] * self.roughness_normalized
        cost = cost.astype(np.float32)
        cost[~hard_valid] = np.inf
        return cost

    def _segment(self, cost: np.ndarray, start: tuple[int, int], end: tuple[int, int]) -> list[tuple[int, int]]:
        if not np.isfinite(cost[start]) or not np.isfinite(cost[end]):
            raise RoutingError("Start or destination lies on excluded terrain")
        try:
            indices, _ = route_through_array(cost, start, end, fully_connected=True, geometric=True)
        except ValueError as exc:
            raise RoutingError("No traversable connection exists") from exc
        return [(int(row), int(col)) for row, col in indices]

    def _resolved_stops(self, mission: MissionConfig) -> list[tuple[str, str, tuple[int, int]]]:
        resolved: list[tuple[str, str, tuple[int, int]]] = []
        for stop in mission.route_stops:
            if stop.type == "science":
                if stop.id not in self.waypoints:
                    raise RoutingError(f"Unknown science target: {stop.id}")
                longitude, latitude = self.waypoints[stop.id]["geometry"]["coordinates"]
            else:
                validation = self.validate_waypoint(stop.longitude, stop.latitude)
                if not validation["valid"]:
                    raise RoutingError(f"Invalid checkpoint {stop.name}: {' '.join(validation['warnings'])}")
                longitude, latitude = stop.longitude, stop.latitude
            resolved.append((stop.id, stop.type, self.coordinate_to_cell(longitude, latitude)))
        return resolved

    def _route_cells(self, mission: MissionConfig, cost: np.ndarray) -> list[tuple[int, int]]:
        stops = [self.coordinate_to_cell(mission.habitat.longitude, mission.habitat.latitude)]
        stops.extend(cell for _, _, cell in self._resolved_stops(mission))
        stops.append(stops[0])
        route: list[tuple[int, int]] = []
        for start, end in zip(stops, stops[1:]):
            segment = self._segment(cost, start, end)
            route.extend(segment if not route else segment[1:])
        return route

    def _candidate(self, route_id: str, label: str, cells: list[tuple[int, int]], mission: MissionConfig) -> RouteCandidate:
        rows = np.array([cell[0] for cell in cells], dtype=int)
        cols = np.array([cell[1] for cell in cells], dtype=int)
        geo: list[list[float]] = []
        scene: list[list[float]] = []
        for row, col in cells:
            lon, lat, x, y, z = self.cell_to_coordinates(row, col)
            geo.append([lon, lat, float(self.elevation[row, col])])
            scene.append([x, y, z])

        xy = np.array([rasterio.transform.xy(self.transform, int(row), int(col)) for row, col in cells])
        steps = np.hypot(np.diff(xy[:, 0]), np.diff(xy[:, 1]))
        distance = float(steps.sum())
        elevations = self.elevation[rows, cols]
        elevation_diff = np.diff(elevations)
        slope_values = self.slope[rows, cols]
        slope_ratio = np.clip(slope_values / max(mission.preferred_max_slope_deg, 1), 0, 2)
        energy_steps = np.r_[steps, 0] * (
            1 + ROUTE_WEIGHTS["slope"] * slope_ratio**2 + ROUTE_WEIGHTS["roughness"] * self.roughness_normalized[rows, cols]
        )
        energy = float(energy_steps.sum())
        speed = np.maximum(0.2, BASE_WALK_SPEED_M_S / (1 + 2.5 * slope_ratio[:-1]))
        travel_minutes = float(np.sum(steps / speed) / 60)
        visit_duration = sum(
            stop.visit_duration_min if isinstance(stop, CustomRouteStop) else DEFAULT_VISIT_DURATION_MIN
            for stop in mission.route_stops
        )
        duration = travel_minutes + visit_duration
        reserve = mission.energy_budget - energy
        safety = float(np.clip(100 - np.percentile(slope_values, 95) / ABSOLUTE_MAX_SLOPE_DEG * 70 - np.mean(self.roughness_normalized[rows, cols]) * 30, 0, 100))
        science_ids = [stop.id for stop in mission.route_stops if stop.type == "science"]
        priority_score = sum(float(self.waypoints[item]["properties"].get("priority", 1)) for item in science_ids) / 9
        units = {self.science_evidence[item]["geology_symbol"] for item in science_ids}
        diversity_score = len(units) / max(1, len(science_ids))
        mineral_score = float(np.mean([self.science_evidence[item]["mineral_interest"] for item in science_ids])) if science_ids else 0.0
        science = min(100.0, (priority_score * 0.7 + diversity_score * 0.15 + mineral_score * 0.15) * 100)

        cumulative = np.r_[0, np.cumsum(steps)]
        sample_step = max(1, len(cells) // 180)
        profile = [
            {"distance_m": float(cumulative[index]), "elevation_m": float(elevations[index]), "slope_deg": float(slope_values[index])}
            for index in range(0, len(cells), sample_step)
        ]
        if profile[-1]["distance_m"] != float(cumulative[-1]):
            profile.append({"distance_m": float(cumulative[-1]), "elevation_m": float(elevations[-1]), "slope_deg": float(slope_values[-1])})

        explanation = [
            f"Route avoids terrain above {ABSOLUTE_MAX_SLOPE_DEG:.0f}° and nodata cells.",
            f"The 95th-percentile slope is {np.percentile(slope_values, 95):.1f}°.",
            f"The mission visits {len(mission.route_stops)} stops with a science score of {science:.0f}/100.",
        ]
        stop_visits: list[dict[str, Any]] = []
        search_from = 0
        for stop_id, stop_type, stop_cell in self._resolved_stops(mission):
            index = next((i for i in range(search_from, len(cells)) if cells[i] == stop_cell), search_from)
            search_from = index
            stop_visits.append({
                "id": stop_id,
                "type": stop_type,
                "route_vertex_index": index,
                "arrival_distance_m": round(float(cumulative[index]), 1),
                "arrival_energy_units": round(float(energy_steps[:index].sum()), 1),
            })
        metrics = RouteMetrics(
            distance_m=round(distance, 1),
            duration_min=round(duration, 1),
            elevation_gain_m=round(float(elevation_diff[elevation_diff > 0].sum()), 1),
            elevation_loss_m=round(float(-elevation_diff[elevation_diff < 0].sum()), 1),
            maximum_slope_deg=round(float(slope_values.max()), 1),
            energy_units=round(energy, 1),
            safety_score=round(safety, 1),
            science_score=round(science, 1),
            return_reserve_units=round(reserve, 1),
        )
        return RouteCandidate(
            id=route_id,
            label=label,
            coordinates=geo,
            scene_coordinates=scene,
            metrics=metrics,
            elevation_profile=profile,
            explanation=explanation,
            stop_visits=stop_visits,
        )

    def _return_envelope(self, mission: MissionConfig, cost: np.ndarray, habitat: tuple[int, int]) -> dict[str, Any]:
        stride = 8
        coarse = cost[::stride, ::stride]
        coarse_habitat = (habitat[0] // stride, habitat[1] // stride)
        try:
            accumulated, _ = MCP_Geometric(coarse).find_costs([coarse_habitat])
        except Exception:
            return {"type": "FeatureCollection", "features": []}
        remaining = mission.energy_budget * (1 - mission.return_reserve_pct / 100)
        levels = [("safe", 0.65), ("caution", 1.0)]
        features = []
        coarse_transform = self.transform * rasterio.Affine.scale(stride, stride)
        from rasterio.features import shapes

        hab_x, hab_y = self.to_projected.transform(mission.habitat.longitude, mission.habitat.latitude)
        hab_point = Point(hab_x, hab_y)

        for label, fraction in levels:
            mask = np.isfinite(accumulated) & (accumulated * self.resolution * stride <= remaining * fraction)
            candidates = [g for g, val in shapes(mask.astype(np.uint8), mask=mask, transform=coarse_transform) if val == 1]
            if not candidates:
                continue
            matching = [g for g in candidates if shape(g).covers(hab_point)]
            best = matching[0] if matching else max(candidates, key=lambda g: shape(g).area)
            coordinates = []
            for ring in best["coordinates"]:
                lonlat = [self.to_geographic.transform(x, y) for x, y in ring]
                coordinates.append([[lon, lat] for lon, lat in lonlat])
            features.append({"type": "Feature", "properties": {"state": label}, "geometry": {"type": "Polygon", "coordinates": coordinates}})
        return {"type": "FeatureCollection", "features": features}

    def plan(self, mission: MissionConfig, include_envelope: bool = True) -> RoutePlanResponse:
        started = time.perf_counter()
        warnings: list[str] = []
        if not self.is_valid_habitat(mission):
            return RoutePlanResponse(
                feasible=False,
                return_envelope={"type": "FeatureCollection", "features": []},
                warnings=["Habitat must remain on valid terrain within the approved 250 m zone."],
                assumptions=self.assumptions,
                calculation_ms=round((time.perf_counter() - started) * 1000, 1),
            )
        cost = self._cost_surface(mission.preferred_max_slope_deg)
        try:
            primary_cells = self._route_cells(mission, cost)
            primary = self._candidate("primary", "Recommended route", primary_cells, mission)
            corridor = np.zeros_like(cost, dtype=bool)
            for row, col in primary_cells:
                corridor[row, col] = True
            corridor = binary_dilation(corridor, iterations=5)
            alternate_cost = cost.copy()
            alternate_cost[corridor & np.isfinite(alternate_cost)] *= ROUTE_WEIGHTS["alternative_corridor"]
            alternative_cells = self._route_cells(mission, alternate_cost)
            alternative = self._candidate("alternative", "Terrain-diverse alternative", alternative_cells, mission)
        except RoutingError as exc:
            return RoutePlanResponse(
                feasible=False,
                return_envelope={"type": "FeatureCollection", "features": []},
                warnings=[str(exc)],
                assumptions=self.assumptions,
                calculation_ms=round((time.perf_counter() - started) * 1000, 1),
            )

        reserve_required = mission.energy_budget * mission.return_reserve_pct / 100
        feasible = (
            primary.metrics.return_reserve_units >= reserve_required
            and primary.metrics.duration_min <= mission.max_duration_min
        )
        if primary.metrics.return_reserve_units < reserve_required:
            warnings.append("The selected mission would violate the configured energy return reserve.")
        if primary.metrics.duration_min > mission.max_duration_min:
            warnings.append("The selected mission exceeds the configured EVA duration.")
        habitat = self.coordinate_to_cell(mission.habitat.longitude, mission.habitat.latitude)
        envelope = self._return_envelope(mission, cost, habitat) if include_envelope else {"type": "FeatureCollection", "features": []}
        return RoutePlanResponse(
            feasible=feasible,
            primary=primary,
            alternative=alternative,
            return_envelope=envelope,
            warnings=warnings,
            assumptions=self.assumptions,
            calculation_ms=round((time.perf_counter() - started) * 1000, 1),
        )

    def emergency_route(self, mission: MissionConfig, longitude: float, latitude: float) -> RouteCandidate:
        cost = self._cost_surface(mission.preferred_max_slope_deg)
        start = self.coordinate_to_cell(longitude, latitude)
        end = self.coordinate_to_cell(mission.habitat.longitude, mission.habitat.latitude)
        cells = self._segment(cost, start, end)
        return self._candidate("emergency", "Emergency return", cells, mission.model_copy(update={"route_stops": []}))

    @property
    def assumptions(self) -> list[str]:
        return [
            "Energy is an abstract comparison index, not a life-support or physiology model.",
            "Walking speed starts at 0.8 m/s and decreases with slope.",
            "Orbital terrain does not resolve every small rock, ledge, or overhang.",
            "CRISM values are remote-sensing indicators rather than confirmed field identifications.",
        ]


@lru_cache(maxsize=1)
def get_engine() -> RoutingEngine:
    return RoutingEngine()


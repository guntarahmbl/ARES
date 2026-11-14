from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator


class Coordinate(BaseModel):
    longitude: float
    latitude: float


class ScienceRouteStop(BaseModel):
    type: Literal["science"]
    id: str


class CustomRouteStop(BaseModel):
    type: Literal["custom"]
    id: str
    name: str = Field(min_length=1, max_length=80)
    longitude: float
    latitude: float
    visit_duration_min: float = Field(ge=0, le=240, default=5)


RouteStop = Annotated[ScienceRouteStop | CustomRouteStop, Field(discriminator="type")]


class MissionConfig(BaseModel):
    habitat: Coordinate
    route_stops: list[RouteStop] = Field(min_length=1, max_length=12)
    max_duration_min: float = Field(gt=0, le=1440)
    energy_budget: float = Field(gt=0, le=200000)
    preferred_max_slope_deg: float = Field(gt=0, le=30)
    return_reserve_pct: float = Field(ge=0, le=80)

    @field_validator("route_stops")
    @classmethod
    def unique_waypoints(cls, value: list[RouteStop]) -> list[RouteStop]:
        ids = [item.id for item in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Route stop IDs must be unique")
        return value


class RouteMetrics(BaseModel):
    distance_m: float
    duration_min: float
    elevation_gain_m: float
    elevation_loss_m: float
    maximum_slope_deg: float
    energy_units: float
    safety_score: float
    science_score: float
    return_reserve_units: float


class RouteCandidate(BaseModel):
    id: str
    label: str
    coordinates: list[list[float]]
    scene_coordinates: list[list[float]]
    metrics: RouteMetrics
    elevation_profile: list[dict[str, float]]
    explanation: list[str]
    stop_visits: list[dict[str, Any]]


class RoutePlanResponse(BaseModel):
    feasible: bool
    primary: RouteCandidate | None = None
    alternative: RouteCandidate | None = None
    return_envelope: dict[str, Any]
    warnings: list[str]
    assumptions: list[str]
    calculation_ms: float


class ReturnRouteRequest(BaseModel):
    mission: MissionConfig
    position: Coordinate
    remaining_energy: float = Field(gt=0)


class EnergyLossRequest(BaseModel):
    mission: MissionConfig
    current_position: Coordinate | None = None
    loss_pct: float = Field(gt=0, le=90)


class EnergyLossResponse(BaseModel):
    mission: MissionConfig
    plan: RoutePlanResponse
    status: Literal["replanned", "return_required", "infeasible"]


class WaypointValidationRequest(Coordinate):
    pass


class WaypointValidationResponse(BaseModel):
    valid: bool
    coordinate: Coordinate
    terrain: dict[str, Any]
    science_context: dict[str, Any]
    warnings: list[str]


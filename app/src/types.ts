export type Coordinate = { longitude: number; latitude: number }
export type WalkTelemetry = {
  localPosition: [number, number, number]
  projectedPosition: [number, number]
  coordinate: Coordinate
  headingRad: number
  routeIndex: number | null
  progress: number
  mode: 'guided' | 'free'
  updatedAt: number
}
export type ScienceRouteStop = { type: 'science'; id: string }
export type CustomRouteStop = Coordinate & { type: 'custom'; id: string; name: string; visit_duration_min: number }
export type RouteStop = ScienceRouteStop | CustomRouteStop

export type MissionConfig = {
  habitat: Coordinate
  route_stops: RouteStop[]
  max_duration_min: number
  energy_budget: number
  preferred_max_slope_deg: number
  return_reserve_pct: number
}

export type RouteMetrics = {
  distance_m: number
  duration_min: number
  elevation_gain_m: number
  elevation_loss_m: number
  maximum_slope_deg: number
  energy_units: number
  safety_score: number
  science_score: number
  return_reserve_units: number
}

export type RouteCandidate = {
  id: string
  label: string
  coordinates: number[][]
  scene_coordinates: number[][]
  metrics: RouteMetrics
  elevation_profile: { distance_m: number; elevation_m: number; slope_deg: number }[]
  explanation: string[]
  stop_visits: { id: string; type: RouteStop['type']; route_vertex_index: number; arrival_distance_m: number; arrival_energy_units: number }[]
}

export type WaypointValidation = {
  valid: boolean
  coordinate: Coordinate
  terrain: { elevation_m?: number; slope_deg?: number; roughness?: number; traversable: boolean }
  science_context: { geology_unit?: string; geology_symbol?: string; crism?: Record<string, number | null> }
  warnings: string[]
}

export type RoutePlan = {
  feasible: boolean
  primary: RouteCandidate | null
  alternative: RouteCandidate | null
  return_envelope: GeoJSON.FeatureCollection
  warnings: string[]
  assumptions: string[]
  calculation_ms: number
}

export type WaypointFeature = GeoJSON.Feature<GeoJSON.Point, {
  id: string
  name: string
  sol: number
  priority: number
  status: string
  science_rationale: string
  source: string
}>

export type SceneTile = {
  id: string
  bounds_projected: number[]
  bounds_local: number[]
  texture_url: string
  lods: { resolution_m: number; url: string; rows: number; cols: number }[]
}

export type SceneManifest = {
  schema_version: string
  coordinate_system: Record<string, string>
  origin: { x: number; y: number; longitude: number; latitude: number; elevation: number }
  bounds_projected: number[]
  bounds_local: number[]
  tiles: SceneTile[]
  overview: { url: string; rows: number; cols: number; resolution_m: number }
  limitations: string[]
}

export type Bootstrap = {
  routing?: { runtime: 'browser'; metadata_url: string; grid_url: string }
  aoi: GeoJSON.FeatureCollection
  geology: GeoJSON.FeatureCollection
  traverse: GeoJSON.FeatureCollection
  waypoints: GeoJSON.FeatureCollection<GeoJSON.Point, WaypointFeature['properties']>
  surface_images: Record<string, string>[]
  science_evidence: Record<string, {
    geology_unit: string
    geology_symbol: string
    crism: Record<string, number | null>
    mineral_interest: number
    classification: string
  }>
  default_mission: MissionConfig
  habitat_zone: { center: Coordinate; radius_m: number }
  scene: SceneManifest
  layers: { id: string; label: string; url: string; kind: string }[]
  limitations: string[]
  bounds_projected: number[]
}


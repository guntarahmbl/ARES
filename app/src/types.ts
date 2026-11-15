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
  science_context: { geology_unit?: string; geology_symbol?: string; crism?: Record<string, number | null>; crism_coverage?: Record<string, string> }
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

export type AdvisorProposal = {
  summary: string
  changes: string[]
  mission: MissionConfig
  preview: {
    feasible: boolean
    warnings: string[]
    route: Pick<RouteMetrics, 'distance_m' | 'duration_min' | 'energy_units' | 'return_reserve_units' | 'maximum_slope_deg' | 'elevation_gain_m' | 'science_score'> | null
  }
  based_on_revision: string
}

export type AdvisorIntent = 'configure_mission' | 'explain_route' | 'compare_routes' | 'inspect_location' | 'data_provenance' | 'unsupported'

export type AdvisorEvidence = {
  evidence_id: string
  dataset_id: string
  kind: string
  label: string
  value: unknown
  unit: string | null
  classification: 'measured' | 'derived' | 'interpreted' | 'assumed'
  coverage: 'available' | 'partial' | 'outside_coverage' | 'missing'
  completeness: 'complete' | 'incomplete' | 'unknown'
  confidence: 'high' | 'medium' | 'low' | 'not_applicable'
  confidence_reasons: string[]
  limitations: string[]
  thumbnail_url: string | null
  source_url: string | null
  metadata: Record<string, unknown>
}

export type AdvisorCitation = {
  dataset_id: string
  title: string
  product_id: string | null
  catalog_url: string
  version: string | null
  resolution_m: number | null
  classification: string
  attribution: string | null
  license: string | null
  processing: string | null
}

export type AdvisorRequest = {
  message: string
  mission: MissionConfig
  active_route: 'primary' | 'alternative'
  selected_waypoint_id?: string
  selected_coordinate?: Coordinate
  mission_revision: string
}

export type AdvisorResponse = {
  request_id: string
  intent: AdvisorIntent
  answer: string
  citations: AdvisorCitation[]
  evidence: AdvisorEvidence[]
  proposal: AdvisorProposal | null
  warnings: string[]
  model: string
  prompt_version: string
}

export type AdvisorStatus = {
  available: boolean
  state: 'disabled' | 'unreachable' | 'model_unavailable' | 'ready'
  provider: string
  model: string | null
  detail: string | null
}

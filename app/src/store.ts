import { create } from 'zustand'
import { api } from './api'
import { coordinateToProjected, projectedToLocal } from './lib/marsProjection'
import type { Bootstrap, Coordinate, CustomRouteStop, MissionConfig, RouteCandidate, RoutePlan, RouteStop, WalkTelemetry, WaypointValidation } from './types'

type ViewMode = 'planner' | 'marswalk'
type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type PlacementMode = 'habitat' | 'stop' | null

type MissionStore = {
  bootstrap: Bootstrap | null; mission: MissionConfig | null; plan: RoutePlan | null
  emergencyRoute: RouteCandidate | null; waypointValidation: WaypointValidation | null; draftStop: CustomRouteStop | null
  view: ViewMode; state: LoadState; error: string | null; selectedWaypoint: string | null; hoveredWaypoint: string | null
  activeRoute: 'primary' | 'alternative'; layerVisibility: Record<string, boolean>; layerOpacity: number
  placementMode: PlacementMode; sidebarOpen: boolean; detailsOpen: boolean; routeDirty: boolean
  guided: boolean; playing: boolean; speed: number; reducedMotion: boolean; progress: number
  walkTelemetry: WalkTelemetry | null; minimapOpen: boolean; viewTransitioning: boolean
  walkMapOpen: boolean; setWalkMapOpen: (open: boolean) => void
  announcedWaypointIds: string[]
  announceNearbyWaypoint: (id: string | null) => void
  initialize: () => Promise<void>; calculate: () => Promise<void>; previewStop: (coordinate: Coordinate) => Promise<void>
  commitDraftStop: () => void; cancelPlacement: () => void; updateStop: (id: string, patch: Partial<CustomRouteStop>) => void
  removeStop: (id: string) => void; reorderStop: (id: string, direction: -1 | 1) => void; moveStop: (fromIndex: number, toIndex: number) => void
  toggleScienceStop: (id: string) => void
  applyEnergyLoss: () => Promise<void>; requestEmergencyReturn: (position: Coordinate) => Promise<void>
  setMission: (patch: Partial<MissionConfig>) => void; setHabitat: (habitat: Coordinate) => void; setPlacementMode: (mode: PlacementMode) => void
  setView: (view: ViewMode) => void; setLayerVisibility: (id: string, visible: boolean) => void; setLayerOpacity: (opacity: number) => void
  setActiveRoute: (route: 'primary' | 'alternative') => void; setSelectedWaypoint: (id: string | null) => void; setHoveredWaypoint: (id: string | null) => void
  setSidebarOpen: (open: boolean) => void; setDetailsOpen: (open: boolean) => void
  setMarsWalkState: (patch: Partial<Pick<MissionStore, 'guided' | 'playing' | 'speed' | 'reducedMotion' | 'progress'>>) => void
  setWalkTelemetry: (telemetry: WalkTelemetry) => void; setMinimapOpen: (open: boolean) => void; setViewTransitioning: (active: boolean) => void
  reset: () => Promise<void>
}

let activeRequest = 0
let validationRequest = 0
const sidebarPreference = typeof localStorage === 'undefined' ? null : localStorage.getItem('ares-sidebar')
// On a phone the mission panel covers the map, so it starts closed until asked for.
const sidebarDefault = typeof window === 'undefined' || window.innerWidth >= 768
const minimapPreference = typeof localStorage === 'undefined' ? null : localStorage.getItem('ares-minimap')
const replaceStop = (stops: RouteStop[], id: string, patch: Partial<CustomRouteStop>) => stops.map((stop) => stop.id === id && stop.type === 'custom' ? { ...stop, ...patch } : stop)

const telemetryAt = (bootstrap: Bootstrap, coordinate: Coordinate): WalkTelemetry => {
  const projectedPosition = coordinateToProjected(coordinate)
  return {
    localPosition: projectedToLocal(bootstrap.scene, projectedPosition),
    projectedPosition,
    coordinate,
    headingRad: 0,
    routeIndex: 0,
    progress: 0,
    mode: 'guided',
    updatedAt: 0,
  }
}

export const useMissionStore = create<MissionStore>((set, get) => ({
  bootstrap: null, mission: null, plan: null, emergencyRoute: null, waypointValidation: null, draftStop: null,
  view: 'planner', state: 'idle', error: null, selectedWaypoint: null, hoveredWaypoint: null, activeRoute: 'primary',
  layerVisibility: { imagery: true, slope: false, hazard: true, crism: false, geology: true, traverse: true },
  layerOpacity: 0.55, placementMode: null, sidebarOpen: sidebarPreference ? sidebarPreference === 'open' : sidebarDefault, detailsOpen: false, routeDirty: true,
  guided: true, playing: false, speed: 8, reducedMotion: false, progress: 0,
  walkTelemetry: null, minimapOpen: minimapPreference !== 'closed', viewTransitioning: false,
  walkMapOpen: false,
  setWalkMapOpen: (walkMapOpen) => set({ walkMapOpen, ...(walkMapOpen ? { playing: false } : {}) }),
  announcedWaypointIds: [],
  announceNearbyWaypoint: (id) => set((state) => {
    if (!id || state.announcedWaypointIds.includes(id) || (state.selectedWaypoint && state.selectedWaypoint !== id)) return state
    return { selectedWaypoint: id, announcedWaypointIds: [...state.announcedWaypointIds, id] }
  }),
  initialize: async () => {
    set({ state: 'loading', error: null })
    try {
      const bootstrap = await api.bootstrap()
      set({
        bootstrap,
        mission: structuredClone(bootstrap.default_mission),
        walkMapOpen: false,
        announcedWaypointIds: [], selectedWaypoint: null,
        walkTelemetry: telemetryAt(bootstrap, bootstrap.default_mission.habitat),
        state: 'ready',
      })
      void get().calculate()
    } catch (error) {
      set({ state: 'error', error: error instanceof Error ? error.message : 'Startup failed' })
    }
  },
  calculate: async () => {
    const mission = get().mission
    if (!mission) return
    const requestId = ++activeRequest
    set({ state: 'loading', error: null })
    try {
      const plan = await api.plan(mission)
      if (requestId === activeRequest) {
        set({ plan, emergencyRoute: null, state: 'ready', routeDirty: false, error: plan.warnings[0] ?? null })
      }
    } catch (error) {
      if (requestId === activeRequest) {
        set({ state: 'error', error: error instanceof Error ? error.message : 'Route calculation failed' })
      }
    }
  },
  previewStop: async (coordinate) => {
    const mission = get().mission
    if (!mission) return
    const requestId = ++validationRequest
    const draftStop: CustomRouteStop = {
      type: 'custom',
      id: crypto.randomUUID(),
      name: `Checkpoint ${mission.route_stops.filter((item) => item.type === 'custom').length + 1}`,
      longitude: coordinate.longitude,
      latitude: coordinate.latitude,
      visit_duration_min: 15,
    }
    set({ draftStop, waypointValidation: null })
    try {
      const validation = await api.validateWaypoint(coordinate)
      if (requestId === validationRequest) set({ waypointValidation: validation })
    } catch (error) {
      if (requestId === validationRequest) {
        set({
          waypointValidation: {
            valid: false,
            coordinate,
            terrain: { traversable: false },
            science_context: {},
            warnings: [error instanceof Error ? error.message : 'Validation unavailable'],
          },
        })
      }
    }
  },
  commitDraftStop: () => {
    const { draftStop, waypointValidation, mission } = get()
    if (!draftStop || !waypointValidation?.valid || !mission) return
    set({ mission: { ...mission, route_stops: [...mission.route_stops, draftStop] }, draftStop: null, waypointValidation: null, placementMode: null, routeDirty: true })
    queueMicrotask(() => void get().calculate())
  },
  cancelPlacement: () => set({ placementMode: null, draftStop: null, waypointValidation: null }),
  updateStop: (id, patch) => set((state) => state.mission ? ({ mission: { ...state.mission, route_stops: replaceStop(state.mission.route_stops, id, patch) }, routeDirty: true }) : state),
  removeStop: (id) => set((state) => {
    if (!state.mission || state.mission.route_stops.length <= 1) return state
    const mission = { ...state.mission, route_stops: state.mission.route_stops.filter((stop) => stop.id !== id) }
    queueMicrotask(() => void get().calculate())
    return { mission, routeDirty: true }
  }),
  reorderStop: (id, direction) => set((state) => {
    if (!state.mission) return state
    const route_stops = [...state.mission.route_stops]
    const index = route_stops.findIndex((stop) => stop.id === id); const target = index + direction
    if (index < 0 || target < 0 || target >= route_stops.length) return state
    ;[route_stops[index], route_stops[target]] = [route_stops[target], route_stops[index]]
    queueMicrotask(() => void get().calculate())
    return { mission: { ...state.mission, route_stops }, routeDirty: true }
  }),
  moveStop: (fromIndex, toIndex) => {
    const { mission, calculate } = get()
    if (!mission) return
    const route_stops = [...mission.route_stops]
    if (fromIndex < 0 || fromIndex >= route_stops.length || toIndex < 0 || toIndex >= route_stops.length || fromIndex === toIndex) return
    const [moved] = route_stops.splice(fromIndex, 1)
    route_stops.splice(toIndex, 0, moved)
    set({ mission: { ...mission, route_stops }, routeDirty: true })
    queueMicrotask(() => void calculate())
  },
  toggleScienceStop: (id) => set((state) => {
    if (!state.mission) return state
    const selected = state.mission.route_stops.some((stop) => stop.id === id)
    if (selected && state.mission.route_stops.length === 1) return state
    const route_stops = selected ? state.mission.route_stops.filter((stop) => stop.id !== id) : [...state.mission.route_stops, { type: 'science' as const, id }]
    queueMicrotask(() => void get().calculate())
    return { mission: { ...state.mission, route_stops }, routeDirty: true }
  }),
  applyEnergyLoss: async () => {
    const mission = get().mission
    if (!mission) return
    const requestId = ++activeRequest; set({ state: 'loading', error: null })
    try { const result = await api.energyLoss(mission); if (requestId === activeRequest) set({ mission: result.mission, plan: result.plan, state: 'ready' }) }
    catch (error) { if (requestId === activeRequest) set({ state: 'error', error: error instanceof Error ? error.message : 'Scenario update failed' }) }
  },
  requestEmergencyReturn: async (position) => {
    const { mission, plan } = get(); if (!mission || !plan?.primary) return
    try { const result = await api.emergencyReturn(mission, position, plan.primary.metrics.return_reserve_units); set({ emergencyRoute: result.route }) }
    catch (error) { set({ error: error instanceof Error ? error.message : 'Unable to calculate return path' }) }
  },
  setMission: (patch) => {
    const current = get().mission
    if (!current) return
    set({ mission: { ...current, ...patch }, routeDirty: true })
    queueMicrotask(() => void get().calculate())
  },
  setHabitat: (habitat) => set((state) => state.mission ? ({ mission: { ...state.mission, habitat }, routeDirty: true }) : state),
  setPlacementMode: (placementMode) => set({ placementMode }),
  setView: (view) => set({ view, walkMapOpen: false }),
  setLayerVisibility: (id, visible) => set((state) => ({ layerVisibility: { ...state.layerVisibility, [id]: visible } })),
  setLayerOpacity: (layerOpacity) => set({ layerOpacity }),
  setActiveRoute: (activeRoute) => set({ activeRoute }),
  setSelectedWaypoint: (selectedWaypoint) => set({ selectedWaypoint }),
  setHoveredWaypoint: (hoveredWaypoint) => set({ hoveredWaypoint }),
  setSidebarOpen: (sidebarOpen) => {
    localStorage.setItem('ares-sidebar', sidebarOpen ? 'open' : 'closed')
    set({ sidebarOpen })
  },
  setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
  setMarsWalkState: (patch) => set((state) => ({ ...state, ...patch })),
  setWalkTelemetry: (walkTelemetry) => set({ walkTelemetry }),
  setMinimapOpen: (minimapOpen) => {
    localStorage.setItem('ares-minimap', minimapOpen ? 'open' : 'closed')
    set({ minimapOpen })
  },
  setViewTransitioning: (viewTransitioning) => set({ viewTransitioning }),
  reset: async () => {
    const bootstrap = get().bootstrap
    if (!bootstrap) return
    set({
      mission: structuredClone(bootstrap.default_mission),
      announcedWaypointIds: [], selectedWaypoint: null,
      activeRoute: 'primary',
      emergencyRoute: null,
      progress: 0,
      playing: false,
      walkMapOpen: false,
      walkTelemetry: telemetryAt(bootstrap, bootstrap.default_mission.habitat),
      routeDirty: true,
    })
    await get().calculate()
  },
}))

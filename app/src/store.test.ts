import { beforeEach, describe, expect, it } from 'vitest'
import { useMissionStore } from './store'
import type { MissionConfig, WalkTelemetry } from './types'

const mission: MissionConfig = {
  habitat: { longitude: 77.45, latitude: 18.44 },
  route_stops: [{ type: 'science', id: 'WP-01' }, { type: 'science', id: 'WP-02' }, { type: 'science', id: 'WP-03' }],
  max_duration_min: 720,
  energy_budget: 45000,
  preferred_max_slope_deg: 18,
  return_reserve_pct: 20,
}

describe('mission store', () => {
  beforeEach(() => useMissionStore.setState({ mission: structuredClone(mission), error: null, selectedWaypoint: null, announcedWaypointIds: [], walkMapOpen: false, playing: false, progress: 0 }))

  it('pauses the tour when opening the map and preserves progress when closing it', () => {
    useMissionStore.setState({ playing: true, progress: 0.4 })
    useMissionStore.getState().setWalkMapOpen(true)
    expect(useMissionStore.getState()).toMatchObject({ walkMapOpen: true, playing: false, progress: 0.4 })
    useMissionStore.getState().setWalkMapOpen(false)
    expect(useMissionStore.getState()).toMatchObject({ walkMapOpen: false, playing: false, progress: 0.4 })
  })

  it('clears the walk map when switching to Planner', () => {
    useMissionStore.getState().setWalkMapOpen(true)
    useMissionStore.getState().setView('planner')
    expect(useMissionStore.getState().walkMapOpen).toBe(false)
  })

  it('announces each waypoint once, including after dismissal and returning to it', () => {
    const store = useMissionStore.getState()
    store.announceNearbyWaypoint('WP-01')
    expect(useMissionStore.getState().selectedWaypoint).toBe('WP-01')
    store.setSelectedWaypoint(null)
    store.announceNearbyWaypoint('WP-01')
    store.announceNearbyWaypoint(null)
    store.announceNearbyWaypoint('WP-01')
    expect(useMissionStore.getState().selectedWaypoint).toBeNull()
    store.announceNearbyWaypoint('WP-02')
    expect(useMissionStore.getState().selectedWaypoint).toBe('WP-02')
    expect(useMissionStore.getState().announcedWaypointIds).toEqual(['WP-01', 'WP-02'])
  })

  it('allows manual reopening of dismissed waypoint details', () => {
    const store = useMissionStore.getState()
    store.announceNearbyWaypoint('WP-01')
    store.setSelectedWaypoint(null)
    store.setSelectedWaypoint('WP-01')
    expect(useMissionStore.getState().selectedWaypoint).toBe('WP-01')
    expect(useMissionStore.getState().announcedWaypointIds).toEqual(['WP-01'])
  })

  it('does not replace an open popup or consume another waypoint announcement', () => {
    const store = useMissionStore.getState()
    store.announceNearbyWaypoint('WP-01')
    store.announceNearbyWaypoint('WP-02')
    expect(useMissionStore.getState().selectedWaypoint).toBe('WP-01')
    expect(useMissionStore.getState().announcedWaypointIds).toEqual(['WP-01'])
    store.setSelectedWaypoint(null)
    store.announceNearbyWaypoint('WP-02')
    expect(useMissionStore.getState().selectedWaypoint).toBe('WP-02')
  })

  it('counts details already open manually when arriving as the first announcement', () => {
    const store = useMissionStore.getState()
    store.setSelectedWaypoint('WP-01')
    store.announceNearbyWaypoint('WP-01')
    store.setSelectedWaypoint(null)
    store.announceNearbyWaypoint('WP-01')
    expect(useMissionStore.getState().selectedWaypoint).toBeNull()
  })

  it('updates numeric constraints without losing mission state', () => {
    useMissionStore.getState().setMission({ energy_budget: 36000 })
    expect(useMissionStore.getState().mission?.energy_budget).toBe(36000)
    expect(useMissionStore.getState().mission?.route_stops).toEqual(mission.route_stops)
  })

  it('reorders science waypoints deterministically', () => {
    useMissionStore.getState().reorderStop('WP-02', -1)
    expect(useMissionStore.getState().mission?.route_stops.map((stop) => stop.id)).toEqual(['WP-02', 'WP-01', 'WP-03'])
  })

  it('never removes the final science target', () => {
    useMissionStore.setState({ mission: { ...mission, route_stops: [{ type: 'science', id: 'WP-01' }] } })
    useMissionStore.getState().toggleScienceStop('WP-01')
    expect(useMissionStore.getState().mission?.route_stops).toEqual([{ type: 'science', id: 'WP-01' }])
  })

  it('stores free-walk telemetry independently from guided progress', () => {
    const telemetry: WalkTelemetry = {
      localPosition: [10, 2, 20], projectedPosition: [100, 200], coordinate: { longitude: 77.4, latitude: 18.45 },
      headingRad: 1.2, routeIndex: null, progress: 0.4, mode: 'free', updatedAt: 42,
    }
    useMissionStore.getState().setWalkTelemetry(telemetry)
    expect(useMissionStore.getState().walkTelemetry).toEqual(telemetry)
    expect(useMissionStore.getState().progress).not.toBe(telemetry.progress)
  })
})


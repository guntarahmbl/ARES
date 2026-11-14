import { beforeEach, describe, expect, it } from 'vitest'
import { useMissionStore } from './store'
import type { MissionConfig } from './types'

const mission: MissionConfig = {
  habitat: { longitude: 77.45, latitude: 18.44 },
  route_stops: [{ type: 'science', id: 'WP-01' }, { type: 'science', id: 'WP-02' }, { type: 'science', id: 'WP-03' }],
  max_duration_min: 720,
  energy_budget: 45000,
  preferred_max_slope_deg: 18,
  return_reserve_pct: 20,
}

describe('mission store', () => {
  beforeEach(() => useMissionStore.setState({ mission: structuredClone(mission), error: null }))

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
})


import { describe, expect, it } from 'vitest'
import { nearbyWaypointId } from './waypointProximity'
import { coordinateToProjected, projectedToCoordinate } from './marsProjection'
import type { Coordinate, WaypointFeature } from '../types'

const first: Coordinate = { longitude: 77.45, latitude: 18.44 }
const second: Coordinate = { longitude: 77.46, latitude: 18.45 }
const feature = (id: string, coordinate: Coordinate): WaypointFeature => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [coordinate.longitude, coordinate.latitude] },
  properties: { id, name: id, sol: 1, priority: 1, status: 'planned', science_rationale: '', source: '' },
})
const waypoints = [feature('WP-01', first), feature('WP-02', second)]
const stops = [{ type: 'science' as const, id: 'WP-01' }, { type: 'science' as const, id: 'WP-02' }]

describe('waypoint proximity', () => {
  it('detects either waypoint from position without requiring route progress', () => {
    expect(nearbyWaypointId(first, stops, waypoints)).toBe('WP-01')
    expect(nearbyWaypointId(second, stops, waypoints)).toBe('WP-02')
  })

  it('uses a 20 metre radius on Mars', () => {
    const [x, y] = coordinateToProjected(second)
    expect(nearbyWaypointId(projectedToCoordinate([x + 19, y]), stops, waypoints)).toBe('WP-02')
    expect(nearbyWaypointId(projectedToCoordinate([x + 21, y]), stops, waypoints)).toBeNull()
  })

  it('does not announce science targets excluded from the mission', () => {
    expect(nearbyWaypointId(second, stops.slice(0, 1), waypoints)).toBeNull()
  })

  it('supports custom checkpoints and chooses the nearest stop', () => {
    const checkpoint = { type: 'custom' as const, id: 'custom', name: 'Sample', ...second, visit_duration_min: 5 }
    expect(nearbyWaypointId(second, [...stops, checkpoint], waypoints)).toBe('custom')
  })
})

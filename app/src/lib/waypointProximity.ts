import { coordinateToProjected } from './marsProjection'
import type { Coordinate, RouteStop, WaypointFeature } from '../types'

// Use Mars metres, and check every mission stop independently of guided route progress.
export function nearbyWaypointId(coordinate: Coordinate, stops: RouteStop[], waypoints: WaypointFeature[]): string | null {
  const [x, y] = coordinateToProjected(coordinate)
  let nearest: string | null = null
  let nearestDistance = 20
  for (const stop of stops) {
    const feature = waypoints.find((item) => item.properties.id === stop.id)
    const target = stop.type === 'custom' ? stop : feature && {
      longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1],
    }
    if (!target) continue
    const [targetX, targetY] = coordinateToProjected(target)
    const distance = Math.hypot(x - targetX, y - targetY)
    if (distance <= nearestDistance) {
      nearest = stop.id
      nearestDistance = distance
    }
  }
  return nearest
}

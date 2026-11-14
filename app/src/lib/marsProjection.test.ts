import { describe, expect, it } from 'vitest'
import { coordinateToProjected, localToProjected, projectedToCoordinate, projectedToLocal } from './marsProjection'
import type { SceneManifest } from '../types'

const scene = {
  origin: { x: 4587565.214816285, y: 1094210.9162802328, longitude: 77.395, latitude: 18.46, elevation: -2483.7 },
} as SceneManifest

describe('Mars coordinate transforms', () => {
  it('round-trips geographic and projected coordinates', () => {
    const coordinate = { longitude: 77.405123636, latitude: 18.451193185 }
    const result = projectedToCoordinate(coordinateToProjected(coordinate))
    expect(result.longitude).toBeCloseTo(coordinate.longitude, 7)
    expect(result.latitude).toBeCloseTo(coordinate.latitude, 7)
  })

  it('maps scene south to decreasing projected northing', () => {
    const local: [number, number, number] = [120, 8, 75]
    const projected = localToProjected(scene, local)
    expect(projected).toEqual([scene.origin.x + 120, scene.origin.y - 75])
    expect(projectedToLocal(scene, projected, scene.origin.elevation + 8)).toEqual(local)
  })
})

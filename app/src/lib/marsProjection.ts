import Projection from 'ol/proj/Projection'
import { register } from 'ol/proj/proj4'
import { transform } from 'ol/proj'
import proj4 from 'proj4'
import type { Coordinate, SceneManifest } from '../types'

export const MARS_PROJECTION_CODE = 'MARS:EQC'
export const MARS_PROJECTION_DEFINITION = '+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +R=3396190 +units=m +no_defs'

proj4.defs(MARS_PROJECTION_CODE, MARS_PROJECTION_DEFINITION)
register(proj4)

export function createMarsProjection(extent: number[]) {
  return new Projection({ code: MARS_PROJECTION_CODE, units: 'm', extent })
}

export function coordinateToProjected(coordinate: Coordinate): [number, number] {
  return transform([coordinate.longitude, coordinate.latitude], 'EPSG:4326', MARS_PROJECTION_CODE) as [number, number]
}

export function projectedToCoordinate(projected: number[]): Coordinate {
  const [longitude, latitude] = transform(projected, MARS_PROJECTION_CODE, 'EPSG:4326')
  return { longitude, latitude }
}

export function localToProjected(scene: SceneManifest, local: [number, number, number]): [number, number] {
  return [scene.origin.x + local[0], scene.origin.y - local[2]]
}

export function projectedToLocal(scene: SceneManifest, projected: [number, number], elevation = scene.origin.elevation): [number, number, number] {
  return [projected[0] - scene.origin.x, elevation - scene.origin.elevation, scene.origin.y - projected[1]]
}

import { RoutingEngine } from '../../cloudflare/src/routing.js'
import { coordinate, numeric, requireValue, validateMission } from '../../cloudflare/src/validation.js'

let enginePromise
async function loadEngine(config) {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [metadataResponse, gridResponse] = await Promise.all([fetch(config.metadata_url), fetch(config.grid_url)])
      if (!metadataResponse.ok || !gridResponse.ok) throw new Error('Terrain data could not be downloaded. Please try again.')
      const metadata = await metadataResponse.json()
      const grid = await new Response(gridResponse.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', grid)
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      if (hash !== metadata.grid_sha256) throw new Error('Terrain data failed its integrity check. Please reload the page.')
      return new RoutingEngine(metadata, grid)
    })().catch((error) => { enginePromise = undefined; throw error })
  }
  return enginePromise
}

self.onmessage = async ({ data: { id, config, operation, body } }) => {
  try {
    let result
    if (operation === 'validate') {
      const point = coordinate(body), engine = await loadEngine(config)
      result = engine.validateWaypoint(point.longitude, point.latitude)
    } else {
      const mission = validateMission(operation === 'plan' ? body : body.mission)
      if (operation === 'return') {
        const position = coordinate(body.position)
        requireValue(numeric(body.remaining_energy) && body.remaining_energy > 0, 'Remaining energy must be positive.')
        const engine = await loadEngine(config), route = engine.emergencyRoute(mission, position)
        result = { route, reserve_after_return: body.remaining_energy - route.metrics.energy_units }
      } else if (operation === 'energy-loss') {
        requireValue(numeric(body.loss_pct) && body.loss_pct > 0 && body.loss_pct <= 90, 'Energy loss must be greater than 0 and at most 90 percent.')
        mission.energy_budget *= 1 - body.loss_pct / 100
        const engine = await loadEngine(config), plan = engine.plan(mission)
        result = { mission, plan, status: plan.feasible ? 'replanned' : plan.primary ? 'return_required' : 'infeasible' }
      } else {
        requireValue(operation === 'plan', 'Unknown routing operation.')
        const engine = await loadEngine(config)
        result = engine.plan(mission)
      }
    }
    self.postMessage({ id, result })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Route calculation failed.' })
  }
}

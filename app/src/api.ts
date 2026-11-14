import type { Bootstrap, Coordinate, MissionConfig, RouteCandidate, RoutePlan, WaypointValidation } from './types'
import { browserRouting } from './browserRouting'

let routing: Bootstrap['routing']

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.detail ?? `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export const api = {
  bootstrap: async (signal?: AbortSignal) => {
    const bootstrap = await request<Bootstrap>('/api/v1/bootstrap', { signal })
    routing = bootstrap.routing
    return bootstrap
  },
  plan: (mission: MissionConfig, signal?: AbortSignal) =>
    routing ? browserRouting<RoutePlan>(routing, 'plan', mission, signal) : request<RoutePlan>('/api/v1/routes/plan', { method: 'POST', body: JSON.stringify(mission), signal }),
  validateWaypoint: (coordinate: Coordinate, signal?: AbortSignal) =>
    routing ? browserRouting<WaypointValidation>(routing, 'validate', coordinate, signal) : request<WaypointValidation>('/api/v1/waypoints/validate', { method: 'POST', body: JSON.stringify(coordinate), signal }),
  energyLoss: (mission: MissionConfig, lossPct = 20, signal?: AbortSignal) =>
    routing ? browserRouting<{ mission: MissionConfig; plan: RoutePlan; status: string }>(routing, 'energy-loss', { mission, loss_pct: lossPct }, signal) : request<{ mission: MissionConfig; plan: RoutePlan; status: string }>('/api/v1/scenarios/energy-loss', {
      method: 'POST', body: JSON.stringify({ mission, loss_pct: lossPct }), signal,
    }),
  emergencyReturn: (mission: MissionConfig, position: Coordinate, remainingEnergy: number, signal?: AbortSignal) =>
    routing ? browserRouting<{ route: RouteCandidate; reserve_after_return: number }>(routing, 'return', { mission, position, remaining_energy: remainingEnergy }, signal) : request<{ route: RouteCandidate; reserve_after_return: number }>('/api/v1/routes/return', {
      method: 'POST', body: JSON.stringify({ mission, position, remaining_energy: remainingEnergy }), signal,
    }),
}


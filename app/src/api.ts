import type { AdvisorEvent, AdvisorRequest, Bootstrap, Coordinate, MissionConfig, RouteCandidate, RoutePlan, WaypointValidation } from './types'
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

/** Read the advisor's reply as it is written, one server-sent event at a time. */
async function advisorChat(body: AdvisorRequest, onEvent: (event: AdvisorEvent) => void, signal?: AbortSignal) {
  const response = await fetch('/api/v1/assistant/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(typeof payload.detail === 'string' ? payload.detail : `The advisor is unavailable (${response.status}).`)
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
      if (data) onEvent(JSON.parse(data) as AdvisorEvent)
    }
  }
}

export const api = {
  advisorStatus: (signal?: AbortSignal) =>
    request<{ available: boolean; provider: string | null; model: string | null }>('/api/v1/assistant/status', { signal }),
  advisorChat,
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


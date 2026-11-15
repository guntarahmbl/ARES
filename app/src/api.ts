import type { AdvisorRequest, AdvisorResponse, AdvisorStatus, Bootstrap, Coordinate, MissionConfig, RouteCandidate, RoutePlan, WaypointValidation } from './types'

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
  advisorStatus: (signal?: AbortSignal) =>
    request<AdvisorStatus>('/api/v1/assistant/status', { signal }),
  advisorQuery: (body: AdvisorRequest, signal?: AbortSignal) =>
    request<AdvisorResponse>('/api/v1/assistant/query', { method: 'POST', body: JSON.stringify(body), signal }),
  applyAdvisorProposal: (currentMission: MissionConfig, proposedMission: MissionConfig, basedOnRevision: string, signal?: AbortSignal) =>
    request<{ mission: MissionConfig; plan: RoutePlan; mission_revision: string }>('/api/v1/assistant/proposals/apply', {
      method: 'POST', body: JSON.stringify({ current_mission: currentMission, proposed_mission: proposedMission, based_on_revision: basedOnRevision }), signal,
    }),
  bootstrap: (signal?: AbortSignal) => request<Bootstrap>('/api/v1/bootstrap', { signal }),
  plan: (mission: MissionConfig, signal?: AbortSignal) =>
    request<RoutePlan>('/api/v1/routes/plan', { method: 'POST', body: JSON.stringify(mission), signal }),
  validateWaypoint: (coordinate: Coordinate, signal?: AbortSignal) =>
    request<WaypointValidation>('/api/v1/waypoints/validate', { method: 'POST', body: JSON.stringify(coordinate), signal }),
  energyLoss: (mission: MissionConfig, lossPct = 20, signal?: AbortSignal) =>
    request<{ mission: MissionConfig; plan: RoutePlan; status: string }>('/api/v1/scenarios/energy-loss', {
      method: 'POST', body: JSON.stringify({ mission, loss_pct: lossPct }), signal,
    }),
  emergencyReturn: (mission: MissionConfig, position: Coordinate, remainingEnergy: number, signal?: AbortSignal) =>
    request<{ route: RouteCandidate; reserve_after_return: number }>('/api/v1/routes/return', {
      method: 'POST', body: JSON.stringify({ mission, position, remaining_energy: remainingEnergy }), signal,
    }),
}


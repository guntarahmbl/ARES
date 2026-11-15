import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { missionKey, useAdvisorStore } from './advisorStore'
import { useMissionStore } from './store'
import type { AdvisorResponse, MissionConfig, RoutePlan } from './types'

const mission: MissionConfig = {
  habitat: { longitude: 77.45, latitude: 18.44 },
  route_stops: [{ type: 'science', id: 'WP-01' }, { type: 'science', id: 'WP-02' }],
  max_duration_min: 720,
  energy_budget: 45000,
  preferred_max_slope_deg: 18,
  return_reserve_pct: 20,
}

const plan = {
  feasible: true, primary: null, alternative: null, return_envelope: { type: 'FeatureCollection', features: [] },
  warnings: [], assumptions: [], calculation_ms: 1,
} as RoutePlan

const response = (proposalMission: MissionConfig | null = null): AdvisorResponse => ({
  request_id: 'request-1', intent: proposalMission ? 'configure_mission' : 'explain_route', answer: 'Planner-grounded answer [D-02].',
  citations: [{ dataset_id: 'D-02', title: 'HiRISE DTM', product_id: 'DTM', catalog_url: 'https://example.test', version: '1', resolution_m: 1, classification: 'measured', attribution: 'NASA', license: 'Public domain', processing: 'Derived 5 m routing grid' }],
  evidence: [], warnings: [], model: 'test-model', prompt_version: 'ares-analyst-v1',
  proposal: proposalMission ? {
    summary: 'Change energy budget', changes: ['Energy budget: 45000 → 40000'], mission: proposalMission,
    preview: { feasible: true, warnings: [], route: null }, based_on_revision: 'server-revision',
  } : null,
})

describe('headless analyst store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useMissionStore.setState({ mission: structuredClone(mission), plan, activeRoute: 'primary', selectedWaypoint: 'WP-02', view: 'planner', routeDirty: false })
    useAdvisorStore.setState({ status: 'unknown', statusDetail: null, provider: null, model: null, open: false, busy: false, messages: [] })
  })

  it('passes selected map context without depending on presentation components', async () => {
    const query = vi.spyOn(api, 'advisorQuery').mockResolvedValue(response())
    await useAdvisorStore.getState().send('Explain this location')
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ selected_waypoint_id: 'WP-02', message: 'Explain this location' }), expect.any(AbortSignal))
    expect(useAdvisorStore.getState().messages.at(-1)?.citations?.[0].dataset_id).toBe('D-02')
  })

  it('does not apply a proposal after the mission changes', async () => {
    vi.spyOn(api, 'advisorQuery').mockResolvedValue(response({ ...mission, energy_budget: 40000 }))
    await useAdvisorStore.getState().send('Use less energy')
    useMissionStore.setState({ mission: { ...mission, return_reserve_pct: 30 } })
    const apply = vi.spyOn(api, 'applyAdvisorProposal')
    const id = useAdvisorStore.getState().messages.at(-1)!.id
    await useAdvisorStore.getState().applyProposal(id)
    expect(apply).not.toHaveBeenCalled()
  })

  it('applies only the backend-validated mission and plan', async () => {
    const proposed = { ...mission, energy_budget: 40000 }
    vi.spyOn(api, 'advisorQuery').mockResolvedValue(response(proposed))
    vi.spyOn(api, 'applyAdvisorProposal').mockResolvedValue({ mission: proposed, plan, mission_revision: 'new-revision' })
    await useAdvisorStore.getState().send('Use less energy')
    const reply = useAdvisorStore.getState().messages.at(-1)!
    expect(reply.proposal?.basis).toBe(missionKey(mission))
    await useAdvisorStore.getState().applyProposal(reply.id)
    expect(useMissionStore.getState().mission?.energy_budget).toBe(40000)
    expect(useAdvisorStore.getState().messages.at(-1)?.proposal?.state).toBe('applied')
  })
})

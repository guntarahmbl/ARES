import { create } from 'zustand'
import { api } from './api'
import { useMissionStore } from './store'
import type { AdvisorCitation, AdvisorEvidence, AdvisorIntent, AdvisorProposal, MissionConfig } from './types'

export type AdvisorMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  intent?: AdvisorIntent
  citations?: AdvisorCitation[]
  evidence?: AdvisorEvidence[]
  warnings?: string[]
  notice?: string
  failed?: boolean
  proposal?: AdvisorProposal & {
    state: 'open' | 'applying' | 'applied' | 'dismissed'
    basis: string
  }
}

type AdvisorStore = {
  status: 'unknown' | 'ready' | 'off' | 'absent'
  statusDetail: string | null
  provider: string | null
  model: string | null
  open: boolean
  busy: boolean
  messages: AdvisorMessage[]
  checkStatus: () => Promise<void>
  setOpen: (open: boolean) => void
  send: (text: string) => Promise<void>
  stop: () => void
  applyProposal: (id: string) => Promise<void>
  dismissProposal: (id: string) => void
  clear: () => void
}

let controller: AbortController | null = null

export const missionKey = (mission: MissionConfig | null) => JSON.stringify(mission)

export const useAdvisorStore = create<AdvisorStore>((set, get) => {
  const patch = (id: string, change: (message: AdvisorMessage) => AdvisorMessage) =>
    set((state) => ({ messages: state.messages.map((message) => message.id === id ? change(message) : message) }))

  return {
    status: 'unknown', statusDetail: null, provider: null, model: null, open: false, busy: false, messages: [],
    checkStatus: async () => {
      try {
        const status = await api.advisorStatus()
        set({
          status: status.available ? 'ready' : 'off',
          statusDetail: status.detail,
          provider: status.provider,
          model: status.model,
        })
      } catch {
        set({ status: 'absent', statusDetail: null, open: false })
      }
    },
    setOpen: (open) => set({ open }),
    send: async (text) => {
      const question = text.trim().slice(0, 1000)
      const missionState = useMissionStore.getState()
      const mission = missionState.mission
      if (!question || !mission || get().busy) return

      const replyId = crypto.randomUUID()
      set((state) => ({
        busy: true,
        messages: [
          ...state.messages,
          { id: crypto.randomUUID(), role: 'user', text: question },
          { id: replyId, role: 'assistant', text: '' },
        ],
      }))
      controller = new AbortController()
      try {
        const selectedCoordinate = missionState.view === 'marswalk' ? missionState.walkTelemetry?.coordinate : undefined
        const response = await api.advisorQuery({
          message: question,
          mission,
          active_route: missionState.activeRoute,
          selected_waypoint_id: missionState.selectedWaypoint ?? undefined,
          selected_coordinate: selectedCoordinate,
          mission_revision: missionKey(mission),
        }, controller.signal)
        patch(replyId, (message) => ({
          ...message,
          text: response.answer,
          intent: response.intent,
          citations: response.citations,
          evidence: response.evidence,
          warnings: response.warnings,
          proposal: response.proposal ? { ...response.proposal, state: 'open', basis: missionKey(mission) } : undefined,
        }))
        set({ model: response.model })
      } catch (error) {
        const stopped = error instanceof DOMException && error.name === 'AbortError'
        patch(replyId, (message) => ({
          ...message,
          failed: true,
          notice: stopped ? 'Stopped.' : error instanceof Error ? error.message : 'The analyst could not be reached.',
        }))
      } finally {
        controller = null
        set({ busy: false })
      }
    },
    stop: () => controller?.abort(),
    applyProposal: async (id) => {
      const proposal = get().messages.find((message) => message.id === id)?.proposal
      const missionState = useMissionStore.getState()
      if (!proposal || proposal.state !== 'open' || !missionState.mission || proposal.basis !== missionKey(missionState.mission)) return
      patch(id, (message) => message.proposal ? { ...message, proposal: { ...message.proposal, state: 'applying' } } : message)
      try {
        const result = await api.applyAdvisorProposal(missionState.mission, proposal.mission, proposal.based_on_revision)
        useMissionStore.setState({ mission: result.mission, plan: result.plan, routeDirty: false, state: 'ready', error: null })
        patch(id, (message) => message.proposal ? { ...message, proposal: { ...message.proposal, state: 'applied' } } : message)
      } catch (error) {
        patch(id, (message) => message.proposal ? {
          ...message,
          proposal: { ...message.proposal, state: 'open' },
          notice: error instanceof Error ? error.message : 'The proposal could not be validated.',
        } : message)
      }
    },
    dismissProposal: (id) => patch(id, (message) => message.proposal ? { ...message, proposal: { ...message.proposal, state: 'dismissed' } } : message),
    clear: () => { controller?.abort(); set({ messages: [] }) },
  }
})

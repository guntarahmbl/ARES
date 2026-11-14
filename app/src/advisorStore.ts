import { create } from 'zustand'
import { api } from './api'
import { useMissionStore } from './store'
import type { AdvisorProposal, MissionConfig } from './types'

export type AdvisorMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** Something the planner or provider wants the crew to know about this reply. */
  notice?: string
  failed?: boolean
  proposal?: AdvisorProposal & {
    state: 'open' | 'applied' | 'dismissed'
    /** The mission the proposal was worked out against; applying it over a different plan would discard edits. */
    basis: string
  }
}

type AdvisorStore = {
  /** absent: this deployment has no advisor endpoint. off: the server has one but no provider key. */
  status: 'unknown' | 'ready' | 'off' | 'absent'
  provider: string | null
  model: string | null
  open: boolean
  busy: boolean
  messages: AdvisorMessage[]
  checkStatus: () => Promise<void>
  setOpen: (open: boolean) => void
  send: (text: string) => Promise<void>
  stop: () => void
  applyProposal: (id: string) => void
  dismissProposal: (id: string) => void
  clear: () => void
}

const HISTORY_TURNS = 10
let controller: AbortController | null = null

export const missionKey = (mission: MissionConfig | null) => JSON.stringify(mission)

/** Completed exchanges as the model should remember them, oldest first. */
function history(messages: AdvisorMessage[]) {
  const turns: { role: 'user' | 'assistant'; content: string }[] = []
  for (let index = 0; index + 1 < messages.length; index += 2) {
    const question = messages[index]
    const answer = messages[index + 1]
    if (question.role !== 'user' || answer.role !== 'assistant' || answer.failed) continue
    const outcome = answer.proposal
      ? `\n[You proposed: ${answer.proposal.summary} The crew ${answer.proposal.state === 'applied' ? 'accepted it' : answer.proposal.state === 'dismissed' ? 'dismissed it' : 'has not decided yet'}.]`
      : ''
    const content = `${answer.text}${outcome}`.trim()
    if (!content) continue
    turns.push({ role: 'user', content: question.text }, { role: 'assistant', content: content.slice(0, 4000) })
  }
  return turns.slice(-HISTORY_TURNS * 2)
}

export const useAdvisorStore = create<AdvisorStore>((set, get) => {
  const patch = (id: string, change: (message: AdvisorMessage) => AdvisorMessage) =>
    set((state) => ({ messages: state.messages.map((message) => message.id === id ? change(message) : message) }))

  return {
    status: 'unknown', provider: null, model: null, open: false, busy: false, messages: [],
    checkStatus: async () => {
      try {
        const status = await api.advisorStatus()
        set({ status: status.available ? 'ready' : 'off', provider: status.provider, model: status.model })
      } catch {
        set({ status: 'absent', open: false })
      }
    },
    setOpen: (open) => set({ open }),
    send: async (text) => {
      const question = text.trim().slice(0, 4000)
      const mission = useMissionStore.getState().mission
      if (!question || !mission || get().busy) return
      const replyId = crypto.randomUUID()
      const earlier = history(get().messages)
      set((state) => ({
        busy: true,
        messages: [...state.messages, { id: crypto.randomUUID(), role: 'user', text: question }, { id: replyId, role: 'assistant', text: '' }],
      }))
      controller = new AbortController()
      try {
        await api.advisorChat(
          { mission, messages: [...earlier, { role: 'user', content: question }], active_route: useMissionStore.getState().activeRoute },
          (event) => {
            if (event.type === 'text') patch(replyId, (message) => ({ ...message, text: message.text + event.text }))
            else if (event.type === 'proposal') patch(replyId, (message) => ({ ...message, proposal: { summary: event.summary, mission: event.mission, outcome: event.outcome, state: 'open', basis: missionKey(mission) } }))
            else if (event.type === 'notice') patch(replyId, (message) => ({ ...message, notice: event.message }))
            else if (event.type === 'error') patch(replyId, (message) => ({ ...message, notice: event.message, failed: true }))
          },
          controller.signal,
        )
      } catch (error) {
        const stopped = error instanceof DOMException && error.name === 'AbortError'
        patch(replyId, (message) => ({
          ...message,
          failed: !message.text,
          notice: stopped ? 'Stopped.' : error instanceof Error ? error.message : 'The advisor could not be reached.',
        }))
      } finally {
        controller = null
        set({ busy: false })
      }
    },
    stop: () => controller?.abort(),
    applyProposal: (id) => {
      const proposal = get().messages.find((message) => message.id === id)?.proposal
      const mission = useMissionStore.getState()
      if (!proposal || proposal.state !== 'open' || proposal.basis !== missionKey(mission.mission)) return
      useMissionStore.setState({ mission: proposal.mission, routeDirty: true })
      void mission.calculate()
      patch(id, (message) => message.proposal ? { ...message, proposal: { ...message.proposal, state: 'applied' } } : message)
    },
    dismissProposal: (id) => patch(id, (message) => message.proposal ? { ...message, proposal: { ...message.proposal, state: 'dismissed' } } : message),
    clear: () => { controller?.abort(); set({ messages: [] }) },
  }
})

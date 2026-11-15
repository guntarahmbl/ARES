import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, ExternalLink, Square, X } from 'lucide-react'
import { missionKey, useAdvisorStore, type AdvisorMessage } from '../advisorStore'
import { useMissionStore } from '../store'
import { Button } from './ui/button'

const STARTERS = [
  'Which leg of this route uses the most energy?',
  'Shorten this EVA to under five hours.',
  'Which stop adds the least science for its distance?',
]

const km = (meters: number) => `${(meters / 1000).toFixed(1)} km`
const eu = (units: number) => `${Math.round(units).toLocaleString()} EU`

function Figure({ label, before, after }: { label: string; before?: string; after: string }) {
  return (
    <div className="min-w-0">
      <dt className="label text-ink-3">{label}</dt>
      <dd className="num mt-1 text-[13px] font-bold leading-tight text-ink">{after}</dd>
      {before && before !== after && <dd className="num text-[11px] leading-tight text-ink-3">was {before}</dd>}
    </div>
  )
}

function ProposalCard({ message }: { message: AdvisorMessage }) {
  const proposal = message.proposal!
  const apply = useAdvisorStore((state) => state.applyProposal)
  const dismiss = useAdvisorStore((state) => state.dismissProposal)
  const mission = useMissionStore((state) => state.mission)
  const plan = useMissionStore((state) => state.plan)
  const routeDirty = useMissionStore((state) => state.routeDirty)

  const stale = proposal.state === 'open' && proposal.basis !== missionKey(mission)
  // "Was" figures only make sense against the plan the proposal was built on.
  const current = proposal.state === 'open' && !stale && !routeDirty ? plan?.primary?.metrics : undefined
  const outcome = proposal.preview

  return (
    <div className="mt-3 border border-ink">
      <div className="flex items-baseline justify-between gap-3 border-b border-rule px-3 py-2">
        <span className="label text-ink">Proposed change</span>
        <span className={`wordmark text-[13px] ${outcome.feasible ? 'text-safe' : 'text-danger'}`}>{outcome.feasible ? 'Go' : 'No-go'}</span>
      </div>
      <p className="px-3 pt-2.5 text-[13px] font-semibold leading-snug text-ink">{proposal.summary}</p>
      {proposal.changes.length > 0 && (
        <ul className="space-y-1 px-3 pt-2 text-xs text-ink-2">
          {proposal.changes.map((change) => <li key={change}>• {change}</li>)}
        </ul>
      )}

      {outcome.route ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 px-3 py-3">
          <Figure label="Distance" after={km(outcome.route.distance_m)} before={current && km(current.distance_m)} />
          <Figure label="Duration" after={`${Math.round(outcome.route.duration_min)} min`} before={current && `${Math.round(current.duration_min)} min`} />
          <Figure label="Energy used" after={eu(outcome.route.energy_units)} before={current && eu(current.energy_units)} />
          <Figure label="Science" after={`${outcome.route.science_score}`} before={current && `${current.science_score}`} />
        </dl>
      ) : (
        <p className="px-3 py-3 text-[13px] text-ink-2">The planner found no route for this change.</p>
      )}
      {outcome.warnings.map((warning) => (
        <p className="px-3 pb-2 text-xs text-caution" key={warning}>{warning}</p>
      ))}
      <p className="px-3 pb-3 text-xs text-ink-3">Figures recomputed by the planner.</p>

      <div className="flex items-center gap-2 border-t border-rule p-2">
        {proposal.state === 'open' && !stale && (
          <>
            <Button size="sm" className="flex-1" onClick={() => void apply(message.id)}>Apply to plan</Button>
            <Button size="sm" variant="ghost" onClick={() => dismiss(message.id)}>Dismiss</Button>
          </>
        )}
        {stale && <p className="px-1 py-1 text-xs text-ink-2">The plan has changed since this was suggested. Ask again to get a current proposal.</p>}
        {proposal.state === 'applying' && <p className="px-1 py-1 text-xs text-ink-2">Validating with the planner…</p>}
        {proposal.state === 'applied' && <p className="px-1 py-1 text-xs font-semibold text-safe">Applied to plan</p>}
        {proposal.state === 'dismissed' && <p className="px-1 py-1 text-xs text-ink-3">Dismissed</p>}
      </div>
    </div>
  )
}

function EvidenceList({ message }: { message: AdvisorMessage }) {
  const evidence = (message.evidence ?? []).filter((item) => item.kind !== 'route_model')
  if (!evidence.length && !message.citations?.length) return null
  const valueLabel = (value: unknown) => {
    if (value === null || value === undefined) return 'No data'
    if (typeof value === 'number') return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
    if (typeof value === 'string') return value
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== null && item !== undefined)
      return entries.slice(0, 3).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${String(item)}`).join(' · ')
    }
    return String(value)
  }
  return (
    <div className="mt-3 space-y-2">
      {evidence.slice(0, 6).map((item) => (
        <article className="border border-rule p-2.5" key={item.evidence_id}>
          <div className="flex items-start justify-between gap-2">
            <strong className="text-xs leading-snug text-ink">{item.label}</strong>
            <span className="label shrink-0 text-[9px] text-ink-3">{item.dataset_id}</span>
          </div>
          {item.thumbnail_url && <img className="mt-2 aspect-video w-full object-cover" src={item.thumbnail_url} alt={`${item.label} evidence`} />}
          <p className="num mt-2 break-words text-[11px] text-ink">{valueLabel(item.value)}{item.unit ? ` ${item.unit}` : ''}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-3">
            <span>Coverage: <b className="text-ink-2">{item.coverage.replace('_', ' ')}</b></span>
            <span>Completeness: <b className="text-ink-2">{item.completeness}</b></span>
            <span>Confidence: <b className="text-ink-2">{item.confidence}</b></span>
            <span>Type: <b className="text-ink-2">{item.classification}</b></span>
          </div>
          {item.confidence_reasons[0] && <p className="mt-1.5 text-[11px] leading-snug text-ink-2">{item.confidence_reasons[0]}</p>}
          {item.limitations[0] && <p className="mt-1 text-[10px] leading-snug text-caution">Limit: {item.limitations[0]}</p>}
        </article>
      ))}
      {message.citations && message.citations.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {message.citations.map((citation) => (
            <a
              className="inline-flex min-h-7 items-center gap-1 border border-rule px-2 text-[10px] font-semibold text-route hover:border-ink"
              href={citation.catalog_url}
              target="_blank"
              rel="noreferrer"
              title={citation.title}
              key={citation.dataset_id}
            >
              {citation.dataset_id}<ExternalLink size={10} />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

/** One entry of the exchange, set like an air-to-ground transcript: who spoke, then what was said. */
function Entry({ message, writing }: { message: AdvisorMessage; writing: boolean }) {
  return (
    <li className="border-b border-rule px-4 py-3">
      <span className={`label ${message.role === 'user' ? 'text-ink-3' : 'text-route'}`}>{message.role === 'user' ? 'You' : 'Advisor'}</span>
      {message.text && <p className={`mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed ${message.role === 'user' ? 'text-ink-2' : 'text-ink'}`}>{message.text}</p>}
      {writing && !message.text && <p className="mt-1.5 flex items-center gap-2 text-[13px] text-ink-3"><span className="spinner" /> Reading the plan…</p>}
      {message.role === 'assistant' && <EvidenceList message={message} />}
      {message.proposal && <ProposalCard message={message} />}
      {message.warnings?.map((warning) => <p className="mt-2 text-xs text-caution" key={warning}>{warning}</p>)}
      {message.notice && <p className={`mt-2 text-xs ${message.failed ? 'text-danger' : 'text-ink-3'}`}>{message.notice}</p>}
    </li>
  )
}

export function Advisor() {
  const open = useAdvisorStore((state) => state.open)
  const status = useAdvisorStore((state) => state.status)
  const statusDetail = useAdvisorStore((state) => state.statusDetail)
  const provider = useAdvisorStore((state) => state.provider)
  const model = useAdvisorStore((state) => state.model)
  const messages = useAdvisorStore((state) => state.messages)
  const busy = useAdvisorStore((state) => state.busy)
  const send = useAdvisorStore((state) => state.send)
  const stop = useAdvisorStore((state) => state.stop)
  const clear = useAdvisorStore((state) => state.clear)
  const setOpen = useAdvisorStore((state) => state.setOpen)
  const hasPlan = useMissionStore((state) => Boolean(state.plan))

  const [draft, setDraft] = useState('')
  const log = useRef<HTMLDivElement>(null)

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [messages])

  if (!open || status === 'absent' || status === 'unknown') return null

  const ready = status === 'ready'
  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!draft.trim() || busy) return
    void send(draft)
    setDraft('')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event)
  }

  return (
    <aside aria-label="Route advisor" className="absolute inset-y-0 right-0 z-30 flex w-full flex-col border-ink bg-panel md:w-[360px] md:border-l">
      <div className="flex items-start gap-3 border-b border-ink py-3 pl-4 pr-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold leading-tight text-ink">Mission analyst</h2>
          <p className="mt-0.5 truncate text-[13px] text-ink-2">{ready ? `${provider} · ${model}` : 'Not set up'}</p>
        </div>
        {messages.length > 0 && <Button variant="ghost" size="sm" className="mt-0.5" onClick={clear}>Clear</Button>}
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close route advisor">
          <X size={16} />
        </Button>
      </div>

      {!ready ? (
        <div className="space-y-3 p-4 text-[13px] leading-relaxed text-ink-2">
          <p>The analyst answers from the prepared NASA and USGS evidence, and can suggest planner-validated changes.</p>
          <ol className="list-decimal space-y-1.5 pl-4 marker:text-ink-3">
            <li>Copy <code className="num text-ink">.env.example</code> to <code className="num text-ink">.env</code> in the project folder.</li>
            <li>Start 9Router locally and configure the <code className="num text-ink">ares-mission-analyst</code> combo.</li>
            <li>Set <code className="num text-ink">ARES_LLM_ENABLED=true</code> and restart the server.</li>
          </ol>
          {statusDetail && <p className="border-l-2 border-caution pl-2 text-caution">{statusDetail}</p>}
          <p className="text-ink-3">Planning works the same without it.</p>
        </div>
      ) : (
        <>
          <div ref={log} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
            {messages.length === 0 ? (
              <div className="p-4">
                <p className="text-[13px] leading-relaxed text-ink-2">
                  Ask about the route on the map. The advisor reads the planner's figures for this plan and can suggest changes for you to accept or dismiss.
                </p>
                <h3 className="label mb-1 mt-5 text-ink-3">Try asking</h3>
                <ul>
                  {STARTERS.map((starter) => (
                    <li key={starter} className="border-b border-rule">
                      <button className="w-full py-2.5 text-left text-[13px] font-medium text-ink hover:text-route disabled:text-ink-3" disabled={!hasPlan || busy} onClick={() => void send(starter)}>
                        {starter}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <ol>
                {messages.map((message, index) => (
                  <Entry key={message.id} message={message} writing={busy && index === messages.length - 1} />
                ))}
              </ol>
            )}
          </div>

          <form className="border-t border-ink p-3" onSubmit={submit}>
            <div className="flex items-end gap-2">
              <textarea
                className="max-h-32 min-h-10 flex-1 resize-none rounded border border-ink bg-white px-3 py-2 text-[13px] leading-snug text-ink placeholder:text-ink-3"
                rows={2}
                maxLength={1000}
                value={draft}
                placeholder="Ask about this route"
                aria-label="Message to the route advisor"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
              />
              {busy ? (
                <Button type="button" variant="secondary" size="icon" className="size-10" onClick={stop} aria-label="Stop the reply">
                  <Square size={13} />
                </Button>
              ) : (
                <Button type="submit" size="icon" className="size-10 disabled:ring-1 disabled:ring-inset disabled:ring-rule" disabled={!draft.trim() || !hasPlan} aria-label="Send message">
                  <ArrowUp size={16} />
                </Button>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-ink-3">
              Grounded in the listed evidence. The planner's GO / NO-GO is the check that counts.
            </p>
          </form>
        </>
      )}
    </aside>
  )
}

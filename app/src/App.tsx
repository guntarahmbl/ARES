import { lazy, Suspense, useEffect, useState } from 'react'
import { Footprints, Info, Map, Menu, MessageSquareText, RotateCcw } from 'lucide-react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Advisor } from './components/Advisor'
import { MarsTrackingMap } from './components/MarsTrackingMap'
import { Planner } from './components/Planner'
import { Button } from './components/ui/button'
import { Sheet } from './components/ui/sheet'
import { useAdvisorStore } from './advisorStore'
import { useMissionStore } from './store'
import { useViewTransition } from './hooks/useViewTransition'
import { loadMarsWalk, preloadMarsWalk } from './lib/marsWalkLoader'

const MarsWalk = lazy(loadMarsWalk)

export default function App() {
  const initialize = useMissionStore((state) => state.initialize)
  const reset = useMissionStore((state) => state.reset)
  const view = useMissionStore((state) => state.view)
  const state = useMissionStore((state) => state.state)
  const error = useMissionStore((state) => state.error)
  const bootstrap = useMissionStore((state) => state.bootstrap)
  const plan = useMissionStore((state) => state.plan)
  const setSidebarOpen = useMissionStore((state) => state.setSidebarOpen)
  const [showInfo, setShowInfo] = useState(false)
  const { transitionTo, transitioning } = useViewTransition()

  const advisorStatus = useAdvisorStore((state) => state.status)
  const advisorOpen = useAdvisorStore((state) => state.open)
  const setAdvisorOpen = useAdvisorStore((state) => state.setOpen)
  const checkAdvisor = useAdvisorStore((state) => state.checkStatus)

  useEffect(() => { void initialize() }, [initialize])
  useEffect(() => { void checkAdvisor() }, [checkAdvisor])

  if (!bootstrap && state === 'loading') {
    return (
      <div className="grid h-full place-content-center gap-2 bg-panel text-center">
        <h1 className="wordmark text-xl text-ink">ARES Path</h1>
        <p className="flex items-center justify-center gap-2 text-sm text-ink-2"><span className="spinner" /> Loading Jezero terrain…</p>
      </div>
    )
  }

  if (!bootstrap) {
    return (
      <div className="grid h-full place-content-center gap-3 bg-panel p-6 text-center">
        <h1 className="text-lg font-bold text-ink">Mission data unavailable</h1>
        <p className="max-w-sm text-sm text-danger">{error}</p>
        <Button className="mx-auto" onClick={() => initialize()}>Try again</Button>
      </div>
    )
  }

  const tab = (active: boolean) =>
    `relative flex h-12 items-center gap-1.5 px-3 text-[13px] transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] ${active ? 'font-bold text-ink after:bg-ink' : 'font-medium text-ink-3 hover:text-ink after:bg-transparent'}`
  const iconBtn = 'grid size-8 place-items-center rounded text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink'

  return (
    <ErrorBoundary>
      <div className="relative flex h-full flex-col overflow-hidden bg-ground">
        <header className="relative z-40 flex h-12 shrink-0 items-center gap-2 border-b border-ink bg-panel pl-2 pr-2 md:pl-4 md:pr-3">
          {view === 'planner' && (
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open mission panel">
              <Menu size={18} />
            </Button>
          )}

          <div className="flex min-w-0 items-baseline gap-3">
            <strong className="wordmark shrink-0 text-[15px] text-ink">ARES Path</strong>
            <span className="hidden truncate text-[13px] text-ink-2 sm:block">Jezero Crater, Mars <span className="num hidden text-ink-3 lg:inline">18.4°N 77.5°E</span></span>
          </div>

          <nav className="ml-auto flex items-center" aria-label="Primary view selector">
            <button
              className={tab(view === 'planner')}
              aria-label="Planner"
              disabled={transitioning}
              onClick={() => transitionTo('planner')}
            >
              <Map size={14} />
              <span className="hidden sm:inline">Planner</span>
            </button>
            <button
              className={`${tab(view === 'marswalk')} disabled:opacity-35`}
              aria-label="MarsWalk"
              disabled={!plan?.primary || transitioning}
              onPointerEnter={preloadMarsWalk}
              onFocus={preloadMarsWalk}
              onClick={() => transitionTo('marswalk')}
            >
              <Footprints size={14} />
              <span className="hidden sm:inline">MarsWalk</span>
            </button>
          </nav>

          <span className="mx-1 hidden h-5 w-px bg-rule sm:block" aria-hidden />

          {(advisorStatus === 'ready' || advisorStatus === 'off') && (
            <button
              onClick={() => setAdvisorOpen(!advisorOpen)}
              className={`flex h-8 items-center gap-1.5 rounded px-2 text-[13px] font-medium transition-colors hover:bg-panel-2 hover:text-ink ${advisorOpen ? 'bg-panel-2 text-ink' : 'text-ink-2'}`}
              aria-pressed={advisorOpen}
              aria-label="Route advisor"
              title="Ask about this route"
            >
              <MessageSquareText size={15} />
              <span className="hidden lg:inline">Advisor</span>
            </button>
          )}

          <button onClick={() => setShowInfo(true)} className={iconBtn} title="Data and limitations" aria-label="Data and limitations">
            <Info size={16} />
          </button>
          <button onClick={() => reset()} className={iconBtn} title="Reset mission state" aria-label="Reset mission">
            <RotateCcw size={15} />
          </button>
        </header>

        {error && (
          <div role="alert" className="absolute left-1/2 top-14 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 border border-danger bg-panel py-2 pl-4 pr-2 text-[13px] text-ink">
            <span className="font-medium text-danger">{error}</span>
            <button className="h-7 rounded px-2 font-semibold hover:bg-panel-2" onClick={() => useMissionStore.setState({ error: null })}>Dismiss</button>
          </div>
        )}

        <main className="relative min-h-0 flex-1">
          {view === 'planner' ? (
            <Planner />
          ) : (
            <>
              <Suspense fallback={<div className="grid h-full place-content-center text-sm text-ink-2">Loading MarsWalk terrain…</div>}>
                <MarsWalk />
              </Suspense>
              <MarsTrackingMap />
            </>
          )}
          <Advisor />
        </main>

        <Sheet open={showInfo} onOpenChange={setShowInfo} title="Data sources and limitations">
          <div className="space-y-5 text-[13px] leading-relaxed text-ink-2">
            <p>
              ARES Path combines NASA and USGS observations with derived terrain analysis. Assumed operational values are kept separate from measured data.
            </p>
            <dl className="divide-y divide-rule border-y border-rule">
              {[
                ['Measured', 'MRO HiRISE orthomosaic (25 cm/px) and Perseverance rover imagery (Mastcam-Z, Navcam)'],
                ['Derived', '5 m DTM slope raster, surface roughness matrix, and traversability cost mask'],
                ['Simulated', 'Astronaut walking speeds, suit energy units (EU), and return safety margin']
              ].map(([title, copy]) => (
                <div className="grid grid-cols-[5.5rem_1fr] gap-3 py-2.5" key={title}>
                  <dt className="label pt-0.5 text-ink">{title}</dt>
                  <dd>{copy}</dd>
                </div>
              ))}
            </dl>
            <div>
              <h4 className="label mb-2 text-ink">Known limitations</h4>
              <ul className="list-disc space-y-1.5 pl-4 marker:text-ink-3">
                {bootstrap.limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <p className="text-ink-3">Decision-support prototype built for NASA Space Apps Challenge 2026.</p>
          </div>
        </Sheet>
      </div>
    </ErrorBoundary>
  )
}

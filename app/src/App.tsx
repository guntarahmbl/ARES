import { lazy, Suspense, useEffect, useState } from 'react'
import { Footprints, Info, Map, Menu, RotateCcw } from 'lucide-react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { MarsTrackingMap } from './components/MarsTrackingMap'
import { Planner } from './components/Planner'
import { Button } from './components/ui/button'
import { Sheet } from './components/ui/sheet'
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

  useEffect(() => { void initialize() }, [initialize])

  if (!bootstrap && state === 'loading') {
    return (
      <div className="grid h-full place-content-center gap-2 bg-ground text-center">
        <h1 className="text-lg font-semibold text-ink">ARES Path</h1>
        <p className="text-sm text-ink-3">Loading Jezero terrain…</p>
      </div>
    )
  }

  if (!bootstrap) {
    return (
      <div className="grid h-full place-content-center gap-3 bg-ground p-6 text-center">
        <h1 className="text-lg font-semibold text-ink">Mission data unavailable</h1>
        <p className="max-w-sm text-sm text-danger">{error}</p>
        <Button className="mx-auto" onClick={() => initialize()}>Try again</Button>
      </div>
    )
  }

  const tab = (active: boolean) =>
    `relative flex h-14 items-center gap-1.5 px-3 text-[13px] font-medium transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 ${active ? 'text-ink after:bg-rust' : 'text-ink-3 hover:text-ink after:bg-transparent'}`
  const iconBtn = 'grid size-8 place-items-center rounded text-ink-3 transition-colors hover:bg-panel-2 hover:text-ink'

  return (
    <ErrorBoundary>
      <div className="relative flex h-full flex-col overflow-hidden bg-ground">
        <header className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-rule bg-panel px-3 md:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open mission panel">
            <Menu size={18} />
          </Button>

          <div className="flex min-w-0 items-baseline gap-2.5">
            <strong className="truncate text-[15px] font-bold tracking-tight text-ink">ARES Path</strong>
            <span className="hidden text-[13px] text-ink-3 sm:block">Jezero Crater</span>
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

          <span className="h-5 w-px bg-rule" aria-hidden />

          <button onClick={() => setShowInfo(true)} className={iconBtn} title="Data and limitations" aria-label="Data and limitations">
            <Info size={16} />
          </button>
          <button onClick={() => reset()} className={iconBtn} title="Reset mission state" aria-label="Reset mission">
            <RotateCcw size={15} />
          </button>
        </header>

        {error && (
          <div className="absolute left-1/2 top-16 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded border border-danger/60 bg-panel px-4 py-2.5 text-[13px] text-ink">
            <span className="text-danger">{error}</span>
            <button className="font-medium underline underline-offset-2" onClick={() => useMissionStore.setState({ error: null })}>Dismiss</button>
          </div>
        )}

        <main className="relative min-h-0 flex-1">
          {view === 'planner' ? (
            <Planner />
          ) : (
            <>
              <Suspense fallback={<div className="grid h-full place-content-center text-sm text-ink-3">Loading MarsWalk terrain…</div>}>
                <MarsWalk />
              </Suspense>
              <MarsTrackingMap />
            </>
          )}
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
                  <dt className="font-semibold text-ink">{title}</dt>
                  <dd>{copy}</dd>
                </div>
              ))}
            </dl>
            <div>
              <h4 className="mb-2 font-semibold text-ink">Known limitations</h4>
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

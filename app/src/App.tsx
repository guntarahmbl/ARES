import { lazy, Suspense, useEffect, useState } from 'react'
import { Footprints, Info, Map, Menu, RotateCcw, Satellite } from 'lucide-react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Planner } from './components/Planner'
import { Button } from './components/ui/button'
import { Sheet } from './components/ui/sheet'
import { useMissionStore } from './store'

const MarsWalk = lazy(() => import('./components/MarsWalk'))

export default function App() {
  const initialize = useMissionStore((state) => state.initialize)
  const reset = useMissionStore((state) => state.reset)
  const view = useMissionStore((state) => state.view)
  const setView = useMissionStore((state) => state.setView)
  const state = useMissionStore((state) => state.state)
  const error = useMissionStore((state) => state.error)
  const bootstrap = useMissionStore((state) => state.bootstrap)
  const plan = useMissionStore((state) => state.plan)
  const setSidebarOpen = useMissionStore((state) => state.setSidebarOpen)
  const [showInfo, setShowInfo] = useState(false)

  useEffect(() => { void initialize() }, [initialize])

  if (!bootstrap && state === 'loading') {
    return (
      <div className="grid h-full place-content-center gap-4 bg-[#090b0e] text-center">
        <Satellite className="mx-auto size-12 text-mars animate-pulse" />
        <h1 className="text-xl font-bold tracking-[.25em] text-white">ARES PATH</h1>
        <p className="font-mono text-xs text-slate-300">Aligning Jezero Crater HiRISE & MOLA Telemetry…</p>
      </div>
    )
  }

  if (!bootstrap) {
    return (
      <div className="grid h-full place-content-center gap-4 bg-[#090b0e] text-center p-6">
        <h1 className="text-lg font-semibold text-white">Mission Data Stream Offline</h1>
        <p className="font-mono text-xs text-danger">{error}</p>
        <Button onClick={() => initialize()}>Retry Startup Pipeline</Button>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="relative flex h-full flex-col overflow-hidden bg-[#090b0e]">
        {/* Aerospace Command Header */}
        <header className="relative z-40 flex h-14 shrink-0 items-center gap-2 border-b border-white/10 bg-[#090b0e] px-3 md:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden text-slate-300" onClick={() => setSidebarOpen(true)} aria-label="Open mission panel">
            <Menu size={18} />
          </Button>

          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/20 bg-[#161b22] text-white">
              <Satellite size={17} />
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-xs font-bold tracking-wider text-white">ARES PATH</strong>
              <small className="hidden font-mono text-[10px] text-slate-300 sm:block uppercase">EVA Navigation & Safety · Jezero</small>
            </span>
          </div>

          <nav className="ml-auto flex rounded-lg border border-white/10 bg-[#0d1117] p-0.5" aria-label="Primary view selector">
            <button
              className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${view === 'planner' ? 'bg-[#1e2530] text-white shadow-sm font-semibold' : 'text-slate-300 hover:text-white'}`}
              onClick={() => setView('planner')}
            >
              <Map size={14} />
              <span className="hidden sm:inline">2D Planner</span>
            </button>
            <button
              className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${view === 'marswalk' ? 'bg-[#1e2530] text-white shadow-sm font-semibold' : 'text-slate-300 hover:text-white'} disabled:opacity-30`}
              disabled={!plan?.primary}
              onClick={() => setView('marswalk')}
            >
              <Footprints size={14} />
              <span className="hidden sm:inline">MarsWalk 3D</span>
            </button>
          </nav>

          <button
            onClick={() => setShowInfo(true)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-[#0d1117] px-2.5 text-xs text-slate-300 hover:text-white hover:bg-white/10 transition"
            title="Mission Briefing & Data Specifications"
            aria-label="Mission Briefing & Data Specifications"
          >
            <Info size={14} className="text-sky-400" />
            <span className="hidden md:inline">Mission Specs</span>
          </button>

          <button
            onClick={() => reset()}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-[#0d1117] text-slate-300 hover:text-white hover:bg-white/10 transition"
            title="Reset mission state"
            aria-label="Reset mission state"
          >
            <RotateCcw size={14} />
          </button>
        </header>

        {error && (
          <div className="absolute left-1/2 top-16 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-red-700 bg-[#161b22] px-4 py-2.5 text-xs text-red-300 shadow-xl">
            <span>{error}</span>
            <button className="underline font-semibold ml-2 text-white" onClick={() => useMissionStore.setState({ error: null })}>Dismiss</button>
          </div>
        )}

        <main className="relative min-h-0 flex-1">
          {view === 'planner' ? (
            <Planner />
          ) : (
            <Suspense fallback={<div className="grid h-full place-content-center font-mono text-xs text-slate-300">Streaming 3D Mars DTM Sectors…</div>}>
              <MarsWalk />
            </Suspense>
          )}
        </main>

        <Sheet open={showInfo} onOpenChange={setShowInfo} title="Mission Data Integrity & Telemetry Limitations">
          <div className="space-y-4 text-xs text-slate-300">
            <p className="leading-relaxed">
              ARES Path integrates verified observational datasets from NASA PDS and USGS Astrogeology Science Center to support astronaut exploration safety.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ['Measured', 'MRO HiRISE orthomosaic (25cm/px) and Perseverance rover imagery (Mastcam-Z/Navcam)'],
                ['Derived', '5m DTM slope raster, surface roughness matrix, and traversability cost mask'],
                ['Simulated', 'Astronaut metabolic walking speeds, suit energy units (EU), and return safety margin']
              ].map(([title, copy]) => (
                <article className="rounded-lg border border-white/10 bg-[#161b22] p-2.5 font-mono" key={title}>
                  <strong className="block text-xs uppercase tracking-wide text-mars font-bold">{title}</strong>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{copy}</p>
                </article>
              ))}
            </div>
            <div className="rounded-lg border border-white/10 bg-[#161b22] p-3">
              <h4 className="font-mono uppercase tracking-wider text-white mb-2 font-bold">Scientific & Technical Notes:</h4>
              <ul className="list-disc space-y-1.5 pl-4 font-mono text-[11px] text-slate-300">
                {bootstrap.limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <p className="border-l-2 border-mars pl-2.5 text-[11px] text-slate-400">
              Decision-support prototype engineered for NASA Space Apps Challenge 2026.
            </p>
          </div>
        </Sheet>
      </div>
    </ErrorBoundary>
  )
}

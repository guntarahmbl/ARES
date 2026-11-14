import { useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  Activity, ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight,
  Compass, Layers3, MapPin, Menu, Mountain, Navigation, Plus, ShieldCheck, Trash2, Zap
} from 'lucide-react'
import { useMissionStore } from '../store'
import type { RouteCandidate, RouteStop } from '../types'
import { MarsMap } from './MarsMap'
import { Button } from './ui/button'
import { Sheet } from './ui/sheet'

const formatDistance = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`

function stopName(stop: RouteStop) {
  if (stop.type === 'custom') return stop.name
  const feature = useMissionStore.getState().bootstrap?.waypoints.features.find((item) => item.properties.id === stop.id)
  return feature?.properties.name ?? stop.id
}

function MissionSidebar() {
  const bootstrap = useMissionStore((state) => state.bootstrap)!
  const mission = useMissionStore((state) => state.mission)!
  const state = useMissionStore((state) => state.state)
  const open = useMissionStore((state) => state.sidebarOpen)
  const setOpen = useMissionStore((state) => state.setSidebarOpen)
  const setPlacement = useMissionStore((state) => state.setPlacementMode)
  const toggleScience = useMissionStore((state) => state.toggleScienceStop)
  const reorder = useMissionStore((state) => state.reorderStop)
  const remove = useMissionStore((state) => state.removeStop)
  const setMission = useMissionStore((state) => state.setMission)
  const calculate = useMissionStore((state) => state.calculate)

  if (!open) return (
    <Button variant="secondary" size="icon" className="absolute left-3 top-3 z-20 hidden border border-white/15 bg-[#0d1117]/90 shadow-xl backdrop-blur lg:flex hover:bg-white/10" onClick={() => setOpen(true)} aria-label="Expand mission panel">
      <Menu />
    </Button>
  )

  return (
    <aside className="absolute inset-x-2 bottom-2 z-20 flex max-h-[52svh] flex-col overflow-hidden rounded-xl border border-white/15 bg-[#0d1117]/95 shadow-2xl backdrop-blur sm:bottom-3 sm:left-3 sm:right-auto sm:top-3 sm:max-h-none sm:w-96 lg:w-[380px]">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 bg-white/[0.02]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-mars animate-pulse" />
            <h1 className="text-sm font-semibold tracking-wide uppercase text-white/90">Mission EVA Planning</h1>
          </div>
          <p className="mt-0.5 text-xs text-muted">Jezero crater exploration & safety routing</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Collapse mission panel">
          <ChevronLeft className="hidden lg:block" />
          <span className="lg:hidden text-lg">✕</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* Stops section */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-mono uppercase tracking-wider text-white/70">Route Waypoints</h2>
            <span className="font-mono text-xs text-mars">{mission.route_stops.length} / 12 STOPS</span>
          </div>

          <div className="space-y-2">
            {mission.route_stops.map((stop, index) => (
              <div className="flex min-h-12 items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] p-2 hover:border-white/20 transition" key={stop.id}>
                <span className={`grid size-7 shrink-0 place-items-center rounded border font-mono text-xs font-semibold ${stop.type === 'science' ? 'border-mars/40 bg-mars/15 text-mars' : 'border-route/40 bg-route/15 text-route'}`}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <button className="min-w-0 flex-1 text-left" onClick={() => stop.type === 'science' && useMissionStore.getState().setSelectedWaypoint(stop.id)}>
                  <strong className="block truncate text-xs font-medium text-white/95">{stopName(stop)}</strong>
                  <small className="text-[10px] text-muted font-mono">{stop.type === 'science' ? 'Curated Science Target' : 'Custom Checkpoint'}</small>
                </button>
                <div className="flex items-center">
                  <button className="grid size-7 place-items-center rounded text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-20" disabled={index === 0} onClick={() => reorder(stop.id, -1)} aria-label={`Move ${stop.id} up`}>
                    <ArrowUp size={13} />
                  </button>
                  <button className="grid size-7 place-items-center rounded text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-20" disabled={index === mission.route_stops.length - 1} onClick={() => reorder(stop.id, 1)} aria-label={`Move ${stop.id} down`}>
                    <ArrowDown size={13} />
                  </button>
                  <button className="grid size-7 place-items-center rounded text-muted hover:text-danger hover:bg-danger/10 disabled:opacity-20" disabled={mission.route_stops.length === 1} onClick={() => remove(stop.id)} aria-label={`Remove ${stop.id}`}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <Button variant="secondary" className="mt-2.5 w-full border-dashed border-white/20 text-xs font-medium" disabled={mission.route_stops.length >= 12} onClick={() => setPlacement('stop')}>
            <Plus size={15} /> Add Waypoint on Map
          </Button>
        </section>

        {/* Science Targets accordion */}
        <details className="group rounded-lg border border-white/10 bg-white/[0.02]">
          <summary className="flex min-h-10 cursor-pointer items-center justify-between px-3 text-xs font-medium text-white/80">
            <span>Curated Science Targets</span>
            <ChevronRight size={14} className="transition group-open:rotate-90 text-muted" />
          </summary>
          <div className="space-y-1 border-t border-white/10 p-2">
            {bootstrap.waypoints.features.map((feature) => {
              const selected = mission.route_stops.some((stop) => stop.id === feature.properties.id)
              return (
                <button key={feature.properties.id} className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-white/5 transition" onClick={() => toggleScience(feature.properties.id)}>
                  <span className={`grid size-5 place-items-center rounded border ${selected ? 'border-safe bg-safe/20 text-safe' : 'border-white/20 text-transparent'}`}>
                    {selected && <Check size={12} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xs text-white/90">{feature.properties.name}</strong>
                    <small className="font-mono text-[10px] text-muted">{feature.properties.id} · Sol {feature.properties.sol}</small>
                  </span>
                </button>
              )
            })}
          </div>
        </details>

        {/* Advanced Constraints accordion */}
        <details className="group rounded-lg border border-white/10 bg-white/[0.02]">
          <summary className="flex min-h-10 cursor-pointer items-center justify-between px-3 text-xs font-medium text-white/80">
            <span>Mission Constraints & Envelope</span>
            <ChevronRight size={14} className="transition group-open:rotate-90 text-muted" />
          </summary>
          <div className="space-y-4 border-t border-white/10 p-3">
            {[
              ['Maximum EVA Duration', 'max_duration_min', 240, 1000, 10, `${mission.max_duration_min} min`],
              ['Energy Storage Budget', 'energy_budget', 15000, 70000, 1000, `${mission.energy_budget.toLocaleString()} EU`],
              ['Traversable Slope Limit', 'preferred_max_slope_deg', 8, 25, 1, `${mission.preferred_max_slope_deg}°`],
              ['Abort Safety Reserve', 'return_reserve_pct', 10, 50, 5, `${mission.return_reserve_pct}%`],
            ].map(([label, key, min, max, step, value]) => (
              <label className="block text-xs" key={String(key)}>
                <span className="mb-1.5 flex justify-between">
                  <span className="text-white/70">{label}</span>
                  <output className="font-mono text-mars font-medium">{value}</output>
                </span>
                <input
                  className="h-1.5 w-full accent-mars"
                  type="range"
                  min={Number(min)}
                  max={Number(max)}
                  step={Number(step)}
                  value={Number(mission[key as keyof typeof mission])}
                  onChange={(event) => setMission({ [key]: Number(event.target.value) })}
                />
              </label>
            ))}
          </div>
        </details>
      </div>

      <div className="border-t border-white/10 p-3 bg-white/[0.02]">
        <Button className="w-full text-xs font-semibold uppercase tracking-wider" disabled={state === 'loading'} onClick={() => calculate()}>
          {state === 'loading' ? <span className="spinner" /> : <Navigation size={15} />}
          {state === 'loading' ? 'Computing Optimal A* Trajectory…' : 'Compute Mission Route'}
        </Button>
      </div>
    </aside>
  )
}

function LayerControl() {
  const [open, setOpen] = useState(false)
  const bootstrap = useMissionStore((state) => state.bootstrap)!
  const visibility = useMissionStore((state) => state.layerVisibility)
  const setVisibility = useMissionStore((state) => state.setLayerVisibility)
  const opacity = useMissionStore((state) => state.layerOpacity)
  const setOpacity = useMissionStore((state) => state.setLayerOpacity)
  const layers = [
    ...bootstrap.layers,
    { id: 'geology', label: 'USGS Jezero Geologic Units', kind: 'interpreted' },
    { id: 'traverse', label: 'Perseverance Rover Traverse', kind: 'measured' }
  ]

  return (
    <div className="absolute right-3 top-3 z-20">
      <Button variant="secondary" size="icon" className="border border-white/15 bg-[#0d1117]/90 shadow-xl backdrop-blur hover:bg-white/10" onClick={() => setOpen(!open)} aria-label="Map layers">
        <Layers3 />
      </Button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-white/15 bg-[#0d1117]/95 p-3.5 shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2">
            <h2 className="text-xs font-mono uppercase tracking-wider text-white/80">Orbital Data Layers</h2>
            <span className="text-[10px] text-muted">NASA PDS</span>
          </div>
          {layers.map((layer) => (
            <label className="flex min-h-9 items-center gap-2.5 text-xs text-white/85 hover:text-white cursor-pointer" key={layer.id}>
              <input className="size-3.5 accent-mars" type="checkbox" checked={visibility[layer.id] ?? false} onChange={(event) => setVisibility(layer.id, event.target.checked)} />
              <span className="flex-1 truncate">{layer.label}</span>
              <small className="font-mono text-[10px] text-muted uppercase">{layer.kind}</small>
            </label>
          ))}
          <label className="mt-2.5 block border-t border-white/10 pt-2.5 text-xs">
            <span className="mb-1.5 flex justify-between">
              <span className="text-muted">Overlay Opacity</span>
              <output className="font-mono text-mars">{Math.round(opacity * 100)}%</output>
            </span>
            <input className="w-full accent-mars" type="range" min="0.15" max="0.9" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
          </label>
        </div>
      )}
    </div>
  )
}

function RouteSummary() {
  const plan = useMissionStore((state) => state.plan)
  const active = useMissionStore((state) => state.activeRoute)
  const setActive = useMissionStore((state) => state.setActiveRoute)
  const setDetails = useMissionStore((state) => state.setDetailsOpen)
  const setView = useMissionStore((state) => state.setView)
  if (!plan?.primary) return null
  const route = active === 'alternative' ? plan.alternative ?? plan.primary : plan.primary

  return (
    <section className="absolute bottom-[calc(52svh+0.75rem)] left-2 right-2 z-10 rounded-xl border border-white/15 bg-[#0d1117]/95 p-3 shadow-2xl backdrop-blur sm:bottom-3 sm:left-[420px] sm:right-3 lg:left-[405px]">
      <div className="flex items-center gap-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg border ${plan.feasible ? 'border-safe/40 bg-safe/15 text-safe' : 'border-caution/40 bg-caution/15 text-caution'}`}>
          <ShieldCheck size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block text-xs font-semibold text-white/95">
            {plan.feasible ? 'Route Confirmed: Return-Safe' : 'Review Constraints: Exceeds Safe Envelope'}
          </strong>
          <p className="truncate font-mono text-[11px] text-white/60">
            {formatDistance(route.metrics.distance_m)} · {Math.round(route.metrics.duration_min)} min · {Math.round(route.metrics.energy_units).toLocaleString()} EU · Max slope {route.metrics.maximum_slope_deg}°
          </p>
        </div>
        <Button variant="ghost" size="sm" className="hidden sm:flex text-xs" onClick={() => setActive(active === 'primary' ? 'alternative' : 'primary')}>
          {active === 'primary' ? 'Alt Route' : 'Primary'}
        </Button>
        <Button variant="secondary" size="sm" className="text-xs" onClick={() => setDetails(true)}>
          Telemetry
        </Button>
        <Button size="sm" className="hidden md:flex text-xs font-semibold uppercase tracking-wider" onClick={() => setView('marswalk')}>
          Explore 3D
        </Button>
      </div>
    </section>
  )
}

function RouteDetails() {
  const open = useMissionStore((state) => state.detailsOpen)
  const setOpen = useMissionStore((state) => state.setDetailsOpen)
  const plan = useMissionStore((state) => state.plan)
  const active = useMissionStore((state) => state.activeRoute)
  const applyEnergyLoss = useMissionStore((state) => state.applyEnergyLoss)
  const route: RouteCandidate | null | undefined = active === 'alternative' ? plan?.alternative : plan?.primary

  return (
    <Sheet open={open} onOpenChange={setOpen} title="Mission Telemetry & Profile" side="right">
      {route && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Distance', formatDistance(route.metrics.distance_m)],
              ['Max Slope', `${route.metrics.maximum_slope_deg}°`],
              ['Energy Consumed', `${Math.round(route.metrics.energy_units).toLocaleString()} EU`],
              ['Return Reserve', `${Math.round(route.metrics.return_reserve_units).toLocaleString()} EU`],
              ['Elevation Gain', `+${route.metrics.elevation_gain_m} m`],
              ['Science Score', `${route.metrics.science_score} / 100`],
            ].map(([label, value]) => (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 font-mono" key={label}>
                <small className="block text-[10px] uppercase text-muted tracking-wider">{label}</small>
                <strong className="mt-1 block text-sm text-white/95">{value}</strong>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
            <h4 className="mb-2 text-[11px] font-mono uppercase tracking-wider text-white/70">Topographic Elevation Profile (HiRISE DTM)</h4>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={route.elevation_profile}>
                  <XAxis dataKey="distance_m" hide />
                  <YAxis width={42} tick={{ fill: '#8b949e', fontSize: 10, fontFamily: 'monospace' }} domain={['dataMin - 5', 'dataMax + 5']} />
                  <Tooltip
                    contentStyle={{ background: '#0d1117', borderColor: '#30363d', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                  />
                  <Area type="monotone" dataKey="elevation_m" stroke="#e18a55" fill="#e18a5522" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-mono font-semibold tracking-wider uppercase text-mars">
              <Activity size={14} /> Route Decision & Terrain Telemetry
            </h3>
            <div className="space-y-1.5">
              {route.explanation.map((line) => (
                <p className="text-xs leading-relaxed text-white/75" key={line}>{line}</p>
              ))}
            </div>
          </div>

          <Button variant="secondary" className="w-full text-xs" onClick={() => applyEnergyLoss()}>
            <Zap size={14} className="text-caution" /> Simulate Contingency: -20% Energy
          </Button>
        </div>
      )}
    </Sheet>
  )
}

function DraftStopSheet() {
  const draft = useMissionStore((state) => state.draftStop)
  const validation = useMissionStore((state) => state.waypointValidation)
  const commit = useMissionStore((state) => state.commitDraftStop)
  const cancel = useMissionStore((state) => state.cancelPlacement)

  return (
    <Sheet open={Boolean(draft)} onOpenChange={(open) => !open && cancel()} title="Add Custom Checkpoint" side="bottom">
      {draft && (
        <div className="mx-auto max-w-xl space-y-4">
          <label className="block text-xs font-medium text-white/80">
            Checkpoint Label
            <input
              className="mt-1.5 min-h-10 w-full rounded-lg border border-white/15 bg-background px-3 text-xs font-mono"
              value={draft.name}
              placeholder="e.g. Delta Base North Checkpoint"
              onChange={(event) => useMissionStore.setState({ draftStop: { ...draft, name: event.target.value } })}
            />
          </label>
          {!validation ? (
            <div className="flex items-center gap-2 text-xs text-muted font-mono">
              <span className="spinner" /> Analyzing local terrain traversability…
            </div>
          ) : (
            <div className={`rounded-lg border p-3 text-xs ${validation.valid ? 'border-safe/40 bg-safe/10' : 'border-danger/40 bg-danger/10'}`}>
              <strong className="block font-semibold">{validation.valid ? 'Traversable Location Verified' : 'Hazardous Location Detected'}</strong>
              <p className="mt-1 font-mono text-[11px] text-white/70">
                Elev: {validation.terrain.elevation_m?.toFixed(1)} m · Slope: {validation.terrain.slope_deg?.toFixed(1)}° · Geology: {validation.science_context.geology_symbol ?? 'Nili Planum'}
              </p>
              {validation.warnings.map((warning) => (
                <p className="mt-1.5 text-[11px] text-caution" key={warning}>{warning}</p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
            <Button size="sm" disabled={!validation?.valid || !draft.name.trim()} onClick={commit}>
              Add to Route
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

export function Planner() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#5a3021]">
      <MarsMap />
      <MissionSidebar />
      <LayerControl />
      <RouteSummary />
      <RouteDetails />
      <DraftStopSheet />
      <div className="pointer-events-none absolute bottom-3 right-3 hidden rounded-lg border border-white/10 bg-[#0d1117]/80 px-3 py-1.5 text-[11px] font-mono text-white/75 backdrop-blur md:block">
        <span className="mr-2 inline-block size-2 rounded-full bg-route" />
        Jezero Delta Western Traverse · MRO HiRISE DTM
      </div>
    </div>
  )
}

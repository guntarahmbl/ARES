import { useEffect, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  Activity, ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight,
  Compass, GripVertical, Layers3, MapPin, Menu, Mountain, Navigation, Plus, ShieldCheck, Target, Trash2, X, Zap
} from 'lucide-react'
import { useMissionStore } from '../store'
import type { RouteCandidate, RouteStop } from '../types'
import { MarsMap } from './MarsMap'
import { Button } from './ui/button'
import { Sheet } from './ui/sheet'

const formatDistance = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`

function stopName(stop: RouteStop) {
  if (stop.type === 'custom') return stop.name
  const feature = useMissionStore.getState().bootstrap?.waypoints.features.find((item) => item.properties.id === stop.id)
  return feature?.properties.name ?? stop.id
}

function PlacementBanner() {
  const mode = useMissionStore((state) => state.placementMode)
  const cancel = useMissionStore((state) => state.cancelPlacement)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && mode) cancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, cancel])

  if (!mode) return null

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-lg border border-route bg-[#0d1117] px-4 py-2 text-xs shadow-2xl">
      <span className="flex items-center gap-1.5 font-medium text-route">
        <MapPin size={15} className="animate-bounce" />
        {mode === 'habitat'
          ? 'Click inside the dashed zone to move the habitat'
          : 'Click the map to place a checkpoint'}
      </span>
      <button className="rounded bg-white/10 px-2 py-0.5 text-white hover:bg-white/20 font-mono text-[11px]" onClick={cancel}>
        Cancel (Esc)
      </button>
    </div>
  )
}

function WaypointInspector2D() {
  const selectedId = useMissionStore((state) => state.selectedWaypoint)
  const hoveredId = useMissionStore((state) => state.hoveredWaypoint)
  const setSelected = useMissionStore((state) => state.setSelectedWaypoint)
  const setHovered = useMissionStore((state) => state.setHoveredWaypoint)
  const bootstrap = useMissionStore((state) => state.bootstrap)
  const mission = useMissionStore((state) => state.mission)
  const toggleScience = useMissionStore((state) => state.toggleScienceStop)

  const id = selectedId ?? hoveredId
  const isPinned = Boolean(selectedId)

  if (!id || !bootstrap) return null
  const waypoint = bootstrap.waypoints.features.find((f) => f.properties.id === id)
  if (!waypoint) return null
  const images = bootstrap.surface_images.filter((img) => img.waypoint_id === id)
  const evidence = bootstrap.science_evidence[id]
  const isSelected = mission?.route_stops.some((s) => s.id === id)

  return (
    <aside
      className="absolute right-3 top-14 z-20 w-80 max-h-[80svh] overflow-y-auto rounded-xl border border-white/20 bg-[#0d1117]/95 backdrop-blur p-4 shadow-2xl transition-all"
      onMouseEnter={() => setHovered(id)}
      onMouseLeave={() => setHovered(null)}
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-sky-400">
          <Target size={13} /> Target · Sol {waypoint.properties.sol}
        </span>
        <button
          className="grid size-6 place-items-center rounded text-slate-400 hover:bg-white/10 hover:text-white"
          onClick={() => { setSelected(null); setHovered(null) }}
          aria-label="Close inspector"
        >
          <X size={14} />
        </button>
      </div>

      <h3 className="mt-2.5 text-sm font-semibold text-white">{waypoint.properties.name}</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-300">{waypoint.properties.science_rationale}</p>

      {images[0] && (
        <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
          <img className="aspect-video w-full object-cover" src={`/assets/thumbnails/surface/${images[0].product_id}.jpg`} alt={waypoint.properties.name} />
          <div className="bg-[#12161f] px-2 py-1 text-[10px] font-mono text-slate-300">
            Perseverance Mastcam-Z / Navcam Observation
          </div>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-1.5 font-mono text-xs">
        <div className="rounded border border-white/10 bg-[#161b22] p-1.5">
          <dt className="text-[10px] text-slate-400">Priority</dt>
          <dd className="font-semibold text-sky-400">{waypoint.properties.priority}/3</dd>
        </div>
        <div className="rounded border border-white/10 bg-[#161b22] p-1.5">
          <dt className="text-[10px] text-slate-400">Geology</dt>
          <dd className="font-semibold text-white">{evidence?.geology_symbol ?? 'Nili'}</dd>
        </div>
        <div className="rounded border border-white/10 bg-[#161b22] p-1.5">
          <dt className="text-[10px] text-slate-400">OLINDEX3</dt>
          <dd className="font-semibold text-white">{evidence?.crism.olindex3?.toFixed(3) ?? 'nodata'}</dd>
        </div>
      </dl>

      <div className="mt-3.5 flex gap-2">
        <Button
          variant={isSelected ? 'secondary' : 'default'}
          size="sm"
          className="w-full text-xs font-semibold"
          onClick={() => toggleScience(id)}
        >
          {isSelected ? '✓ Added to route' : '+ Add to route'}
        </Button>
      </div>
    </aside>
  )
}

function MissionSidebar() {
  const bootstrap = useMissionStore((state) => state.bootstrap)!
  const mission = useMissionStore((state) => state.mission)!
  const state = useMissionStore((state) => state.state)
  const open = useMissionStore((state) => state.sidebarOpen)
  const setOpen = useMissionStore((state) => state.setSidebarOpen)
  const setPlacement = useMissionStore((state) => state.setPlacementMode)
  const toggleScience = useMissionStore((state) => state.toggleScienceStop)
  const remove = useMissionStore((state) => state.removeStop)
  const moveStop = useMissionStore((state) => state.moveStop)
  const setMission = useMissionStore((state) => state.setMission)
  const calculate = useMissionStore((state) => state.calculate)
  const plan = useMissionStore((state) => state.plan)
  const routeDirty = useMissionStore((state) => state.routeDirty)

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  if (!open) return (
    <Button variant="secondary" size="icon" className="absolute left-3 top-3 z-20 hidden border border-white/20 bg-[#0d1117] shadow-xl lg:flex hover:bg-white/10" onClick={() => setOpen(true)} aria-label="Expand mission panel">
      <Menu />
    </Button>
  )

  return (
    <aside className="absolute inset-x-2 bottom-2 z-20 flex max-h-[52svh] flex-col overflow-hidden rounded-xl border border-white/20 bg-[#0d1117] shadow-2xl sm:bottom-3 sm:left-3 sm:right-auto sm:top-3 sm:max-h-none sm:w-96 lg:w-[380px]">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 bg-[#12161f]">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-white">Plan an EVA</h1>
          <p className="mt-0.5 text-xs text-slate-300">Choose stops and check a safe return route</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Collapse mission panel">
          <ChevronLeft className="hidden lg:block text-slate-300" />
          <span className="lg:hidden text-lg text-slate-300">✕</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* Stops section */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-medium text-slate-300">Route stops</h2>
            <span className="text-xs font-semibold text-sky-400">{mission.route_stops.length} stops · round trip</span>
          </div>

          <div className="space-y-1.5">
            {/* Departure Origin */}
            <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-[#161b22] p-2 text-xs">
              <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#21262d] text-white border border-white/20">
                DEP
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <strong className="text-white text-xs">Habitat</strong>
                  <button
                    className="text-[10px] font-mono text-sky-400 hover:text-sky-200 underline"
                    onClick={() => useMissionStore.getState().setPlacementMode('habitat')}
                    title="Relocate Habitat Base within approved 250 m zone"
                  >
                    Relocate
                  </button>
                </div>
                <span className="text-[11px] text-slate-300">Starting point</span>
              </div>
            </div>

            {/* Draggable Checkpoints List */}
            {mission.route_stops.map((stop, index) => (
              <div
                key={stop.id}
                draggable
                onMouseEnter={() => stop.type === 'science' && useMissionStore.getState().setHoveredWaypoint(stop.id)}
                onMouseLeave={() => stop.type === 'science' && useMissionStore.getState().setHoveredWaypoint(null)}
                onDragStart={() => setDraggedIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (draggedIndex !== null && draggedIndex !== index) {
                    moveStop(draggedIndex, index)
                  }
                  setDraggedIndex(null)
                }}
                className={`flex min-h-11 items-center gap-2.5 rounded-lg border bg-[#161b22] px-2.5 py-1.5 transition cursor-grab active:cursor-grabbing ${draggedIndex === index ? 'opacity-40 border-sky-400 border-dashed' : 'border-white/10 hover:border-white/20'}`}
              >
                <div className="grid place-items-center text-slate-400 hover:text-white" title="Drag to reorder waypoint">
                  <GripVertical size={14} />
                </div>
                <span className="font-mono text-xs font-bold text-slate-200">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <button className="min-w-0 flex-1 text-left" onClick={() => stop.type === 'science' && useMissionStore.getState().setSelectedWaypoint(stop.id)}>
                  <strong className="block truncate text-xs font-medium text-white">{stopName(stop)}</strong>
                  <span className="text-[10px] text-slate-300 font-mono">{stop.type === 'science' ? 'Science Target' : 'Checkpoint'}</span>
                </button>
                <button className="grid size-7 place-items-center rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 disabled:opacity-20" disabled={mission.route_stops.length === 1} onClick={() => remove(stop.id)} aria-label={`Remove ${stop.id}`}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}

            {/* Return Destination */}
            <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-[#161b22] p-2 text-xs">
              <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#21262d] text-white border border-white/20">
                RET
              </span>
              <div className="min-w-0 flex-1">
                <strong className="block text-white text-xs">Return to habitat</strong>
                <span className="text-[11px] text-slate-300">Route ends at the starting point</span>
              </div>
            </div>
          </div>

          <Button
            variant="secondary"
            className="mt-2.5 w-full border border-white/20 text-xs font-medium"
            disabled={mission.route_stops.length >= 12}
            onClick={() => {
              setPlacement('stop')
              if (window.innerWidth < 1024) setOpen(false)
            }}
          >
            <Plus size={15} /> Add stop on map
          </Button>
        </section>

        {/* Science Targets accordion */}
        <details className="group rounded-lg border border-white/10 bg-[#161b22]">
          <summary className="flex min-h-10 cursor-pointer items-center justify-between px-3 text-xs font-medium text-slate-200">
            <span>Science targets</span>
            <ChevronRight size={14} className="transition group-open:rotate-90 text-slate-400" />
          </summary>
          <div className="space-y-1 border-t border-white/10 p-2">
            {bootstrap.waypoints.features.map((feature) => {
              const selected = mission.route_stops.some((stop) => stop.id === feature.properties.id)
              return (
                <button
                  key={feature.properties.id}
                  className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-white/5 transition"
                  onMouseEnter={() => useMissionStore.getState().setHoveredWaypoint(feature.properties.id)}
                  onMouseLeave={() => useMissionStore.getState().setHoveredWaypoint(null)}
                  onClick={() => toggleScience(feature.properties.id)}
                >
                  <span className={`grid size-5 place-items-center rounded border ${selected ? 'border-white/40 bg-[#1f6feb] text-white' : 'border-white/20 bg-[#161b22] text-transparent'}`}>
                    {selected && <Check size={12} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xs text-white">{feature.properties.name}</strong>
                    <small className="font-mono text-[10px] text-slate-400">{feature.properties.id} · Sol {feature.properties.sol}</small>
                  </span>
                </button>
              )
            })}
          </div>
        </details>

        {/* Advanced Constraints accordion */}
        <details className="group rounded-lg border border-white/10 bg-[#161b22]">
          <summary className="flex min-h-10 cursor-pointer items-center justify-between px-3 text-xs font-medium text-slate-200">
            <span>Route settings</span>
            <ChevronRight size={14} className="transition group-open:rotate-90 text-slate-400" />
          </summary>
          <div className="space-y-4 border-t border-white/10 p-3">
            {[
              ['Maximum duration', 'max_duration_min', 240, 1000, 10, `${mission.max_duration_min} min`],
              ['Energy budget', 'energy_budget', 15000, 70000, 1000, `${mission.energy_budget.toLocaleString()} EU`],
              ['Preferred maximum slope', 'preferred_max_slope_deg', 8, 25, 1, `${mission.preferred_max_slope_deg}°`],
              ['Return reserve', 'return_reserve_pct', 10, 50, 5, `${mission.return_reserve_pct}%`],
            ].map(([label, key, min, max, step, value]) => (
              <label className="block text-xs" key={String(key)}>
                <span className="mb-1.5 flex justify-between">
                  <span className="text-slate-300">{label}</span>
                  <output className="font-mono text-mars font-semibold">{value}</output>
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

      <div className="border-t border-white/10 p-3 bg-[#0d1117]">
        <button
          data-testid="route-action"
          className="w-full h-11 flex items-center justify-center gap-2 rounded-lg bg-[#1f6feb] hover:bg-[#388bfd] text-white text-sm font-semibold border border-[#58a6ff]/40 shadow-lg active:scale-[0.98] transition disabled:opacity-60 disabled:pointer-events-none"
          disabled={state === 'loading' || (Boolean(plan) && !routeDirty)}
          onClick={() => calculate()}
        >
          {state === 'loading' ? <span className="spinner" /> : <Navigation size={14} />}
          {state === 'loading' ? 'Updating route…' : routeDirty ? (plan ? 'Update route' : 'Plan route') : 'Route up to date'}
        </button>
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
      <Button variant="secondary" size="icon" className="border border-white/20 bg-[#0d1117] shadow-xl hover:bg-white/10" onClick={() => setOpen(!open)} aria-label="Map layers">
        <Layers3 />
      </Button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-white/20 bg-[#0d1117] p-3.5 shadow-2xl">
          <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2">
            <h2 className="text-sm font-semibold text-slate-200">Map layers</h2>
            <span className="text-[10px] text-slate-400">NASA PDS</span>
          </div>
          {layers.map((layer) => (
            <label className="flex min-h-9 items-center gap-2.5 text-xs text-slate-200 hover:text-white cursor-pointer" key={layer.id}>
              <input className="size-3.5 accent-mars" type="checkbox" checked={visibility[layer.id] ?? false} onChange={(event) => setVisibility(layer.id, event.target.checked)} />
              <span className="flex-1 truncate">{layer.label}</span>
              <small className="font-mono text-[10px] text-slate-400 uppercase">{layer.kind}</small>
            </label>
          ))}
          <label className="mt-2.5 block border-t border-white/10 pt-2.5 text-xs">
            <span className="mb-1.5 flex justify-between">
              <span className="text-slate-300">Overlay Opacity</span>
              <output className="font-mono text-mars font-bold">{Math.round(opacity * 100)}%</output>
            </span>
            <input className="w-full accent-mars" type="range" min="0.15" max="0.9" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
          </label>

          {(visibility.slope || visibility.hazard || visibility.crism) && (
            <div className="mt-3 border-t border-white/10 pt-2.5 space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block font-semibold">Active Layer Color Scale</span>
              {visibility.slope && (
                <div>
                  <span className="text-slate-300 block mb-1 font-semibold text-[10px]">Slope Incline:</span>
                  <div className="flex items-center gap-1.5 font-mono text-[10px]">
                    <span className="text-emerald-400 font-bold">0°</span>
                    <div className="h-1.5 flex-1 rounded bg-gradient-to-r from-emerald-500 via-yellow-400 to-rose-600" />
                    <span className="text-rose-400 font-bold">25°+</span>
                  </div>
                </div>
              )}
              {visibility.hazard && (
                <div>
                  <span className="text-slate-300 block mb-1 font-semibold text-[10px]">Traversability:</span>
                  <div className="flex items-center gap-1.5 font-mono text-[10px]">
                    <span className="text-emerald-400">Regolith</span>
                    <div className="h-1.5 flex-1 rounded bg-gradient-to-r from-emerald-500 via-amber-500 to-red-600" />
                    <span className="text-rose-400">Rocky</span>
                  </div>
                </div>
              )}
              {visibility.crism && (
                <div>
                  <span className="text-slate-300 block mb-1 font-semibold text-[10px]">CRISM OLINDEX3:</span>
                  <div className="flex items-center gap-1.5 font-mono text-[10px]">
                    <span className="text-slate-400">Low</span>
                    <div className="h-1.5 flex-1 rounded bg-gradient-to-r from-blue-900 via-cyan-400 to-amber-400" />
                    <span className="text-mars font-bold">Clay/Olivine</span>
                  </div>
                </div>
              )}
            </div>
          )}
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
  const sidebarOpen = useMissionStore((state) => state.sidebarOpen)
  if (!plan?.primary) return null
  const route = active === 'alternative' ? plan.alternative ?? plan.primary : plan.primary

  // Dynamically adapt left positioning when sidebar is collapsed to avoid empty space
  const leftPosition = sidebarOpen ? 'sm:left-[405px]' : 'sm:left-3'

  return (
    <section data-testid="route-status" aria-live="polite" className={`absolute bottom-3 left-2 right-2 z-10 rounded-xl border border-white/20 bg-[#0d1117]/95 p-3 shadow-2xl transition-all duration-300 ease-in-out ${leftPosition} sm:right-auto sm:max-w-xl md:max-w-2xl backdrop-blur`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-mono text-[11px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${plan.feasible ? 'border-emerald-600 bg-[#21262d] text-emerald-400' : 'border-amber-600 bg-[#21262d] text-amber-400'}`}>
              {plan.feasible ? 'SAFE' : 'CAUTION'}
            </span>
            <strong className="block text-xs font-mono font-bold uppercase tracking-wider text-white">
              {plan.feasible ? 'Route is safe to return' : 'Route needs changes'}
            </strong>
            <span className="hidden font-mono text-[10px] text-sky-400 font-semibold lg:inline-block">
              SCI SCORE {route.metrics.science_score}/100
            </span>
          </div>
          <p className="truncate font-mono text-xs text-slate-200 mt-0.5">
            {formatDistance(route.metrics.distance_m)} · {Math.round(route.metrics.duration_min)} min · {Math.round(route.metrics.energy_units).toLocaleString()} EU · Max slope {route.metrics.maximum_slope_deg}°
          </p>
          {route.explanation[0] && (
            <p className="hidden text-[11px] text-slate-300 truncate sm:block mt-0.5 font-mono">
              <span className="text-sky-400 font-semibold mr-1">Why:</span>
              {route.explanation[0]} {route.explanation[1]}
            </p>
          )}
        </div>

        {/* Clean, consolidated action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" className="hidden sm:flex text-xs font-mono border border-white/10 hover:border-white/20 bg-[#161b22]" onClick={() => setActive(active === 'primary' ? 'alternative' : 'primary')}>
            {active === 'primary' ? 'Show alternative' : 'Show primary'}
          </Button>
          <Button variant="secondary" size="sm" className="text-xs font-semibold bg-[#21262d] border border-white/20 hover:bg-[#30363d]" onClick={() => setDetails(true)}>
            Details
          </Button>
        </div>
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
    <Sheet open={open} onOpenChange={setOpen} title="Route details" side="right">
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
              <div className="rounded-lg border border-white/10 bg-[#161b22] p-2.5 font-mono" key={label}>
                <small className="block text-[10px] uppercase text-slate-400 tracking-wider">{label}</small>
                <strong className="mt-1 block text-sm text-white">{value}</strong>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-white/10 bg-[#161b22] p-2.5">
            <h4 className="mb-2 text-xs font-medium text-slate-300">Elevation profile · HiRISE DTM</h4>
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

          <div className="rounded-lg border border-white/10 bg-[#161b22] p-3">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-mono font-semibold tracking-wider uppercase text-mars">
              <Activity size={14} /> Why this route
            </h3>
            <div className="space-y-1.5">
              {route.explanation.map((line) => (
                <p className="text-xs leading-relaxed text-slate-300" key={line}>{line}</p>
              ))}
            </div>
          </div>

          <Button variant="secondary" className="w-full text-xs" onClick={() => applyEnergyLoss()}>
            <Zap size={14} className="text-amber-400" /> Simulate 20% energy loss
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
    <Sheet open={Boolean(draft)} onOpenChange={(open) => !open && cancel()} title="Add checkpoint" side="bottom">
      {draft && (
        <div className="mx-auto max-w-xl space-y-4">
          <label className="block text-xs font-medium text-slate-200">
            Checkpoint name
            <input
              className="mt-1.5 min-h-10 w-full rounded-lg border border-white/20 bg-background px-3 text-xs font-mono text-white"
              value={draft.name}
              placeholder="e.g. North delta stop"
              onChange={(event) => useMissionStore.setState({ draftStop: { ...draft, name: event.target.value } })}
            />
          </label>
          {!validation ? (
            <div className="flex items-center gap-2 text-xs text-slate-300 font-mono">
              <span className="spinner" /> Checking terrain…
            </div>
          ) : (
            <div className="rounded-lg border border-white/20 bg-[#161b22] p-3 text-xs">
              <strong className={`block font-semibold ${validation.valid ? 'text-emerald-400' : 'text-rose-400'}`}>
                {validation.valid ? '✓ This location is traversable' : '✕ Choose another location'}
              </strong>
              <p className="mt-1 font-mono text-[11px] text-slate-300">
                Elev: {validation.terrain.elevation_m?.toFixed(1)} m · Slope: {validation.terrain.slope_deg?.toFixed(1)}° · Geology: {validation.science_context.geology_symbol ?? 'Nili Planum'}
              </p>
              {validation.warnings.map((warning) => (
                <p className="mt-1.5 text-[11px] text-amber-300 font-mono" key={warning}>{warning}</p>
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
    <div className="absolute inset-0 overflow-hidden bg-[#090b0e]">
      <MarsMap />
      <PlacementBanner />
      <WaypointInspector2D />
      <MissionSidebar />
      <LayerControl />
      <RouteSummary />
      <RouteDetails />
      <DraftStopSheet />
    </div>
  )
}

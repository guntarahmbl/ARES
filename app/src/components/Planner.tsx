import { useEffect, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChevronLeft, ChevronRight, GripVertical, Layers3, Menu, Navigation, Plus, Trash2, X } from 'lucide-react'
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
    <div className="absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-3 rounded border border-rule bg-panel py-1.5 pl-4 pr-1.5 text-[13px]">
      <span className="text-ink">
        {mode === 'habitat'
          ? 'Click inside the dashed zone to move the habitat'
          : 'Click the map to place a checkpoint'}
      </span>
      <Button variant="secondary" size="sm" onClick={cancel}>
        Cancel <kbd className="num text-ink-3">Esc</kbd>
      </Button>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="num mt-0.5 text-[13px] text-ink">{value}</dd>
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

  if (!id || !bootstrap) return null
  const waypoint = bootstrap.waypoints.features.find((f) => f.properties.id === id)
  if (!waypoint) return null
  const images = bootstrap.surface_images.filter((img) => img.waypoint_id === id)
  const evidence = bootstrap.science_evidence[id]
  const isSelected = mission?.route_stops.some((s) => s.id === id)

  return (
    <aside
      className="absolute right-3 top-16 z-20 max-h-[80svh] w-80 overflow-y-auto rounded border border-rule bg-panel p-4"
      onMouseEnter={() => setHovered(id)}
      onMouseLeave={() => setHovered(null)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-ink-3">Science target · Sol <span className="num">{waypoint.properties.sol}</span></p>
          <h3 className="mt-1 text-base font-semibold leading-snug text-ink">{waypoint.properties.name}</h3>
        </div>
        <button
          className="grid size-7 shrink-0 place-items-center rounded text-ink-3 hover:bg-panel-2 hover:text-ink"
          onClick={() => { setSelected(null); setHovered(null) }}
          aria-label="Close inspector"
        >
          <X size={14} />
        </button>
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{waypoint.properties.science_rationale}</p>

      {images[0] && (
        <figure className="mt-3">
          <img className="aspect-video w-full rounded-sm object-cover" src={`/assets/thumbnails/surface/${images[0].product_id}.jpg`} alt={waypoint.properties.name} />
          <figcaption className="mt-1 text-xs text-ink-3">Perseverance Mastcam-Z / Navcam</figcaption>
        </figure>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-3 border-y border-rule py-3">
        <Stat label="Priority" value={`${waypoint.properties.priority} of 3`} />
        <Stat label="Geology" value={evidence?.geology_symbol ?? 'Nili'} />
        <Stat label="OLINDEX3" value={evidence?.crism.olindex3?.toFixed(3) ?? 'nodata'} />
      </dl>

      <Button
        variant={isSelected ? 'secondary' : 'default'}
        size="sm"
        className="mt-3 w-full"
        onClick={() => toggleScience(id)}
      >
        {isSelected ? 'Remove from route' : 'Add to route'}
      </Button>
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
    <Button variant="secondary" size="icon" className="absolute left-3 top-3 z-20 hidden bg-panel lg:flex" onClick={() => setOpen(true)} aria-label="Expand mission panel">
      <Menu size={16} />
    </Button>
  )

  const disclosure = 'group rounded border border-rule'
  const summary = 'flex min-h-10 cursor-pointer list-none items-center justify-between px-3 text-[13px] font-medium text-ink [&::-webkit-details-marker]:hidden'

  return (
    <aside className="absolute inset-x-2 bottom-2 z-20 flex max-h-[52svh] flex-col overflow-hidden rounded border border-rule bg-panel sm:bottom-3 sm:left-3 sm:right-auto sm:top-3 sm:max-h-none sm:w-96 lg:w-[380px]">
      <div className="flex items-start gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-ink">Plan an EVA</h1>
          <p className="mt-0.5 text-[13px] text-ink-3">Choose stops and check a safe return route</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Collapse mission panel">
          <ChevronLeft size={16} className="hidden lg:block" />
          <X size={16} className="lg:hidden" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold text-ink">Route stops</h2>
            <span className="text-xs text-ink-3"><span className="num">{mission.route_stops.length}</span> stops · round trip</span>
          </div>

          <ol className="relative">
            <span className="absolute bottom-3 left-[9px] top-3 w-px bg-rule" aria-hidden />

            <li className="relative flex min-h-11 items-center gap-3">
              <span className="relative z-10 grid size-[19px] place-items-center bg-panel"><span className="size-2.5 rounded-full border-2 border-ink" /></span>
              <div className="min-w-0 flex-1">
                <strong className="block text-[13px] font-medium text-ink">Habitat</strong>
                <span className="text-xs text-ink-3">Starting point</span>
              </div>
              <button
                className="text-xs text-ink-2 underline underline-offset-2 hover:text-ink"
                onClick={() => useMissionStore.getState().setPlacementMode('habitat')}
                title="Relocate habitat within the approved 250 m zone"
              >
                Relocate
              </button>
            </li>

            {mission.route_stops.map((stop, index) => (
              <li
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
                className={`group/stop relative flex min-h-11 cursor-grab items-center gap-3 active:cursor-grabbing ${draggedIndex === index ? 'opacity-40' : ''}`}
              >
                <span className="num relative z-10 grid size-[19px] place-items-center rounded-full bg-ink text-[10px] font-semibold text-ground">
                  {index + 1}
                </span>
                <button className="min-w-0 flex-1 text-left" onClick={() => stop.type === 'science' && useMissionStore.getState().setSelectedWaypoint(stop.id)}>
                  <strong className="block truncate text-[13px] font-medium text-ink">{stopName(stop)}</strong>
                  <span className="text-xs text-ink-3">{stop.type === 'science' ? 'Science target' : 'Checkpoint'}</span>
                </button>
                <GripVertical size={14} className="text-ink-3 opacity-0 transition-opacity group-hover/stop:opacity-100" aria-hidden />
                <button className="grid size-7 place-items-center rounded text-ink-3 hover:bg-panel-2 hover:text-danger disabled:opacity-25" disabled={mission.route_stops.length === 1} onClick={() => remove(stop.id)} aria-label={`Remove ${stop.id}`}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}

            <li className="relative flex min-h-11 items-center gap-3">
              <span className="relative z-10 grid size-[19px] place-items-center bg-panel"><span className="size-2.5 rounded-full border-2 border-ink-3" /></span>
              <div className="min-w-0 flex-1">
                <strong className="block text-[13px] font-medium text-ink">Return to habitat</strong>
                <span className="text-xs text-ink-3">Route ends at the starting point</span>
              </div>
            </li>
          </ol>

          <Button
            variant="secondary"
            className="mt-3 w-full"
            disabled={mission.route_stops.length >= 12}
            onClick={() => {
              setPlacement('stop')
              if (window.innerWidth < 1024) setOpen(false)
            }}
          >
            <Plus size={14} /> Add stop on map
          </Button>
        </section>

        <details className={disclosure}>
          <summary className={summary}>
            <span>Science targets</span>
            <ChevronRight size={14} className="text-ink-3 transition-transform group-open:rotate-90" />
          </summary>
          <div className="border-t border-rule p-1.5">
            {bootstrap.waypoints.features.map((feature) => {
              const selected = mission.route_stops.some((stop) => stop.id === feature.properties.id)
              return (
                <label
                  key={feature.properties.id}
                  className="flex min-h-10 cursor-pointer items-center gap-3 rounded px-2 hover:bg-panel-2"
                  onMouseEnter={() => useMissionStore.getState().setHoveredWaypoint(feature.properties.id)}
                  onMouseLeave={() => useMissionStore.getState().setHoveredWaypoint(null)}
                >
                  <input className="check" type="checkbox" checked={selected} onChange={() => toggleScience(feature.properties.id)} />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[13px] font-medium text-ink">{feature.properties.name}</strong>
                    <small className="text-xs text-ink-3">{feature.properties.id} · Sol <span className="num">{feature.properties.sol}</span></small>
                  </span>
                </label>
              )
            })}
          </div>
        </details>

        <details className={disclosure}>
          <summary className={summary}>
            <span>Route settings</span>
            <ChevronRight size={14} className="text-ink-3 transition-transform group-open:rotate-90" />
          </summary>
          <div className="space-y-4 border-t border-rule p-3">
            {[
              ['Maximum duration', 'max_duration_min', 240, 1000, 10, `${mission.max_duration_min} min`],
              ['Energy budget', 'energy_budget', 15000, 70000, 1000, `${mission.energy_budget.toLocaleString()} EU`],
              ['Preferred maximum slope', 'preferred_max_slope_deg', 8, 25, 1, `${mission.preferred_max_slope_deg}°`],
              ['Return reserve', 'return_reserve_pct', 10, 50, 5, `${mission.return_reserve_pct}%`],
            ].map(([label, key, min, max, step, value]) => (
              <label className="block text-[13px]" key={String(key)}>
                <span className="mb-1 flex justify-between">
                  <span className="text-ink-2">{label}</span>
                  <output className="num text-ink">{value}</output>
                </span>
                <input
                  className="w-full"
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

      <div className="border-t border-rule p-3">
        <Button
          data-testid="route-action"
          className="h-11 w-full"
          disabled={state === 'loading' || (Boolean(plan) && !routeDirty)}
          onClick={() => calculate()}
        >
          {state === 'loading' ? <span className="spinner" style={{ borderColor: '#10131255', borderTopColor: '#101312' }} /> : <Navigation size={14} />}
          {state === 'loading' ? 'Updating route…' : routeDirty ? (plan ? 'Update route' : 'Plan route') : 'Route up to date'}
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

  const scale = (label: string, from: string, to: string, gradient: string) => (
    <div>
      <span className="mb-1 block text-xs text-ink-2">{label}</span>
      <div className="flex items-center gap-2 text-xs text-ink-3">
        <span>{from}</span>
        <div className="h-1.5 flex-1 rounded-sm" style={{ background: gradient }} />
        <span>{to}</span>
      </div>
    </div>
  )

  return (
    <div className="absolute right-3 top-3 z-20">
      <Button variant="secondary" size="icon" className="bg-panel" onClick={() => setOpen(!open)} aria-label="Map layers" aria-expanded={open}>
        <Layers3 size={16} />
      </Button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded border border-rule bg-panel p-3.5">
          <h2 className="mb-1 text-[13px] font-semibold text-ink">Map layers</h2>
          {layers.map((layer) => (
            <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-[13px] text-ink" key={layer.id}>
              <input className="check" type="checkbox" checked={visibility[layer.id] ?? false} onChange={(event) => setVisibility(layer.id, event.target.checked)} />
              <span className="flex-1 truncate">{layer.label}</span>
              <small className="text-xs capitalize text-ink-3">{layer.kind}</small>
            </label>
          ))}
          <label className="mt-2 block border-t border-rule pt-3 text-[13px]">
            <span className="mb-1 flex justify-between">
              <span className="text-ink-2">Overlay opacity</span>
              <output className="num text-ink">{Math.round(opacity * 100)}%</output>
            </span>
            <input className="w-full" type="range" min="0.15" max="0.9" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
          </label>

          {(visibility.slope || visibility.hazard || visibility.crism) && (
            <div className="mt-3 space-y-3 border-t border-rule pt-3">
              {visibility.slope && scale('Slope', '0°', '25°+', 'linear-gradient(to right, #10b981, #facc15, #e11d48)')}
              {visibility.hazard && scale('Traversability', 'Regolith', 'Rocky', 'linear-gradient(to right, #10b981, #f59e0b, #dc2626)')}
              {visibility.crism && scale('CRISM OLINDEX3', 'Low', 'Clay / olivine', 'linear-gradient(to right, #1e3a8a, #22d3ee, #fbbf24)')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ReturnMargin({ used, budget, reservePct }: { used: number; budget: number; reservePct: number }) {
  const limit = 1 - reservePct / 100
  const ratio = Math.min(used / budget, 1)
  const over = used / budget > limit
  return (
    <div>
      <div className="relative h-1.5 rounded-sm bg-panel-2" role="img" aria-label={`${Math.round(ratio * 100)}% of energy budget used; ${reservePct}% held in reserve`}>
        <div className={`absolute inset-y-0 left-0 rounded-sm ${over ? 'bg-caution' : 'bg-ink'}`} style={{ width: `${ratio * 100}%` }} />
        <span className="absolute -inset-y-1 w-px bg-rust" style={{ left: `${limit * 100}%` }} aria-hidden />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-ink-3">
        <span><span className="num text-ink-2">{Math.round(used).toLocaleString()}</span> of <span className="num">{Math.round(budget).toLocaleString()}</span> EU used</span>
        <span>Reserve starts at <span className="num text-rust">{Math.round(budget * limit).toLocaleString()}</span></span>
      </div>
    </div>
  )
}

function RouteSummary() {
  const plan = useMissionStore((state) => state.plan)
  const mission = useMissionStore((state) => state.mission)
  const active = useMissionStore((state) => state.activeRoute)
  const setActive = useMissionStore((state) => state.setActiveRoute)
  const setDetails = useMissionStore((state) => state.setDetailsOpen)
  const sidebarOpen = useMissionStore((state) => state.sidebarOpen)
  if (!plan?.primary || !mission) return null
  const route = active === 'alternative' ? plan.alternative ?? plan.primary : plan.primary

  const leftPosition = sidebarOpen ? 'sm:left-[405px]' : 'sm:left-3'

  return (
    <section data-testid="route-status" aria-live="polite" className={`absolute bottom-3 left-2 right-2 z-10 rounded border border-rule bg-panel p-3.5 sm:right-auto sm:w-[34rem] ${leftPosition}`}>
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${plan.feasible ? 'bg-safe' : 'bg-caution'}`} aria-hidden />
        <strong className="text-sm font-semibold text-ink">
          {plan.feasible ? 'Route is safe to return' : 'Route needs changes'}
        </strong>
        <span className="ml-auto text-xs text-ink-3">Science score <span className="num text-ink">{route.metrics.science_score}</span> / 100</span>
      </div>

      <div className="mt-3">
        <ReturnMargin used={route.metrics.energy_units} budget={mission.energy_budget} reservePct={mission.return_reserve_pct} />
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-rule pt-3">
        <Stat label="Distance" value={formatDistance(route.metrics.distance_m)} />
        <Stat label="Duration" value={`${Math.round(route.metrics.duration_min)} min`} />
        <Stat label="Max slope" value={`${route.metrics.maximum_slope_deg}°`} />
      </dl>

      {route.explanation[0] && (
        <p className="mt-3 hidden truncate text-xs text-ink-2 sm:block">
          <span className="font-medium text-ink">Why: </span>
          {route.explanation[0]} {route.explanation[1]}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setDetails(true)}>Details</Button>
        <Button variant="ghost" size="sm" className="hidden sm:flex" onClick={() => setActive(active === 'primary' ? 'alternative' : 'primary')}>
          {active === 'primary' ? 'Show alternative' : 'Show primary'}
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
    <Sheet open={open} onOpenChange={setOpen} title="Route details" side="right">
      {route && (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 border-b border-rule">
            {[
              ['Distance', formatDistance(route.metrics.distance_m)],
              ['Max slope', `${route.metrics.maximum_slope_deg}°`],
              ['Energy consumed', `${Math.round(route.metrics.energy_units).toLocaleString()} EU`],
              ['Return reserve', `${Math.round(route.metrics.return_reserve_units).toLocaleString()} EU`],
              ['Elevation gain', `+${route.metrics.elevation_gain_m} m`],
              ['Science score', `${route.metrics.science_score} / 100`],
            ].map(([label, value], i) => (
              <div className={`py-2.5 ${i % 2 ? 'pl-3' : 'border-r border-rule pr-3'} ${i > 1 ? 'border-t border-rule' : ''}`} key={label}>
                <dt className="text-xs text-ink-3">{label}</dt>
                <dd className="num mt-0.5 text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          <div>
            <h4 className="mb-2 text-[13px] font-semibold text-ink">Elevation profile <span className="font-normal text-ink-3">· HiRISE DTM</span></h4>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={route.elevation_profile}>
                  <XAxis dataKey="distance_m" hide />
                  <YAxis width={52} tickCount={4} tickFormatter={(v: number) => `${Math.round(v)}`} tick={{ fill: '#838a86', fontSize: 10, fontFamily: 'Martian Mono Variable, monospace' }} axisLine={false} tickLine={false} domain={['dataMin - 5', 'dataMax + 5']} />
                  <Tooltip
                    formatter={(v: number) => [`${Math.round(v)} m`, 'Elevation']}
                    labelFormatter={(d: number) => `${Math.round(d)} m along route`}
                    contentStyle={{ background: '#181b1a', borderColor: '#343a38', borderRadius: '3px', fontSize: '12px' }}
                  />
                  <Area type="monotone" baseValue="dataMin" dataKey="elevation_m" stroke="#e2784a" fill="#e2784a1f" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-[13px] font-semibold text-ink">Why this route</h3>
            <div className="space-y-2">
              {route.explanation.map((line) => (
                <p className="text-[13px] leading-relaxed text-ink-2" key={line}>{line}</p>
              ))}
            </div>
          </div>

          <Button variant="secondary" className="w-full" onClick={() => applyEnergyLoss()}>
            Simulate 20% energy loss
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
          <label className="block text-[13px] font-medium text-ink">
            Checkpoint name
            <input
              className="mt-1.5 h-10 w-full rounded border border-rule bg-ground px-3 text-[13px] text-ink placeholder:text-ink-3 focus-visible:border-ink-3"
              value={draft.name}
              placeholder="e.g. North delta stop"
              onChange={(event) => useMissionStore.setState({ draftStop: { ...draft, name: event.target.value } })}
            />
          </label>
          {!validation ? (
            <div className="flex items-center gap-2 text-[13px] text-ink-2">
              <span className="spinner" /> Checking terrain…
            </div>
          ) : (
            <div className="rounded border border-rule p-3 text-[13px]">
              <strong className={`flex items-center gap-2 font-semibold ${validation.valid ? 'text-safe' : 'text-danger'}`}>
                <span className={`size-2 rounded-full ${validation.valid ? 'bg-safe' : 'bg-danger'}`} aria-hidden />
                {validation.valid ? 'This location is traversable' : 'Choose another location'}
              </strong>
              <dl className="mt-2 grid grid-cols-3 gap-3">
                <Stat label="Elevation" value={`${validation.terrain.elevation_m?.toFixed(1)} m`} />
                <Stat label="Slope" value={`${validation.terrain.slope_deg?.toFixed(1)}°`} />
                <Stat label="Geology" value={validation.science_context.geology_symbol ?? 'Nili Planum'} />
              </dl>
              {validation.warnings.map((warning) => (
                <p className="mt-2 text-xs text-caution" key={warning}>{warning}</p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
            <Button size="sm" disabled={!validation?.valid || !draft.name.trim()} onClick={commit}>
              Add to route
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

export function Planner() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-ground">
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

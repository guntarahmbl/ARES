import { useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, GripVertical, Layers3, PanelLeftOpen, Plus, Trash2, X } from 'lucide-react'
import { useMissionStore } from '../store'
import type { RouteCandidate, RouteStop } from '../types'
import { MarsMap } from './MarsMap'
import { TraverseProfile } from './TraverseProfile'
import { Button } from './ui/button'
import { Sheet } from './ui/sheet'

const formatDistance = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
const formatEnergy = (units: number) => `${Math.round(units).toLocaleString()} EU`
const isNarrow = () => window.innerWidth < 768

function stopName(stop: RouteStop) {
  if (stop.type === 'custom') return stop.name
  const feature = useMissionStore.getState().bootstrap?.waypoints.features.find((item) => item.properties.id === stop.id)
  return feature?.properties.name ?? stop.id
}

function useActiveRoute(): RouteCandidate | null {
  const plan = useMissionStore((state) => state.plan)
  const active = useMissionStore((state) => state.activeRoute)
  if (!plan?.primary) return null
  return active === 'alternative' ? plan.alternative ?? plan.primary : plan.primary
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
    <div className="absolute left-1/2 top-3 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 bg-ink py-1.5 pl-4 pr-1.5 text-[13px] text-panel">
      <span>
        {mode === 'habitat'
          ? 'Click inside the dashed zone to move the habitat'
          : 'Click the map to place a checkpoint'}
      </span>
      <button className="flex h-7 shrink-0 items-center gap-1.5 rounded border border-panel/40 px-2 font-semibold hover:bg-panel/15" onClick={cancel}>
        Cancel <kbd className="num text-xs text-panel/70">Esc</kbd>
      </button>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="label truncate text-ink-3">{label}</dt>
      <dd className="num mt-1 truncate text-[15px] font-bold leading-none text-ink">{value}</dd>
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
      className="absolute inset-x-3 top-14 z-20 max-h-[calc(100%-4.5rem)] overflow-y-auto border border-ink bg-panel sm:left-auto sm:w-80"
      onMouseEnter={() => setHovered(id)}
      onMouseLeave={() => setHovered(null)}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div>
          <p className="label text-ink-3">{waypoint.properties.id} · Science target · Sol <span className="num">{waypoint.properties.sol}</span></p>
          <h3 className="mt-1.5 text-base font-bold leading-snug text-ink">{waypoint.properties.name}</h3>
        </div>
        <button
          className="-mr-2 grid size-7 shrink-0 place-items-center rounded text-ink-2 hover:bg-panel-2 hover:text-ink"
          onClick={() => { setSelected(null); setHovered(null) }}
          aria-label="Close inspector"
        >
          <X size={14} />
        </button>
      </div>

      <p className="mt-2 px-4 text-[13px] leading-relaxed text-ink-2">{waypoint.properties.science_rationale}</p>

      {images[0] && (
        <figure className="mt-3 px-4">
          <img className="aspect-video w-full object-cover" src={`/assets/thumbnails/surface/${images[0].product_id}.jpg`} alt={waypoint.properties.name} />
          <figcaption className="mt-1 text-xs text-ink-3">Perseverance Mastcam-Z / Navcam</figcaption>
        </figure>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-3 border-y border-rule px-4 py-3">
        <Stat label="Priority" value={`${waypoint.properties.priority} of 3`} />
        <Stat label="Geology" value={evidence?.geology_symbol ?? 'Nili'} />
        <Stat label="OLINDEX3" value={evidence?.crism.olindex3?.toFixed(3) ?? 'nodata'} />
      </dl>

      <div className="p-3">
        <Button
          variant={isSelected ? 'secondary' : 'default'}
          size="sm"
          className="w-full"
          onClick={() => toggleScience(id)}
        >
          {isSelected ? 'Remove from route' : 'Add to route'}
        </Button>
      </div>
    </aside>
  )
}

/** One line of the traverse table: station mark, name, and where the route stands on arrival. */
function StationRow({ mark, name, kind, arrival, energy, children }: {
  mark: string; name: string; kind: string; arrival?: string; energy?: string; children?: ReactNode
}) {
  return (
    <>
      <span className="num relative z-10 grid size-6 shrink-0 place-items-center border border-ink bg-panel text-[13px] font-bold leading-none text-ink">
        <span className="translate-y-px">{mark}</span>
      </span>
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-[13px] font-semibold text-ink">{name}</strong>
        <span className="block truncate text-xs text-ink-3">{kind}</span>
      </div>
      {arrival && (
        <div className="shrink-0 text-right">
          <span className="num block text-[13px] leading-tight text-ink">{arrival}</span>
          <span className="num block text-[11px] leading-tight text-ink-3">{energy}</span>
        </div>
      )}
      {children}
    </>
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
  const route = useActiveRoute()

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  if (!open) return null

  const startPlacement = (mode: 'habitat' | 'stop') => {
    setPlacement(mode)
    if (isNarrow()) setOpen(false)
  }

  // Arrival figures only mean something while the plan matches the stop list.
  const current = route && !routeDirty ? route : null
  const scienceCount = mission.route_stops.filter((stop) => stop.type === 'science').length
  const summary = 'flex h-11 cursor-pointer list-none items-center gap-2 px-4 text-[13px] font-semibold text-ink hover:bg-panel-2 [&::-webkit-details-marker]:hidden'
  const chevron = <ChevronRight size={14} className="text-ink-2 transition-transform group-open:rotate-90" />

  return (
    <aside className="absolute inset-0 z-30 flex flex-col bg-panel md:static md:z-auto md:w-[340px] md:shrink-0 md:border-r md:border-ink">
      <div className="flex items-start gap-3 border-b border-ink py-3 pl-4 pr-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-tight text-ink">Plan an EVA</h1>
          <p className="mt-0.5 text-[13px] text-ink-2">Choose stops and check a safe return route</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Collapse mission panel">
          <ChevronLeft size={16} className="hidden md:block" />
          <X size={16} className="md:hidden" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="px-4 pb-4 pt-3">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="label text-ink">Traverse</h2>
            <span className="label text-ink-3">{current ? 'Arrival · energy used' : 'Round trip'}</span>
          </div>

          <ol className="relative">
            <span className="absolute bottom-5 left-[11.5px] top-5 w-px bg-ink" aria-hidden />

            <li className="relative flex min-h-12 items-center gap-3">
              <StationRow mark="H" name="Habitat" kind="Starting point">
                <button
                  className="text-xs font-medium text-ink underline underline-offset-2 hover:text-route"
                  onClick={() => startPlacement('habitat')}
                  title="Move the habitat within the approved 250 m zone"
                >
                  Relocate
                </button>
              </StationRow>
            </li>

            {mission.route_stops.map((stop, index) => {
              const visit = current?.stop_visits.find((item) => item.id === stop.id)
              return (
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
                  className={`group/stop relative flex min-h-12 cursor-grab items-center gap-3 active:cursor-grabbing ${draggedIndex === index ? 'opacity-40' : ''}`}
                >
                  <StationRow
                    mark={String(index + 1)}
                    name={stopName(stop)}
                    kind={stop.type === 'science' ? `Science target · ${stop.id}` : 'Checkpoint'}
                    arrival={visit ? formatDistance(visit.arrival_distance_m) : undefined}
                    energy={visit ? formatEnergy(visit.arrival_energy_units) : undefined}
                  >
                    <div className="flex shrink-0 items-center">
                      <GripVertical size={14} className="text-ink-3 opacity-0 transition-opacity group-hover/stop:opacity-100" aria-hidden />
                      <button className="grid size-7 place-items-center rounded text-ink-3 hover:bg-panel-2 hover:text-danger disabled:opacity-30" disabled={mission.route_stops.length === 1} onClick={() => remove(stop.id)} aria-label={`Remove ${stopName(stop)}`}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </StationRow>
                  {stop.type === 'science' && (
                    <button className="absolute inset-y-0 left-0 right-12" onClick={() => useMissionStore.getState().setSelectedWaypoint(stop.id)} aria-label={`Show ${stopName(stop)} on the map`} />
                  )}
                </li>
              )
            })}

            <li className="relative flex min-h-12 items-center gap-3">
              <StationRow
                mark="H"
                name="Return to habitat"
                kind="Route ends at the starting point"
                arrival={current ? formatDistance(current.metrics.distance_m) : undefined}
                energy={current ? formatEnergy(current.metrics.energy_units) : undefined}
              />
            </li>
          </ol>

          <Button
            variant="secondary"
            className="mt-2 w-full"
            disabled={mission.route_stops.length >= 12}
            onClick={() => startPlacement('stop')}
          >
            <Plus size={14} /> Add stop on map
          </Button>
        </section>

        <details className="group border-t border-rule">
          <summary className={summary}>
            <span className="flex-1">Science targets</span>
            <span className="num text-xs font-normal text-ink-3">{scienceCount} of {bootstrap.waypoints.features.length}</span>
            {chevron}
          </summary>
          <div className="pb-2">
            {bootstrap.waypoints.features.map((feature) => {
              const selected = mission.route_stops.some((stop) => stop.id === feature.properties.id)
              return (
                <label
                  key={feature.properties.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 px-4 hover:bg-panel-2"
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

        <details className="group border-y border-rule">
          <summary className={summary}>
            <span className="flex-1">Route settings</span>
            <span className="num text-xs font-normal text-ink-3 group-open:hidden">{mission.max_duration_min} min · {mission.return_reserve_pct}% reserve</span>
            {chevron}
          </summary>
          <div className="space-y-4 px-4 pb-4 pt-1">
            {[
              ['Maximum duration', 'max_duration_min', 240, 1000, 10, `${mission.max_duration_min} min`],
              ['Energy budget', 'energy_budget', 15000, 70000, 1000, `${mission.energy_budget.toLocaleString()} EU`],
              ['Preferred maximum slope', 'preferred_max_slope_deg', 8, 25, 1, `${mission.preferred_max_slope_deg}°`],
              ['Return reserve', 'return_reserve_pct', 10, 50, 5, `${mission.return_reserve_pct}%`],
            ].map(([label, key, min, max, step, value]) => (
              <label className="block text-[13px]" key={String(key)}>
                <span className="flex items-baseline justify-between">
                  <span className="text-ink-2">{label}</span>
                  <output className="num font-bold text-ink">{value}</output>
                </span>
                <input
                  className="mt-1 w-full"
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

      <div className="border-t border-ink p-3">
        <Button
          data-testid="route-action"
          className="h-11 w-full"
          disabled={state === 'loading' || (Boolean(plan) && !routeDirty)}
          onClick={() => calculate()}
        >
          {state === 'loading' ? <span className="spinner" /> : !routeDirty && plan ? <Check size={14} /> : null}
          {state === 'loading' ? 'Updating route…' : routeDirty ? (plan ? 'Update route' : 'Plan route') : 'Route up to date'}
        </Button>
      </div>
    </aside>
  )
}

function SidebarExpand() {
  const open = useMissionStore((state) => state.sidebarOpen)
  const setOpen = useMissionStore((state) => state.setSidebarOpen)
  if (open) return null
  return (
    <Button variant="secondary" size="icon" className="absolute left-3 top-3 z-20 hidden md:flex" onClick={() => setOpen(true)} aria-label="Expand mission panel">
      <PanelLeftOpen size={16} />
    </Button>
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
      <span className="label mb-1.5 block text-ink-2">{label}</span>
      <div className="flex items-center gap-2 text-xs text-ink-2">
        <span>{from}</span>
        <div className="h-2 flex-1 border border-ink" style={{ background: gradient }} />
        <span>{to}</span>
      </div>
    </div>
  )

  return (
    <div className="absolute right-3 top-3 z-20">
      <Button variant="secondary" size="icon" className="ml-auto flex" onClick={() => setOpen(!open)} aria-label="Map layers" aria-expanded={open}>
        <Layers3 size={16} />
      </Button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 border border-ink bg-panel">
          <h2 className="label border-b border-rule px-3.5 py-2.5 text-ink">Map layers</h2>
          <div className="py-1">
            {layers.map((layer) => (
              <label className="flex min-h-9 cursor-pointer items-center gap-2.5 px-3.5 text-[13px] text-ink hover:bg-panel-2" key={layer.id}>
                <input className="check" type="checkbox" checked={visibility[layer.id] ?? false} onChange={(event) => setVisibility(layer.id, event.target.checked)} />
                <span className="flex-1 truncate">{layer.label}</span>
                <small className="label text-ink-3">{layer.kind}</small>
              </label>
            ))}
          </div>
          <label className="block border-t border-rule px-3.5 py-3 text-[13px]">
            <span className="flex items-baseline justify-between">
              <span className="text-ink-2">Overlay opacity</span>
              <output className="num font-bold text-ink">{Math.round(opacity * 100)}%</output>
            </span>
            <input className="mt-1 w-full" type="range" min="0.15" max="0.9" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
          </label>

          {(visibility.slope || visibility.hazard || visibility.crism) && (
            <div className="space-y-3 border-t border-rule px-3.5 py-3">
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

/** Energy spent against the budget, with the return reserve hatched off at the far end. */
function ReturnMargin({ used, budget, reservePct }: { used: number; budget: number; reservePct: number }) {
  const limit = 1 - reservePct / 100
  const ratio = Math.min(used / budget, 1)
  const over = used / budget > limit
  return (
    <div>
      <div className="relative h-2.5 border border-ink" role="img" aria-label={`${Math.round(ratio * 100)}% of energy budget used; ${reservePct}% held in reserve`}>
        <div
          className="absolute inset-y-0 right-0 border-l border-rust"
          style={{ left: `${limit * 100}%`, background: 'repeating-linear-gradient(135deg, #b8431b 0 1.5px, transparent 1.5px 5px)' }}
          aria-hidden
        />
        <div className={`absolute inset-y-0 left-0 ${over ? 'bg-danger' : 'bg-ink'}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-ink-2">
        <span className="whitespace-nowrap"><span className="num text-ink">{Math.round(used).toLocaleString()}</span> of <span className="num">{Math.round(budget).toLocaleString()}</span> EU</span>
        <span className="whitespace-nowrap text-rust">reserve from <span className="num">{Math.round(budget * limit).toLocaleString()}</span></span>
      </div>
    </div>
  )
}

function RouteStrip() {
  const plan = useMissionStore((state) => state.plan)
  const mission = useMissionStore((state) => state.mission)
  const active = useMissionStore((state) => state.activeRoute)
  const setActive = useMissionStore((state) => state.setActiveRoute)
  const setDetails = useMissionStore((state) => state.setDetailsOpen)
  const loading = useMissionStore((state) => state.state === 'loading')
  const route = useActiveRoute()
  if (!plan || !route || !mission) return null

  return (
    <div className="relative z-10 shrink-0 [container-type:inline-size]">
    <section
      data-testid="route-status"
      aria-live="polite"
      className={`flex flex-wrap items-stretch border-t border-ink bg-panel transition-opacity wide:flex-nowrap ${loading ? 'opacity-60' : ''}`}
    >
      <div className="order-1 flex min-w-0 flex-1 items-center gap-3.5 px-4 py-3 wide:w-[21.5rem] wide:flex-none wide:border-r wide:border-rule">
        <strong className={`wordmark shrink-0 text-[26px] leading-none ${plan.feasible ? 'text-safe' : 'text-danger'}`}>
          {plan.feasible ? 'Go' : 'No-go'}
        </strong>
        <div className="min-w-0 flex-1">
          <p className="mb-1.5 truncate text-[13px] font-semibold text-ink">
            {plan.feasible ? 'Route is safe to return' : 'Route needs changes'}
            {active === 'alternative' && plan.alternative && <span className="font-normal text-ink-3"> · alternative</span>}
          </p>
          <ReturnMargin used={route.metrics.energy_units} budget={mission.energy_budget} reservePct={mission.return_reserve_pct} />
        </div>
      </div>

      <TraverseProfile
        compact
        route={route}
        stops={mission.route_stops}
        slopeLimitDeg={mission.preferred_max_slope_deg}
        className="order-3 hidden h-[84px] flex-1 px-4 pb-2.5 pt-1.5 wide:flex"
      />

      <dl className="order-4 grid w-full grid-cols-4 gap-3 border-t border-rule px-4 py-2.5 wide:order-3 wide:w-auto wide:grid-cols-[repeat(4,4.25rem)] wide:content-center wide:border-l wide:border-t-0">
        <Stat label="Distance" value={formatDistance(route.metrics.distance_m)} />
        <Stat label="Duration" value={`${Math.round(route.metrics.duration_min)} min`} />
        <Stat label="Max slope" value={`${route.metrics.maximum_slope_deg}°`} />
        <Stat label="Science" value={`${route.metrics.science_score}`} />
      </dl>

      <div className="order-2 flex shrink-0 flex-col justify-center gap-1 py-2 pl-1 pr-3 wide:order-4 wide:border-l wide:border-rule wide:pl-3">
        <Button variant="secondary" size="sm" onClick={() => setDetails(true)}>Details</Button>
        {plan.alternative && (
          <Button variant="ghost" size="sm" className="hidden sm:flex" onClick={() => setActive(active === 'primary' ? 'alternative' : 'primary')}>
            {active === 'primary' ? 'Show alternative' : 'Show primary'}
          </Button>
        )}
      </div>
    </section>
    </div>
  )
}

function RouteDetails() {
  const open = useMissionStore((state) => state.detailsOpen)
  const setOpen = useMissionStore((state) => state.setDetailsOpen)
  const plan = useMissionStore((state) => state.plan)
  const mission = useMissionStore((state) => state.mission)
  const active = useMissionStore((state) => state.activeRoute)
  const applyEnergyLoss = useMissionStore((state) => state.applyEnergyLoss)
  const route: RouteCandidate | null | undefined = active === 'alternative' ? plan?.alternative : plan?.primary

  return (
    <Sheet open={open} onOpenChange={setOpen} title="Route details" side="right">
      {route && mission && (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-rule pb-5">
            <Stat label="Distance" value={formatDistance(route.metrics.distance_m)} />
            <Stat label="Duration" value={`${Math.round(route.metrics.duration_min)} min`} />
            <Stat label="Energy consumed" value={formatEnergy(route.metrics.energy_units)} />
            <Stat label="Return reserve" value={formatEnergy(route.metrics.return_reserve_units)} />
            <Stat label="Elevation gain" value={`+${route.metrics.elevation_gain_m} m`} />
            <Stat label="Max slope" value={`${route.metrics.maximum_slope_deg}°`} />
            <Stat label="Science score" value={`${route.metrics.science_score} / 100`} />
          </dl>

          <div>
            <h3 className="label mb-2 text-ink">Elevation profile</h3>
            <TraverseProfile route={route} stops={mission.route_stops} slopeLimitDeg={mission.preferred_max_slope_deg} className="h-56" />
          </div>

          <div>
            <h3 className="label mb-2 text-ink">Why this route</h3>
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
          <label className="block text-[13px] font-semibold text-ink">
            Checkpoint name
            <input
              className="mt-1.5 h-10 w-full rounded border border-ink bg-white px-3 text-[13px] font-normal text-ink placeholder:text-ink-3"
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
            <div className="border-y border-rule py-3 text-[13px]">
              <strong className={`block font-semibold ${validation.valid ? 'text-safe' : 'text-danger'}`}>
                {validation.valid ? 'This location is traversable' : 'Choose another location'}
              </strong>
              <dl className="mt-3 grid grid-cols-3 gap-3">
                <Stat label="Elevation" value={validation.terrain.elevation_m === undefined ? '—' : `${validation.terrain.elevation_m.toFixed(1)} m`} />
                <Stat label="Slope" value={validation.terrain.slope_deg === undefined ? '—' : `${validation.terrain.slope_deg.toFixed(1)}°`} />
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
    <div className="absolute inset-0 flex overflow-hidden bg-ground">
      <MissionSidebar />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <MarsMap />
          <PlacementBanner />
          <SidebarExpand />
          <WaypointInspector2D />
          <LayerControl />
        </div>
        <RouteStrip />
      </div>
      <RouteDetails />
      <DraftStopSheet />
    </div>
  )
}

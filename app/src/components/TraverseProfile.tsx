import { useMemo, useState } from 'react'
import type { RouteCandidate, RouteStop } from '../types'

type Props = {
  route: RouteCandidate
  stops: RouteStop[]
  slopeLimitDeg: number
  /** Compact drops the elevation scale so the section fits in the strip under the map. */
  compact?: boolean
  className?: string
}

const formatAlong = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`

/**
 * Cross-section of the traverse: elevation against distance walked, with each
 * station ticked where the route reaches it and over-limit slopes drawn in red.
 */
export function TraverseProfile({ route, stops, slopeLimitDeg, compact = false, className = '' }: Props) {
  const [cursor, setCursor] = useState<number | null>(null)
  const samples = route.elevation_profile

  const geometry = useMemo(() => {
    if (samples.length < 2) return null
    const total = samples[samples.length - 1].distance_m || 1
    let low = Infinity
    let high = -Infinity
    for (const sample of samples) {
      if (sample.elevation_m < low) low = sample.elevation_m
      if (sample.elevation_m > high) high = sample.elevation_m
    }
    const span = Math.max(high - low, 1)
    const x = (distance: number) => (distance / total) * 100
    const y = (elevation: number) => 92 - ((elevation - low) / span) * 84
    const point = (sample: (typeof samples)[number]) => `${x(sample.distance_m).toFixed(2)},${y(sample.elevation_m).toFixed(2)}`
    const line = `M${samples.map(point).join('L')}`
    const area = `${line}L100,100L0,100Z`
    let steep = ''
    for (let index = 1; index < samples.length; index += 1) {
      if (samples[index].slope_deg > slopeLimitDeg) steep += `M${point(samples[index - 1])}L${point(samples[index])}`
    }
    return { total, low, high, line, area, steep, x, y }
  }, [samples, slopeLimitDeg])

  if (!geometry) return null

  const stations = route.stop_visits
    .map((visit) => ({ visit, number: stops.findIndex((stop) => stop.id === visit.id) + 1 }))
    .filter((station) => station.number > 0)

  const active = cursor === null ? null : samples.reduce((nearest, sample) =>
    Math.abs(sample.distance_m - cursor) < Math.abs(nearest.distance_m - cursor) ? sample : nearest, samples[0])

  return (
    <figure className={`flex min-w-0 flex-col ${className}`}>
      <div className="relative h-4 shrink-0">
        <span className="num absolute left-0 top-0 text-[11px] font-bold leading-4 text-ink">H</span>
        {stations.map(({ visit, number }) => (
          <span
            key={visit.id}
            className="num absolute top-0 -translate-x-1/2 text-[11px] font-bold leading-4 text-ink"
            style={{ left: `${geometry.x(visit.arrival_distance_m)}%` }}
          >
            {number}
          </span>
        ))}
        <span className="num absolute right-0 top-0 text-[11px] font-bold leading-4 text-ink">H</span>
      </div>

      <div
        className="relative min-h-0 flex-1 cursor-crosshair border-b border-ink"
        role="img"
        aria-label={`Elevation along the route, from ${Math.round(geometry.low)} to ${Math.round(geometry.high)} metres over ${formatAlong(geometry.total)}`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          setCursor(Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * geometry.total)
        }}
        onPointerLeave={() => setCursor(null)}
      >
        <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <path d={geometry.area} fill="rgb(var(--c-route))" fillOpacity="0.1" />
          {stations.map(({ visit }) => {
            const position = geometry.x(visit.arrival_distance_m)
            return <line key={visit.id} x1={position} x2={position} y1="0" y2="100" stroke="rgb(var(--c-ink))" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          })}
          <path d={geometry.line} fill="none" stroke="rgb(var(--c-route))" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {geometry.steep && <path d={geometry.steep} fill="none" stroke="rgb(var(--c-rust))" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
          {active && <line x1={geometry.x(active.distance_m)} x2={geometry.x(active.distance_m)} y1="0" y2="100" stroke="rgb(var(--c-ink))" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </svg>

        {!compact && (
          <>
            <span className="num pointer-events-none absolute left-1 top-0.5 bg-panel/80 px-0.5 text-[11px] text-ink-2">{Math.round(geometry.high).toLocaleString()} m</span>
            <span className="num pointer-events-none absolute bottom-0.5 left-1 bg-panel/80 px-0.5 text-[11px] text-ink-2">{Math.round(geometry.low).toLocaleString()} m</span>
          </>
        )}

        {active && (
          <span
            className="num pointer-events-none absolute top-0 z-10 whitespace-nowrap bg-ink px-1.5 py-0.5 text-[11px] text-panel"
            style={geometry.x(active.distance_m) > 60
              ? { right: `${100 - geometry.x(active.distance_m)}%` }
              : { left: `${geometry.x(active.distance_m)}%` }}
          >
            {formatAlong(active.distance_m)} · {Math.round(active.elevation_m).toLocaleString()} m · {active.slope_deg.toFixed(1)}°
          </span>
        )}
      </div>

      {!compact && (
        <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-route" aria-hidden />Elevation, HiRISE DTM</span>
          <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 bg-rust" aria-hidden />Steeper than {slopeLimitDeg}°</span>
          <span className="ml-auto num">{formatAlong(geometry.total)}</span>
        </figcaption>
      )}
    </figure>
  )
}

import { useEffect, useRef } from 'react'
import { ChevronDown, Map as MapIcon, Minus, Plus } from 'lucide-react'
import OlMap from 'ol/Map'
import View from 'ol/View'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import LineString from 'ol/geom/LineString'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import ImageStatic from 'ol/source/ImageStatic'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style'
import { coordinateToProjected, createMarsProjection } from '../lib/marsProjection'
import { useMissionStore } from '../store'
import type { RouteCandidate } from '../types'

const lineStyle = (color: string, width: number, dash?: number[]) => new Style({
  stroke: new Stroke({ color, width, lineDash: dash }),
})

function addRoute(source: VectorSource, route: RouteCandidate | null | undefined, style: Style, endIndex?: number) {
  if (!route) return
  const coordinates = route.coordinates
    .slice(0, endIndex === undefined ? undefined : Math.max(2, endIndex + 1))
    .map(([longitude, latitude]) => coordinateToProjected({ longitude, latitude }))
  if (coordinates.length < 2) return
  const feature = new Feature(new LineString(coordinates))
  feature.setStyle(style)
  source.addFeature(feature)
}

export function MarsTrackingMap() {
  const target = useRef<HTMLDivElement>(null)
  const mapRef = useRef<OlMap | null>(null)
  const minimapOpen = useMissionStore((state) => state.minimapOpen)
  const setMinimapOpen = useMissionStore((state) => state.setMinimapOpen)
  const selectedWaypoint = useMissionStore((state) => state.selectedWaypoint)
  const bootstrap = useMissionStore((state) => state.bootstrap)

  useEffect(() => {
    if (!target.current || !bootstrap || !minimapOpen) return
    const state = useMissionStore.getState()
    const projection = createMarsProjection(bootstrap.bounds_projected)
    const initialCenter = state.walkTelemetry?.projectedPosition ?? coordinateToProjected(bootstrap.default_mission.habitat)
    const baseLayer = new ImageLayer({
      source: new ImageStatic({
        url: bootstrap.layers.find((layer) => layer.id === 'imagery')?.url ?? '/assets/web/basemap.webp',
        imageExtent: bootstrap.bounds_projected,
        projection,
      }),
    })
    const missionSource = new VectorSource()
    const routeSource = new VectorSource()
    const completedSource = new VectorSource()
    const astronautSource = new VectorSource()
    const astronaut = new Feature(new Point(initialCenter))
    const view = new View({
      projection,
      center: initialCenter,
      zoom: 5.3,
      minZoom: 3.5,
      maxZoom: 7,
      extent: bootstrap.bounds_projected,
    })
    const map = new OlMap({
      target: target.current,
      controls: [],
      interactions: [],
      layers: [
        baseLayer,
        new VectorLayer({ source: routeSource }),
        new VectorLayer({ source: completedSource }),
        new VectorLayer({ source: missionSource }),
        new VectorLayer({ source: astronautSource }),
      ],
      view,
    })
    mapRef.current = map

    const refreshMission = () => {
      const current = useMissionStore.getState()
      missionSource.clear()
      if (!current.mission) return
      const habitat = new Feature(new Point(coordinateToProjected(current.mission.habitat)))
      habitat.setStyle(new Style({
        image: new RegularShape({ points: 4, radius: 11, angle: Math.PI / 4, fill: new Fill({ color: '#141c1a' }), stroke: new Stroke({ color: '#f4f5f1', width: 1.5 }) }),
        text: new Text({ text: 'H', offsetY: 1, font: '700 11px "IBM Plex Mono", monospace', fill: new Fill({ color: '#f4f5f1' }) }),
      }))
      missionSource.addFeature(habitat)
      for (const [index, stop] of current.mission.route_stops.entries()) {
        let coordinate
        if (stop.type === 'custom') {
          coordinate = { longitude: stop.longitude, latitude: stop.latitude }
        } else {
          const feature = bootstrap.waypoints.features.find((item) => item.properties?.id === stop.id)
          if (!feature) continue
          coordinate = { longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1] }
        }
        const marker = new Feature(new Point(coordinateToProjected(coordinate)))
        marker.setStyle(new Style({
          image: new Circle({ radius: 8, fill: new Fill({ color: '#f4f5f1' }), stroke: new Stroke({ color: '#141c1a', width: 1.5 }) }),
          text: new Text({ text: String(index + 1), offsetY: 1, font: '700 11px "IBM Plex Mono", monospace', fill: new Fill({ color: '#141c1a' }) }),
        }))
        missionSource.addFeature(marker)
      }
    }

    const activeRoute = () => {
      const current = useMissionStore.getState()
      return current.activeRoute === 'alternative' ? current.plan?.alternative : current.plan?.primary
    }

    const refreshCompletedRoute = () => {
      const current = useMissionStore.getState()
      completedSource.clear()
      if (current.walkTelemetry?.mode === 'guided' && current.walkTelemetry.routeIndex !== null && current.walkTelemetry.routeIndex > 0) {
        addRoute(completedSource, activeRoute(), lineStyle('#ffffff', 4), current.walkTelemetry.routeIndex)
      }
    }

    const refreshRoutes = () => {
      const current = useMissionStore.getState()
      routeSource.clear()
      addRoute(routeSource, activeRoute(), lineStyle('#5fd0f0', 3))
      addRoute(routeSource, current.emergencyRoute, lineStyle('#ff5d73', 3, [7, 5]))
      refreshCompletedRoute()
    }

    const refreshAstronaut = () => {
      const telemetry = useMissionStore.getState().walkTelemetry
      if (!telemetry) return
      astronaut.setGeometry(new Point(telemetry.projectedPosition))
      astronaut.setStyle(new Style({
        image: new RegularShape({
          points: 3,
          radius: 10,
          rotation: telemetry.headingRad,
          fill: new Fill({ color: '#ffffff' }),
          stroke: new Stroke({ color: '#141c1a', width: 3 }),
        }),
      }))
      if (!astronautSource.hasFeature(astronaut)) astronautSource.addFeature(astronaut)
      view.setCenter(telemetry.projectedPosition)
    }

    refreshMission()
    refreshRoutes()
    refreshAstronaut()

    const unsubscribe = useMissionStore.subscribe((current, previous) => {
      if (current.walkTelemetry !== previous.walkTelemetry) {
        refreshAstronaut()
        refreshCompletedRoute()
      }
      if (current.mission !== previous.mission) refreshMission()
      if (current.plan !== previous.plan || current.activeRoute !== previous.activeRoute || current.emergencyRoute !== previous.emergencyRoute) refreshRoutes()
    })
    const resizeObserver = new ResizeObserver(() => map.updateSize())
    resizeObserver.observe(target.current)

    return () => {
      unsubscribe()
      resizeObserver.disconnect()
      map.setTarget(undefined)
      mapRef.current = null
    }
  }, [bootstrap, minimapOpen])

  if (!minimapOpen) {
    return (
      <button
        className="map-transition-surface absolute right-[max(.75rem,env(safe-area-inset-right))] top-[max(.75rem,env(safe-area-inset-top))] z-20 grid size-11 place-items-center rounded border border-ink bg-panel text-ink hover:bg-panel-2"
        onClick={() => setMinimapOpen(true)}
        aria-label="Open tracking map"
        title="Open tracking map"
      >
        <MapIcon size={18} />
      </button>
    )
  }

  const moveForEvidence = selectedWaypoint ? 'md:right-[22rem]' : ''
  return (
    <section className={`map-transition-surface absolute right-[max(.75rem,env(safe-area-inset-right))] top-[max(.75rem,env(safe-area-inset-top))] z-20 aspect-[4/3] w-[clamp(8.75rem,42vw,11.25rem)] max-h-[42svh] overflow-hidden rounded border border-ink bg-panel transition-[right] sm:w-[220px] lg:w-[260px] 2xl:w-[300px] ${moveForEvidence}`} aria-label="Astronaut tracking map">
      <div className="absolute inset-x-0 top-0 z-10 flex h-8 items-center justify-between border-b border-ink bg-panel px-2.5">
        <span className="label text-ink">Live position</span>
        <button className="grid size-7 place-items-center rounded text-ink-3 hover:bg-panel-2 hover:text-ink" onClick={() => setMinimapOpen(false)} aria-label="Collapse tracking map" title="Collapse map"><ChevronDown size={15} /></button>
      </div>
      <div className="absolute inset-0 pt-8" ref={target} />
      <div className="absolute bottom-2 right-2 z-10 flex overflow-hidden rounded border border-ink bg-panel">
        <button className="grid size-7 place-items-center text-ink-2 hover:text-ink" onClick={() => { const view = mapRef.current?.getView(); if (view) view.setZoom(Math.min(view.getMaxZoom(), (view.getZoom() ?? 5.3) + 0.5)) }} aria-label="Zoom tracking map in"><Plus size={13} /></button>
        <button className="grid size-7 place-items-center border-l border-ink text-ink-2 hover:text-ink" onClick={() => { const view = mapRef.current?.getView(); if (view) view.setZoom(Math.max(view.getMinZoom(), (view.getZoom() ?? 5.3) - 0.5)) }} aria-label="Zoom tracking map out"><Minus size={13} /></button>
      </div>
    </section>
  )
}

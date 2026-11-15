import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import Map from 'ol/Map'
import View from 'ol/View'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import CircleGeometry from 'ol/geom/Circle'
import LineString from 'ol/geom/LineString'
import Point from 'ol/geom/Point'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import { transform } from 'ol/proj'
import ImageStatic from 'ol/source/ImageStatic'
import VectorSource from 'ol/source/Vector'
import Translate from 'ol/interaction/Translate'
import { Circle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style'
import 'ol/ol.css'
import { useMissionStore } from '../store'
import { api } from '../api'
import { createMarsProjection, MARS_RADIUS_M } from '../lib/marsProjection'
import type { CustomRouteStop } from '../types'

const PAPER = '#f4f5f1'
const INK = '#141c1a'
const ROUTE = '#5fd0f0'
const LABEL_FONT = '600 12px "Archivo Variable", sans-serif'
const MARK_FONT = '700 13px "IBM Plex Mono", monospace'

const lineStyle = (color: string, width: number, dash?: number[]) => new Style({
  stroke: new Stroke({ color, width, lineDash: dash, lineCap: dash ? 'butt' : 'round', lineJoin: 'round' }),
})
// A dark casing keeps the traverse legible over both bright dunes and shadowed scarps.
const casedLine = (color: string, width: number) => [lineStyle('rgba(20, 28, 26, .7)', width + 3), lineStyle(color, width)]

const label = (text: string, offsetY: number) => new Text({
  text, offsetY, font: LABEL_FONT, fill: new Fill({ color: INK }), stroke: new Stroke({ color: PAPER, width: 4 }),
})

/** Stops on the route carry the same number as the traverse table; other targets stay small and labelled by id. */
const stationStyle = (order: number, name: string, isHovered: boolean, isSelected: boolean) => {
  const emphasised = isHovered || isSelected
  if (order < 1) {
    return new Style({
      image: new Circle({ radius: emphasised ? 7 : 5, fill: new Fill({ color: PAPER }), stroke: new Stroke({ color: emphasised ? '#0b6e8a' : INK, width: emphasised ? 3 : 2 }) }),
      text: label(name, emphasised ? -18 : -15),
    })
  }
  return [
    new Style({
      image: new Circle({ radius: emphasised ? 13 : 11, fill: new Fill({ color: isSelected ? INK : PAPER }), stroke: new Stroke({ color: isHovered ? ROUTE : INK, width: isHovered ? 3 : 2 }) }),
      text: new Text({ text: String(order), offsetY: 1, font: MARK_FONT, fill: new Fill({ color: isSelected ? PAPER : INK }) }),
    }),
    ...(emphasised ? [new Style({ text: label(name, -24) })] : []),
  ]
}

const habitatStyle = () => new Style({
  image: new RegularShape({ points: 4, radius: 15, angle: Math.PI / 4, fill: new Fill({ color: INK }), stroke: new Stroke({ color: PAPER, width: 2 }) }),
  text: new Text({ text: 'H', offsetY: 1, font: MARK_FONT, fill: new Fill({ color: PAPER }) }),
})

const SCALE_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]

export function MarsMap({ readOnly = false }: { readOnly?: boolean }) {
  const target = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const bootstrap = useMissionStore((state) => state.bootstrap)
  const mission = useMissionStore((state) => state.mission)
  const plan = useMissionStore((state) => state.plan)
  const emergencyRoute = useMissionStore((state) => state.emergencyRoute)
  const visibility = useMissionStore((state) => state.layerVisibility)
  const opacity = useMissionStore((state) => state.layerOpacity)
  const placementMode = useMissionStore((state) => state.placementMode)
  const setHabitat = useMissionStore((state) => state.setHabitat)
  const setSelectedWaypoint = useMissionStore((state) => state.setSelectedWaypoint)
  const [scale, setScale] = useState<{ meters: number; pixels: number } | null>(null)

  useEffect(() => {
    if (!target.current || !bootstrap || !mission) return
    const projection = createMarsProjection(bootstrap.bounds_projected)
    const imageLayers = bootstrap.layers.map((layer) => new ImageLayer({
      properties: { layerId: layer.id },
      source: new ImageStatic({ url: layer.url, imageExtent: bootstrap.bounds_projected, projection }),
      visible: visibility[layer.id] ?? false,
      opacity: layer.id === 'imagery' ? 1 : opacity,
    }))

    const geologySource = new VectorSource({
      features: new GeoJSON().readFeatures(bootstrap.geology, { dataProjection: 'EPSG:4326', featureProjection: projection }),
    })
    const geologyLayer = new VectorLayer({
      properties: { layerId: 'geology' }, source: geologySource,
      visible: visibility.geology,
      style: new Style({ fill: new Fill({ color: 'rgba(244, 245, 241, .05)' }), stroke: new Stroke({ color: 'rgba(244, 245, 241, .62)', width: 1 }) }),
    })
    const traverseLayer = new VectorLayer({
      properties: { layerId: 'traverse' },
      source: new VectorSource({ features: new GeoJSON().readFeatures(bootstrap.traverse, { dataProjection: 'EPSG:4326', featureProjection: projection }) }),
      visible: visibility.traverse,
      style: lineStyle('rgba(244, 245, 241, .75)', 1.5, [2, 5]),
    })
    const missionSource = new VectorSource()
    const missionLayer = new VectorLayer({ source: missionSource })
    const envelopeSource = new VectorSource()
    const envelopeLayer = new VectorLayer({
      source: envelopeSource,
      style: (feature) => {
        const safe = feature.get('state') === 'safe'
        return new Style({
          fill: new Fill({ color: safe ? 'rgba(38, 192, 132, .08)' : 'rgba(242, 198, 109, .08)' }),
          stroke: new Stroke({ color: safe ? 'rgba(81, 212, 154, .5)' : 'rgba(242, 198, 109, .48)', width: 1, lineDash: [5, 5] }),
        })
      },
    })
    const routeSource = new VectorSource()
    const routeLayer = new VectorLayer({ source: routeSource })
    const trackingSource = new VectorSource()
    const trackingLayer = new VectorLayer({ source: trackingSource })
    const astronaut = new Feature(new Point([0, 0]))
    const updateAstronaut = () => {
      const telemetry = useMissionStore.getState().walkTelemetry
      trackingSource.clear()
      // Before the walk starts the astronaut is at the habitat, which already has its own mark.
      if (!telemetry || telemetry.updatedAt === 0) return
      astronaut.setGeometry(new Point(telemetry.projectedPosition))
      astronaut.setStyle([
        new Style({ image: new Circle({ radius: 16, fill: new Fill({ color: 'rgba(95, 208, 240, .22)' }), stroke: new Stroke({ color: ROUTE, width: 2 }) }) }),
        new Style({
          image: new RegularShape({
            points: 3,
            radius: 11,
            rotation: telemetry.headingRad,
            fill: new Fill({ color: '#ffffff' }),
            stroke: new Stroke({ color: INK, width: 3 }),
          }),
          text: label('You are here', 26),
        }),
      ])
      trackingSource.addFeature(astronaut)
    }
    updateAstronaut()

    const bounds = bootstrap.bounds_projected
    const centerX = (bounds[0] + bounds[2]) / 2
    const centerY = (bounds[1] + bounds[3]) / 2
    const extentW = bounds[2] - bounds[0]
    const extentH = bounds[3] - bounds[1]
    const initialTelemetry = useMissionStore.getState().walkTelemetry
    const returningFromMarsWalk = Boolean(initialTelemetry && initialTelemetry.updatedAt > 0)
    const initialCenter = returningFromMarsWalk ? initialTelemetry!.projectedPosition : [centerX, centerY]

    // Immersive full-viewport view without pillarboxing or empty borders
    const view = new View({
      projection,
      center: initialCenter,
      zoom: returningFromMarsWalk ? (readOnly ? 4.5 : 6) : 2.8,
      minZoom: 2.2,
      maxZoom: 7,
      extent: [bounds[0] - 800, bounds[1] - 800, bounds[2] + 800, bounds[3] + 800],
      smoothExtentConstraint: true,
      showFullExtent: false,
    })

    const map = new Map({
      target: target.current,
      layers: [...imageLayers, geologyLayer, traverseLayer, envelopeLayer, routeLayer, missionLayer, trackingLayer],
      view,
      controls: [],
    })
    mapRef.current = map

    // Seamlessly fit to COVER the viewport so left/right/top/bottom are completely filled
    const adjustCover = () => {
      const size = map.getSize()
      if (size && size[0] > 0 && size[1] > 0) {
        const coverRes = Math.min(extentW / size[0], extentH / size[1])
        const coverZoom = view.getZoomForResolution(coverRes) ?? 2.8
        view.setMinZoom(Math.max(1.8, coverZoom - 0.25))
        if ((view.getZoom() ?? 0) < coverZoom) {
          view.setResolution(coverRes)
          view.setCenter([centerX, centerY])
        }
        if (returningFromMarsWalk && initialTelemetry) {
          view.centerOn(initialTelemetry.projectedPosition, size, [size[0] * 0.5, size[1] * 0.5])
        }
      }
    }
    let fitted = returningFromMarsWalk
    // Open on the whole traverse rather than wherever the sheet happens to be centred.
    const fitRoute = () => {
      const size = map.getSize()
      const extent = routeSource.getExtent()
      if (fitted || !size || size[0] === 0 || routeSource.isEmpty() || !extent) return
      view.fit(extent, { size, padding: [56, 64, 56, 64], maxZoom: 5 })
      fitted = true
    }
    window.requestAnimationFrame(() => { adjustCover(); fitRoute() })

    // The map shares the sheet with docked panels, so follow its own box rather than the window.
    const resizeObserver = new ResizeObserver(() => { map.updateSize(); adjustCover() })
    resizeObserver.observe(target.current)

    const updateScale = () => {
      const resolution = view.getResolution()
      const center = view.getCenter()
      if (!resolution || !center) return
      // Equirectangular metres stretch east-west away from the equator.
      const groundPerPixel = resolution * Math.cos(center[1] / MARS_RADIUS_M)
      const meters = [...SCALE_STEPS].reverse().find((step) => step / groundPerPixel <= 140) ?? SCALE_STEPS[0]
      setScale({ meters, pixels: meters / groundPerPixel })
    }
    view.on('change:resolution', updateScale)
    view.on('change:center', updateScale)
    updateScale()

    const orderOf = (id: string) => (useMissionStore.getState().mission?.route_stops.findIndex((stop) => stop.id === id) ?? -1) + 1

    const addMissionFeatures = () => {
      missionSource.clear()
      const currentMission = useMissionStore.getState().mission
      if (!currentMission) return
      const habitatPoint = transform([currentMission.habitat.longitude, currentMission.habitat.latitude], 'EPSG:4326', projection)
      const zoneCenter = transform([bootstrap.habitat_zone.center.longitude, bootstrap.habitat_zone.center.latitude], 'EPSG:4326', projection)
      const zone = new Feature(new CircleGeometry(zoneCenter, bootstrap.habitat_zone.radius_m))
      zone.setStyle(new Style({ fill: new Fill({ color: 'rgba(244, 245, 241, .08)' }), stroke: new Stroke({ color: PAPER, width: 1.5, lineDash: [4, 5] }) }))
      missionSource.addFeature(zone)
      const habitat = new Feature({ geometry: new Point(habitatPoint), kind: 'habitat' })
      habitat.setStyle(habitatStyle())
      missionSource.addFeature(habitat)
      const initialHovered = useMissionStore.getState().hoveredWaypoint
      const initialSelected = useMissionStore.getState().selectedWaypoint
      for (const featureData of bootstrap.waypoints.features) {
        const feature = new GeoJSON().readFeature(featureData, { dataProjection: 'EPSG:4326', featureProjection: projection }) as Feature
        const wid = featureData.properties?.id ?? ''
        feature.set('waypointId', wid)
        feature.setStyle(stationStyle(orderOf(wid), wid, initialHovered === wid, initialSelected === wid))
        missionSource.addFeature(feature)
      }
      for (const stop of currentMission.route_stops) {
        if (stop.type !== 'custom') continue
        const order = orderOf(stop.id)
        const feature = new Feature({ geometry: new Point(transform([stop.longitude, stop.latitude], 'EPSG:4326', projection)), customStopId: stop.id })
        feature.setStyle([...[stationStyle(order, stop.name, false, false)].flat(), new Style({ text: label(stop.name, -22) })])
        missionSource.addFeature(feature)
      }
      const draft = useMissionStore.getState().draftStop
      if (draft) {
        const preview = new Feature(new Point(transform([draft.longitude, draft.latitude], 'EPSG:4326', projection)))
        preview.setStyle(new Style({ image: new Circle({ radius: 11, fill: new Fill({ color: 'rgba(244, 245, 241, .35)' }), stroke: new Stroke({ color: PAPER, width: 2, lineDash: [4, 3] }) }) }))
        missionSource.addFeature(preview)
      }
    }
    addMissionFeatures()

    const refreshRoutes = () => {
      const state = useMissionStore.getState()
      routeSource.clear()
      envelopeSource.clear()
      if (state.plan?.return_envelope) {
        envelopeSource.addFeatures(new GeoJSON().readFeatures(state.plan.return_envelope, { dataProjection: 'EPSG:4326', featureProjection: projection }))
      }
      const current = state.activeRoute === 'alternative' ? state.plan?.alternative : state.plan?.primary
      const other = state.activeRoute === 'alternative' ? state.plan?.primary : state.plan?.alternative
      const addRoute = (route: typeof current, style: Style | Style[]) => {
        if (!route) return
        const coordinates = route.coordinates.map(([lon, lat]) => transform([lon, lat], 'EPSG:4326', projection))
        const feature = new Feature(new LineString(coordinates))
        feature.setStyle(style)
        routeSource.addFeature(feature)
      }
      addRoute(other, lineStyle('rgba(244, 245, 241, .7)', 2, [8, 6]))
      addRoute(current, casedLine(ROUTE, 3.5))
      addRoute(state.emergencyRoute, [lineStyle('rgba(20, 28, 26, .7)', 7), lineStyle('#ff6b6b', 4, [9, 6])])
      fitRoute()
    }
    refreshRoutes()

    map.on('pointermove', (event) => {
      if (readOnly) return
      if (event.dragging) return
      const mode = useMissionStore.getState().placementMode
      if (mode) return

      let hitId: string | null = null
      map.forEachFeatureAtPixel(event.pixel, (feature) => {
        const id = (feature.get('waypointId') ?? feature.get('customStopId')) as string | undefined
        if (id) {
          hitId = id
          return true
        }
      })

      const targetEl = map.getTargetElement()
      if (targetEl) targetEl.style.cursor = hitId ? 'pointer' : ''
      const currentHovered = useMissionStore.getState().hoveredWaypoint
      if (currentHovered !== hitId) {
        useMissionStore.getState().setHoveredWaypoint(hitId)
      }
    })

    map.on('singleclick', (event) => {
      if (readOnly) return
      const mode = useMissionStore.getState().placementMode
      if (mode) {
        const [longitude, latitude] = transform(event.coordinate, projection, 'EPSG:4326')
        if (mode === 'stop') {
          void useMissionStore.getState().previewStop({ longitude, latitude })
        } else {
          const center = transform([bootstrap.habitat_zone.center.longitude, bootstrap.habitat_zone.center.latitude], 'EPSG:4326', projection)
          if (Math.hypot(event.coordinate[0] - center[0], event.coordinate[1] - center[1]) <= bootstrap.habitat_zone.radius_m) {
            setHabitat({ longitude, latitude })
            queueMicrotask(() => useMissionStore.getState().calculate())
          }
        }
        return
      }
      let hitId: string | null = null
      map.forEachFeatureAtPixel(event.pixel, (feature) => {
        const id = (feature.get('waypointId') ?? feature.get('customStopId')) as string | undefined
        if (id) {
          hitId = id
          return true
        }
      })
      const currentSelected = useMissionStore.getState().selectedWaypoint
      setSelectedWaypoint(currentSelected === hitId ? null : hitId)
    })

    const translateInteraction = new Translate({ layers: [missionLayer], filter: (feature) => Boolean(feature.get('customStopId')) })
    translateInteraction.on('translateend', (event) => {
      const feature = event.features.item(0)
      const id = feature?.get('customStopId') as string | undefined
      const coordinate = (feature?.getGeometry() as Point | undefined)?.getCoordinates()
      if (!id || !coordinate) return
      const [longitude, latitude] = transform(coordinate, projection, 'EPSG:4326')
      void api.validateWaypoint({ longitude, latitude }).then((result) => {
        if (result.valid) {
          useMissionStore.getState().updateStop(id, { longitude, latitude })
          void useMissionStore.getState().calculate()
        } else addMissionFeatures()
      }).catch(() => addMissionFeatures())
    })
    if (!readOnly) map.addInteraction(translateInteraction)

    const unsubscribe = useMissionStore.subscribe((state, previous) => {
      if (state.mission !== previous.mission) {
        addMissionFeatures()
      }
      if (state.hoveredWaypoint !== previous.hoveredWaypoint || state.selectedWaypoint !== previous.selectedWaypoint) {
        missionSource.getFeatures().forEach((feature) => {
          const wid = feature.get('waypointId') as string | undefined
          if (wid) {
            const isHovered = state.hoveredWaypoint === wid
            const isSelected = state.selectedWaypoint === wid
            feature.setStyle(stationStyle(orderOf(wid), wid, isHovered, isSelected))
          }
          const cid = feature.get('customStopId') as string | undefined
          if (cid) {
            const isHovered = state.hoveredWaypoint === cid
            const isSelected = state.selectedWaypoint === cid
            const stop = state.mission?.route_stops.find((s): s is CustomRouteStop => s.id === cid && s.type === 'custom')
            const name = stop?.name ?? cid
            feature.setStyle(new Style({
              image: new Circle({
                radius: isSelected ? 12 : (isHovered ? 10 : 8),
                fill: new Fill({ color: isSelected ? '#ffcc00' : (isHovered ? '#8be9fd' : '#62c7e8') }),
                stroke: new Stroke({ color: '#07141a', width: isSelected ? 4 : 3 }),
              }),
              text: new Text({ text: name, offsetY: -20, font: '600 12px Inter', fill: new Fill({ color: '#dff7ff' }), stroke: new Stroke({ color: '#111', width: 4 }) }),
            }))
          }
        })
      }
      if (state.draftStop !== previous.draftStop) addMissionFeatures()
      if (state.plan !== previous.plan || state.emergencyRoute !== previous.emergencyRoute || state.activeRoute !== previous.activeRoute) {
        refreshRoutes()
      }
      if (state.walkTelemetry !== previous.walkTelemetry) updateAstronaut()
    })

    return () => {
      resizeObserver.disconnect()
      unsubscribe()
      map.setTarget(undefined)
      mapRef.current = null
    }
  }, [bootstrap, readOnly])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getLayers().forEach((layer) => {
      const id = layer.get('layerId') as string | undefined
      if (id) {
        layer.setVisible(visibility[id] ?? false)
        if (id !== 'imagery') layer.setOpacity(opacity)
      }
    })
  }, [visibility, opacity])

  const handleZoomIn = () => {
    const map = mapRef.current
    if (!map) return
    const view = map.getView()
    const zoom = view.getZoom() ?? 2.8
    view.animate({ zoom: Math.min(view.getMaxZoom(), zoom + 0.5), duration: 200 })
  }

  const handleZoomOut = () => {
    const map = mapRef.current
    if (!map) return
    const view = map.getView()
    const zoom = view.getZoom() ?? 2.8
    view.animate({ zoom: Math.max(view.getMinZoom(), zoom - 0.5), duration: 200 })
  }

  return (
    <>
      <div className={`mars-map map-transition-surface size-full touch-none select-none ${placementMode && !readOnly ? 'is-placing' : ''}`} ref={target} aria-label="Interactive Jezero mission map" />
      {readOnly && <div className="absolute left-3 top-3 z-20 flex flex-wrap gap-2">
        <button className="rounded border border-ink bg-panel px-3 py-2 text-xs font-medium text-ink hover:bg-panel-2" onClick={() => {
          const position = useMissionStore.getState().walkTelemetry?.projectedPosition
          if (position) mapRef.current?.getView().animate({ center: position, zoom: 5, duration: 200 })
        }}>Locate astronaut</button>
        <button className="rounded border border-ink bg-panel px-3 py-2 text-xs font-medium text-ink hover:bg-panel-2" onClick={() => {
          if (bootstrap) mapRef.current?.getView().fit(bootstrap.bounds_projected, { padding: [40, 40, 40, 40], duration: 200 })
        }}>Show full area</button>
      </div>}
      {scale && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 bg-panel/90 px-2 pb-1 pt-1.5" aria-label={`Scale bar: ${scale.meters} metres`}>
          <div className="h-1.5 border-x border-b border-ink" style={{ width: `${scale.pixels}px` }} />
          <span className="num mt-0.5 block text-[11px] leading-none text-ink">{scale.meters >= 1000 ? `${scale.meters / 1000} km` : `${scale.meters} m`}</span>
        </div>
      )}
      <div className="absolute bottom-3 right-3 z-20 flex flex-col border border-ink bg-panel">
        <button onClick={handleZoomIn} className="grid size-9 place-items-center border-b border-ink text-ink hover:bg-panel-2" title="Zoom in" aria-label="Zoom In">
          <Plus size={15} />
        </button>
        <button onClick={handleZoomOut} className="grid size-9 place-items-center text-ink hover:bg-panel-2" title="Zoom out" aria-label="Zoom Out">
          <Minus size={15} />
        </button>
      </div>
    </>
  )
}


import { useEffect, useRef } from 'react'
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
import { createMarsProjection } from '../lib/marsProjection'

const routeStyle = (color: string, width: number, dash?: number[]) => new Style({
  stroke: new Stroke({ color, width, lineDash: dash }),
})

const createWaypointStyle = (id: string, isHovered: boolean, isSelected: boolean) => new Style({
  image: new Circle({
    radius: isHovered || isSelected ? 10 : 7,
    fill: new Fill({ color: isHovered ? '#ffffff' : isSelected ? '#62c7e8' : '#ffb86c' }),
    stroke: new Stroke({ color: isHovered ? '#00e5ff' : isSelected ? '#ffffff' : '#17110c', width: isHovered ? 4 : isSelected ? 3.5 : 3 }),
  }),
  text: new Text({
    text: id,
    offsetY: isHovered || isSelected ? -22 : -18,
    font: isHovered || isSelected ? 'bold 13px Inter, sans-serif' : '600 12px Inter, sans-serif',
    fill: new Fill({ color: isHovered ? '#00e5ff' : isSelected ? '#62c7e8' : '#fff5e9' }),
    stroke: new Stroke({ color: '#111', width: 4 }),
  }),
})

export function MarsMap() {
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
      style: new Style({ fill: new Fill({ color: 'rgba(244, 170, 92, .10)' }), stroke: new Stroke({ color: 'rgba(255, 198, 128, .58)', width: 1 }) }),
    })
    const traverseLayer = new VectorLayer({
      properties: { layerId: 'traverse' },
      source: new VectorSource({ features: new GeoJSON().readFeatures(bootstrap.traverse, { dataProjection: 'EPSG:4326', featureProjection: projection }) }),
      visible: visibility.traverse,
      style: routeStyle('rgba(255,255,255,.6)', 1.5, [5, 6]),
    })
    const missionSource = new VectorSource()
    const missionLayer = new VectorLayer({ source: missionSource })
    const envelopeSource = new VectorSource()
    const envelopeLayer = new VectorLayer({
      source: envelopeSource,
      style: (feature) => {
        const safe = feature.get('state') === 'safe'
        return new Style({
          fill: new Fill({ color: safe ? 'rgba(38, 192, 132, .09)' : 'rgba(242, 198, 109, .08)' }),
          stroke: new Stroke({ color: safe ? 'rgba(81, 212, 154, .5)' : 'rgba(242, 198, 109, .48)', width: 1, lineDash: [5, 5] }),
        })
      },
    })
    const routeSource = new VectorSource()
    const routeLayer = new VectorLayer({ source: routeSource })
    const trackingSource = new VectorSource()
    const trackingLayer = new VectorLayer({ source: trackingSource, properties: { layerId: 'astronaut' } })
    const astronaut = new Feature(new Point([0, 0]))
    const updateAstronaut = () => {
      const telemetry = useMissionStore.getState().walkTelemetry
      trackingSource.clear()
      if (!telemetry) return
      astronaut.setGeometry(new Point(telemetry.projectedPosition))
      astronaut.setStyle(new Style({
        image: new RegularShape({
          points: 3,
          radius: 11,
          rotation: telemetry.headingRad,
          fill: new Fill({ color: '#ffffff' }),
          stroke: new Stroke({ color: '#082f49', width: 3 }),
        }),
        text: new Text({ text: 'ASTRONAUT', offsetY: 20, font: '700 10px Inter', fill: new Fill({ color: '#ffffff' }), stroke: new Stroke({ color: '#0a0d11', width: 4 }) }),
      }))
      trackingSource.addFeature(astronaut)
    }
    updateAstronaut()

    const bounds = bootstrap.bounds_projected
    const centerX = (bounds[0] + bounds[2]) / 2
    const centerY = (bounds[1] + bounds[3]) / 2
    const extentW = bounds[2] - bounds[0]
    const extentH = bounds[3] - bounds[1]

    // Immersive full-viewport view without pillarboxing or empty borders
    const view = new View({
      projection,
      center: [centerX, centerY],
      zoom: 2.8,
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
      }
    }
    window.requestAnimationFrame(adjustCover)
    window.addEventListener('resize', adjustCover)

    const addMissionFeatures = () => {
      missionSource.clear()
      const currentMission = useMissionStore.getState().mission
      if (!currentMission) return
      const habitatPoint = transform([currentMission.habitat.longitude, currentMission.habitat.latitude], 'EPSG:4326', projection)
      const zoneCenter = transform([bootstrap.habitat_zone.center.longitude, bootstrap.habitat_zone.center.latitude], 'EPSG:4326', projection)
      const zone = new Feature(new CircleGeometry(zoneCenter, bootstrap.habitat_zone.radius_m))
      zone.setStyle(new Style({ fill: new Fill({ color: 'rgba(76, 201, 240, .06)' }), stroke: new Stroke({ color: 'rgba(76, 201, 240, .55)', width: 1, lineDash: [4, 5] }) }))
      missionSource.addFeature(zone)
      const habitat = new Feature({ geometry: new Point(habitatPoint), kind: 'habitat' })
      habitat.setStyle(new Style({ image: new Circle({ radius: 9, fill: new Fill({ color: '#4cc9f0' }), stroke: new Stroke({ color: '#07141a', width: 4 }) }), text: new Text({ text: 'HAB', offsetY: -20, font: '700 11px Inter', fill: new Fill({ color: '#bdefff' }), stroke: new Stroke({ color: '#0a0d11', width: 4 }) }) }))
      missionSource.addFeature(habitat)
      const initialHovered = useMissionStore.getState().hoveredWaypoint
      const initialSelected = useMissionStore.getState().selectedWaypoint
      for (const featureData of bootstrap.waypoints.features) {
        const feature = new GeoJSON().readFeature(featureData, { dataProjection: 'EPSG:4326', featureProjection: projection }) as Feature
        const wid = featureData.properties?.id ?? ''
        feature.set('waypointId', wid)
        feature.setStyle(createWaypointStyle(wid, initialHovered === wid, initialSelected === wid))
        missionSource.addFeature(feature)
      }
      for (const stop of currentMission.route_stops) {
        if (stop.type !== 'custom') continue
        const feature = new Feature({ geometry: new Point(transform([stop.longitude, stop.latitude], 'EPSG:4326', projection)), customStopId: stop.id })
        feature.setStyle(new Style({ image: new Circle({ radius: 8, fill: new Fill({ color: '#62c7e8' }), stroke: new Stroke({ color: '#07141a', width: 3 }) }), text: new Text({ text: stop.name, offsetY: -20, font: '600 12px Inter', fill: new Fill({ color: '#dff7ff' }), stroke: new Stroke({ color: '#111', width: 4 }) }) }))
        missionSource.addFeature(feature)
      }
      const draft = useMissionStore.getState().draftStop
      if (draft) {
        const preview = new Feature(new Point(transform([draft.longitude, draft.latitude], 'EPSG:4326', projection)))
        preview.setStyle(new Style({ image: new Circle({ radius: 10, fill: new Fill({ color: 'rgba(98,199,232,.25)' }), stroke: new Stroke({ color: '#62c7e8', width: 2, lineDash: [4, 3] }) }) }))
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
      const addRoute = (route: typeof current, color: string, width: number, dash?: number[]) => {
        if (!route) return
        const coordinates = route.coordinates.map(([lon, lat]) => transform([lon, lat], 'EPSG:4326', projection))
        const feature = new Feature(new LineString(coordinates))
        feature.setStyle(routeStyle(color, width, dash))
        routeSource.addFeature(feature)
      }
      addRoute(other, 'rgba(255,255,255,.38)', 2, [8, 8])
      addRoute(current, '#4cc9f0', 4)
      addRoute(state.emergencyRoute, '#ff5d73', 4, [8, 5])
    }
    refreshRoutes()

    map.on('pointermove', (event) => {
      if (event.dragging) return
      const mode = useMissionStore.getState().placementMode
      if (mode) return

      let hitId: string | null = null
      map.forEachFeatureAtPixel(event.pixel, (feature) => {
        const waypointId = feature.get('waypointId') as string | undefined
        if (waypointId) {
          hitId = waypointId
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
        const waypointId = feature.get('waypointId') as string | undefined
        if (waypointId) {
          hitId = waypointId
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
    map.addInteraction(translateInteraction)

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
            feature.setStyle(createWaypointStyle(wid, isHovered, isSelected))
          }
        })
      }
      if (state.draftStop !== previous.draftStop) addMissionFeatures()
      if (state.sidebarOpen !== previous.sidebarOpen) window.setTimeout(() => map.updateSize(), 220)
      if (state.plan !== previous.plan || state.emergencyRoute !== previous.emergencyRoute || state.activeRoute !== previous.activeRoute) {
        refreshRoutes()
      }
      if (state.walkTelemetry !== previous.walkTelemetry) updateAstronaut()
    })

    return () => {
      window.removeEventListener('resize', adjustCover)
      unsubscribe()
      map.setTarget(undefined)
      mapRef.current = null
    }
  }, [bootstrap])

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
      <div className={`mars-map map-transition-surface size-full touch-none select-none ${placementMode ? 'is-placing' : ''}`} ref={target} aria-label="Interactive Jezero mission map" />
      {/* 2D Discrete Zoom Controls */}
      <div className="absolute bottom-20 sm:bottom-4 right-3 z-20 flex flex-col rounded-lg border border-white/20 bg-[#0d1117] shadow-xl overflow-hidden">
        <button
          onClick={handleZoomIn}
          className="flex size-8 items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition border-b border-white/10"
          title="Zoom In"
          aria-label="Zoom In"
        >
          <Plus size={15} />
        </button>
        <button
          onClick={handleZoomOut}
          className="flex size-8 items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition"
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          <Minus size={15} />
        </button>
      </div>
    </>
  )
}


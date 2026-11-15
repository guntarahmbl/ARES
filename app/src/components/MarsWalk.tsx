import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Html, Line, Stars } from '@react-three/drei'
import {
  Activity, AlertTriangle, BatteryCharging, ChevronLeft, Compass, FastForward, Footprints, Gauge, Map, MapPin, Minus, Pause, Play,
  Plus, RotateCcw, ShieldCheck, Target, Zap
} from 'lucide-react'
import * as THREE from 'three'
import { useMissionStore } from '../store'
import { localToProjected, projectedToCoordinate } from '../lib/marsProjection'
import { useViewTransition } from '../hooks/useViewTransition'
import type { CustomRouteStop, RouteCandidate, SceneManifest, SceneTile, WalkTelemetry } from '../types'

type Position = [number, number, number]

const SPEED_STEPS = [1, 8, 32, 64, 128, 256]

function useBinary(url: string) {
  const [data, setData] = useState<Float32Array | null>(null)
  useEffect(() => {
    let active = true
    fetch(url).then((response) => response.arrayBuffer()).then((buffer) => {
      if (active) setData(new Float32Array(buffer))
    }).catch((error) => console.error(`Unable to load ${url}`, error))
    return () => { active = false }
  }, [url])
  return data
}

function OverviewTerrain({ scene }: { scene: SceneManifest }) {
  const heights = useBinary(scene.overview.url)
  const texture = useLoader(THREE.TextureLoader, '/assets/web/basemap.webp')
  const geometry = useMemo(() => {
    if (!heights) return null
    const [xMin, zMin, xMax, zMax] = scene.bounds_local
    const rows = scene.overview.rows
    const cols = scene.overview.cols
    const positions = new Float32Array(rows * cols * 3)
    const uvs = new Float32Array(rows * cols * 2)
    const indices: number[] = []
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col
        const u = col / Math.max(1, cols - 1)
        const v = row / Math.max(1, rows - 1)
        positions[index * 3] = THREE.MathUtils.lerp(xMin, xMax, u)
        positions[index * 3 + 1] = (heights[index] ?? 0) - scene.origin.elevation - 0.6
        positions[index * 3 + 2] = THREE.MathUtils.lerp(zMin, zMax, v)
        uvs[index * 2] = u
        uvs[index * 2 + 1] = 1 - v
        if (row < rows - 1 && col < cols - 1) {
          const next = index + cols
          indices.push(index, next, index + 1, next, next + 1, index + 1)
        }
      }
    }
    const output = new THREE.BufferGeometry()
    output.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    output.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    output.setIndex(indices)
    output.computeVertexNormals()
    output.computeBoundingSphere()
    return output
  }, [heights, scene.bounds_local, scene.overview, scene.origin.elevation])

  useEffect(() => () => geometry?.dispose(), [geometry])
  useEffect(() => { texture.colorSpace = THREE.SRGBColorSpace }, [texture])
  if (!geometry) return null
  return <mesh geometry={geometry}><meshStandardMaterial map={texture} roughness={1} metalness={0} /></mesh>
}

function TerrainTile({ tile, lod, elevationOffset }: { tile: SceneTile; lod: number; elevationOffset: number }) {
  const descriptor = tile.lods.find((item) => item.resolution_m === lod) ?? tile.lods.at(-1)!
  const heights = useBinary(descriptor.url)
  const texture = useLoader(THREE.TextureLoader, tile.texture_url)
  const geometry = useMemo(() => {
    if (!heights) return null
    const [xMin, zMin, xMax, zMax] = tile.bounds_local
    const positions = new Float32Array(descriptor.rows * descriptor.cols * 3)
    const uvs = new Float32Array(descriptor.rows * descriptor.cols * 2)
    const indices: number[] = []
    for (let row = 0; row < descriptor.rows; row += 1) {
      for (let col = 0; col < descriptor.cols; col += 1) {
        const index = row * descriptor.cols + col
        const u = col / Math.max(1, descriptor.cols - 1)
        const v = row / Math.max(1, descriptor.rows - 1)
        positions[index * 3] = THREE.MathUtils.lerp(xMin, xMax, u)
        positions[index * 3 + 1] = heights[index] - elevationOffset
        positions[index * 3 + 2] = THREE.MathUtils.lerp(zMin, zMax, v)
        uvs[index * 2] = u
        uvs[index * 2 + 1] = 1 - v
        if (row < descriptor.rows - 1 && col < descriptor.cols - 1) {
          const next = index + descriptor.cols
          indices.push(index, next, index + 1, next, next + 1, index + 1)
        }
      }
    }
    const output = new THREE.BufferGeometry()
    output.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    output.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    output.setIndex(indices)
    output.computeVertexNormals()
    output.computeBoundingSphere()
    return output
  }, [heights, descriptor, tile.bounds_local, elevationOffset])

  useEffect(() => () => geometry?.dispose(), [geometry])
  useEffect(() => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4 }, [texture])
  if (!geometry) return null
  return <mesh geometry={geometry} receiveShadow><meshStandardMaterial map={texture} roughness={1} metalness={0} /></mesh>
}

function TerrainWorld({ scene, avatar, compact }: { scene: SceneManifest; avatar: Position; compact: boolean }) {
  const visible = useMemo(() => scene.tiles.map((tile) => {
    const [xMin, zMin, xMax, zMax] = tile.bounds_local
    const distance = Math.hypot((xMin + xMax) / 2 - avatar[0], (zMin + zMax) / 2 - avatar[2])
    const lod = distance < (compact ? 450 : 650) ? 5 : distance < (compact ? 800 : 1100) ? 10 : 20
    return { tile, distance, lod }
  }).filter((item) => item.distance < (compact ? 1050 : 1600)), [scene.tiles, avatar[0], avatar[2], compact])

  return <group>
    <OverviewTerrain scene={scene} />
    {visible.map(({ tile, lod }) => <TerrainTile key={`${tile.id}-${lod}`} tile={tile} lod={lod} elevationOffset={scene.origin.elevation} />)}
  </group>
}

function Astronaut({ moving }: { moving: boolean }) {
  const group = useRef<THREE.Group>(null)
  const leftArm = useRef<THREE.Mesh>(null)
  const rightArm = useRef<THREE.Mesh>(null)
  const leftLeg = useRef<THREE.Mesh>(null)
  const rightLeg = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const swing = moving ? Math.sin(clock.elapsedTime * 7) * 0.45 : 0
    if (leftArm.current) leftArm.current.rotation.x = swing
    if (rightArm.current) rightArm.current.rotation.x = -swing
    if (leftLeg.current) leftLeg.current.rotation.x = -swing * 0.7
    if (rightLeg.current) rightLeg.current.rotation.x = swing * 0.7
    if (group.current) group.current.position.y = moving ? Math.abs(Math.sin(clock.elapsedTime * 7)) * 0.05 : 0
  })
  const suit = '#e8e2d7'
  const joint = '#262b31'
  return <group ref={group}>
    <mesh position={[0, 1.45, 0]} castShadow><capsuleGeometry args={[0.34, 0.55, 8, 16]} /><meshStandardMaterial color={suit} roughness={0.8} /></mesh>
    <mesh position={[0, 2.15, 0]} castShadow><sphereGeometry args={[0.38, 24, 16]} /><meshStandardMaterial color="#e4e1d8" roughness={0.7} /></mesh>
    <mesh position={[0, 2.17, -0.27]} rotation={[0.12, 0, 0]}><sphereGeometry args={[0.29, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#263846" metalness={0.45} roughness={0.25} /></mesh>
    <mesh position={[0, 1.55, 0.34]} castShadow><boxGeometry args={[0.58, 0.75, 0.28]} /><meshStandardMaterial color="#a8a59d" roughness={0.9} /></mesh>
    <mesh ref={leftArm} position={[-0.48, 1.48, 0]} castShadow><capsuleGeometry args={[0.11, 0.65, 6, 10]} /><meshStandardMaterial color={suit} /></mesh>
    <mesh ref={rightArm} position={[0.48, 1.48, 0]} castShadow><capsuleGeometry args={[0.11, 0.65, 6, 10]} /><meshStandardMaterial color={suit} /></mesh>
    <mesh ref={leftLeg} position={[-0.19, 0.55, 0]} castShadow><capsuleGeometry args={[0.14, 0.72, 6, 10]} /><meshStandardMaterial color={suit} /></mesh>
    <mesh ref={rightLeg} position={[0.19, 0.55, 0]} castShadow><capsuleGeometry args={[0.14, 0.72, 6, 10]} /><meshStandardMaterial color={suit} /></mesh>
    <mesh position={[-0.19, 0.12, -0.09]}><boxGeometry args={[0.32, 0.16, 0.52]} /><meshStandardMaterial color={joint} /></mesh>
    <mesh position={[0.19, 0.12, -0.09]}><boxGeometry args={[0.32, 0.16, 0.52]} /><meshStandardMaterial color={joint} /></mesh>
    <mesh position={[0, 1.55, -0.35]}><boxGeometry args={[0.22, 0.12, 0.03]} /><meshStandardMaterial color="#4cc9f0" emissive="#12657d" /></mesh>
  </group>
}

function routeInterpolator(points: number[][]) {
  const distances = [0]
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    distances.push(distances.at(-1)! + Math.hypot(current[0] - previous[0], current[2] - previous[2]))
  }
  const total = distances.at(-1) || 1
  return {
    total,
    at(progress: number): { position: Position; direction: THREE.Vector3; index: number } {
      const target = THREE.MathUtils.clamp(progress, 0, 1) * total
      let index = distances.findIndex((distance) => distance >= target)
      if (index <= 0) index = 1
      const start = points[index - 1]
      const end = points[index]
      const span = Math.max(1e-6, distances[index] - distances[index - 1])
      const t = (target - distances[index - 1]) / span
      return {
        position: [THREE.MathUtils.lerp(start[0], end[0], t), THREE.MathUtils.lerp(start[1], end[1], t), THREE.MathUtils.lerp(start[2], end[2], t)],
        direction: new THREE.Vector3(end[0] - start[0], 0, end[2] - start[2]).normalize(),
        index,
      }
    },
  }
}

interface CameraControllerState {
  yaw: number
  pitch: number
  distance: number
  mode: 'chase' | 'drone' | 'pov' | 'free'
  setPreset: (preset: 'chase' | 'drone' | 'pov') => void
  resetCamera: () => void
}

function Scene({
  route,
  scene,
  onTelemetry,
  touchInput,
  compact,
  cameraControllerRef,
  onCameraModeChange,
}: {
  route: RouteCandidate
  scene: SceneManifest
  onTelemetry: (telemetry: WalkTelemetry) => void
  touchInput: { forward: number; turn: number }
  compact: boolean
  cameraControllerRef: React.MutableRefObject<CameraControllerState>
  onCameraModeChange: (mode: 'chase' | 'drone' | 'pov' | 'free') => void
}) {
  const guided = useMissionStore((state) => state.guided)
  const playing = useMissionStore((state) => state.playing)
  const speed = useMissionStore((state) => state.speed)
  const progress = useMissionStore((state) => state.progress)
  const setWalkState = useMissionStore((state) => state.setMarsWalkState)
  const setWalkTelemetry = useMissionStore((state) => state.setWalkTelemetry)
  const emergencyRoute = useMissionStore((state) => state.emergencyRoute)
  const avatar = useRef<THREE.Group>(null)
  const cameraTarget = useRef(new THREE.Vector3())
  const smoothedElevation = useRef<number | null>(null)
  const keys = useRef(new Set<string>())
  const routePath = useMemo(() => routeInterpolator(route.scene_coordinates), [route])
  const overview = useBinary(scene.overview.url)
  const storedTelemetry = useMissionStore.getState().walkTelemetry
  const [avatarPosition, setAvatarPosition] = useState<Position>(() => {
    if (!guided && storedTelemetry?.mode === 'free') return storedTelemetry.localPosition
    const initial = routePath.at(progress).position
    return [initial[0], initial[1] + 0.18, initial[2]]
  })
  const direction = useRef(
    !guided && storedTelemetry?.mode === 'free'
      ? new THREE.Vector3(Math.sin(storedTelemetry.headingRad), 0, -Math.cos(storedTelemetry.headingRad))
      : routePath.at(progress).direction,
  )
  const lastStoreUpdate = useRef(0)
  const lastUiUpdate = useRef(0)
  const { camera } = useThree()

  const controller = cameraControllerRef.current

  useEffect(() => {
    controller.setPreset = (preset: 'chase' | 'drone' | 'pov') => {
      const facing = Math.atan2(direction.current.x, direction.current.z)
      if (preset === 'chase') {
        controller.yaw = facing + Math.PI
        controller.pitch = 0.35
        controller.distance = 12
      } else if (preset === 'drone') {
        controller.yaw = facing + Math.PI
        controller.pitch = 1.15
        controller.distance = 42
      } else if (preset === 'pov') {
        controller.yaw = facing + Math.PI
        controller.pitch = 0.05
        controller.distance = 0.2
      }
      controller.mode = preset
      onCameraModeChange(preset)
    }

    controller.resetCamera = () => {
      controller.setPreset('chase')
    }

    if (controller.yaw === 0) {
      const facing = Math.atan2(direction.current.x, direction.current.z)
      controller.yaw = facing + Math.PI
    }
  }, [controller, onCameraModeChange])

  useEffect(() => {
    const down = (event: KeyboardEvent) => keys.current.add(event.code)
    const up = (event: KeyboardEvent) => keys.current.delete(event.code)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  useFrame((_, delta) => {
    let next = [...avatarPosition] as Position
    let routeIndex = 0
    let currentProgress = useMissionStore.getState().progress
    if (guided) {
      let nextProgress = currentProgress
      if (playing) nextProgress = Math.min(1, nextProgress + (speed * delta) / routePath.total)
      currentProgress = nextProgress
      const sample = routePath.at(nextProgress)
      // Ground clearance offset (+0.18m) so astronaut shoes don't sink into terrain polygons
      next = [sample.position[0], sample.position[1] + 0.18, sample.position[2]]
      routeIndex = sample.index
      direction.current.copy(sample.direction)
      if (performance.now() - lastStoreUpdate.current > 100) {
        setWalkState({ progress: nextProgress, playing: nextProgress < 1 && playing })
        lastStoreUpdate.current = performance.now()
      }
    } else {
      const forward = Number(keys.current.has('KeyW') || keys.current.has('ArrowUp')) - Number(keys.current.has('KeyS') || keys.current.has('ArrowDown')) + touchInput.forward
      const turn = Number(keys.current.has('KeyA') || keys.current.has('ArrowLeft')) - Number(keys.current.has('KeyD') || keys.current.has('ArrowRight')) + touchInput.turn
      direction.current.applyAxisAngle(new THREE.Vector3(0, 1, 0), turn * delta * 1.6)
      next[0] += direction.current.x * forward * Math.min(speed, 32) * delta
      next[2] += direction.current.z * forward * Math.min(speed, 32) * delta
      const [xMin, zMin, xMax, zMax] = scene.bounds_local
      next[0] = THREE.MathUtils.clamp(next[0], xMin + 5, xMax - 5)
      next[2] = THREE.MathUtils.clamp(next[2], zMin + 5, zMax - 5)
      if (overview) {
        const col = Math.round((next[0] - xMin) / (xMax - xMin) * (scene.overview.cols - 1))
        const row = Math.round((next[2] - zMin) / (zMax - zMin) * (scene.overview.rows - 1))
        const sampled = overview[Math.max(0, Math.min(scene.overview.rows - 1, row)) * scene.overview.cols + Math.max(0, Math.min(scene.overview.cols - 1, col))]
        if (Number.isFinite(sampled)) next[1] = sampled - scene.origin.elevation + 0.18
      }
    }
    setAvatarPosition(next)
    if (performance.now() - lastUiUpdate.current > 100) {
      const projectedPosition = localToProjected(scene, next)
      const telemetry: WalkTelemetry = {
        localPosition: next,
        projectedPosition,
        coordinate: projectedToCoordinate(projectedPosition),
        headingRad: Math.atan2(direction.current.x, -direction.current.z),
        routeIndex: guided ? routeIndex : null,
        progress: currentProgress,
        mode: guided ? 'guided' : 'free',
        updatedAt: performance.now(),
      }
      setWalkTelemetry(telemetry)
      onTelemetry(telemetry)
      lastUiUpdate.current = performance.now()
    }
    if (avatar.current) {
      avatar.current.position.set(...next)
      // Rotate 180 deg so astronaut visor faces forward along movement trajectory (not moonwalking backwards)
      avatar.current.rotation.y = Math.atan2(direction.current.x, direction.current.z) + Math.PI
    }

    // Always-on camera elevation stabilizer
    if (smoothedElevation.current === null) {
      smoothedElevation.current = next[1]
    } else {
      smoothedElevation.current = THREE.MathUtils.damp(smoothedElevation.current, next[1], 4.2, delta)
    }

    const isPov = controller.mode === 'pov' || controller.distance <= 0.6
    if (avatar.current) {
      avatar.current.visible = !isPov
    }

    const targetHeight = isPov ? 1.65 : 1.35
    const rawTarget = new THREE.Vector3(next[0], smoothedElevation.current + targetHeight, next[2])
    cameraTarget.current.lerp(rawTarget, 1 - Math.exp(-delta * 8.0))

    if (isPov) {
      // First person view from inside helmet facing in current yaw/pitch
      const lookDir = new THREE.Vector3(
        -Math.sin(controller.yaw),
        Math.sin(-controller.pitch),
        -Math.cos(controller.yaw)
      ).normalize()
      camera.position.lerp(rawTarget, 1 - Math.exp(-delta * 9.0))
      camera.lookAt(rawTarget.clone().add(lookDir.multiplyScalar(10)))
    } else {
      // 360° orbit view with zero auto-realign
      const cosPitch = Math.cos(controller.pitch)
      const dx = controller.distance * cosPitch * Math.sin(controller.yaw)
      const dy = controller.distance * Math.sin(controller.pitch)
      const dz = controller.distance * cosPitch * Math.cos(controller.yaw)

      const groundLimit = smoothedElevation.current + 0.35
      const desiredY = Math.max(groundLimit, rawTarget.y + dy)
      const desiredPos = new THREE.Vector3(next[0] + dx, desiredY, next[2] + dz)

      camera.position.lerp(desiredPos, 1 - Math.exp(-delta * 7.5))
      camera.lookAt(cameraTarget.current)
    }
  })

  return <>
    <color attach="background" args={['#c75f32']} />
    <fog attach="fog" args={['#b95a35', 800, 2600]} />
    <ambientLight intensity={1.25} />
    <directionalLight position={[600, 900, -500]} intensity={2.4} color="#ffe0b5" castShadow={false} />
    <hemisphereLight color="#ffd3ac" groundColor="#4d2118" intensity={0.65} />
    <TerrainWorld scene={scene} avatar={avatarPosition} compact={compact} />
    <Line points={route.scene_coordinates.map((point) => [point[0], point[1] + 0.45, point[2]] as Position)} color="#38d4f8" lineWidth={2.2} transparent opacity={0.85} />
    {emergencyRoute && <Line points={emergencyRoute.scene_coordinates.map((point) => [point[0], point[1] + 0.7, point[2]] as Position)} color="#ff6579" lineWidth={3} dashed dashSize={12} gapSize={8} />}
    <group ref={avatar}><Astronaut moving={playing || !guided} /></group>
    <WaypointMarkers scene={scene} />
    <Stars radius={2500} depth={200} count={400} factor={2} saturation={0.2} fade speed={0.1} />
  </>
}

function WaypointMarkers({ scene: _scene }: { scene: SceneManifest }) {
  const mission = useMissionStore((state) => state.mission)!
  const bootstrap = useMissionStore((state) => state.bootstrap)!
  const route = useMissionStore((state) => state.plan?.primary)
  if (!route) return null
  return <>{mission.route_stops.map((stop) => {
    const visit = route.stop_visits.find((item) => item.id === stop.id)
    if (!visit) return null
    const [x, y, z] = route.scene_coordinates[visit.route_vertex_index]
    const label = stop.type === 'custom' ? stop.name : (bootstrap.waypoints.features.find((f) => f.properties.id === stop.id)?.properties.name ?? stop.id)
    const color = stop.type === 'custom' ? '#62c7e8' : '#ffb86c'
    return <group key={stop.id} position={[x, y + 0.2, z]}>
      <mesh position={[0, 6, 0]}><cylinderGeometry args={[0.18, 0.18, 12, 8]} /><meshBasicMaterial color={color} transparent opacity={0.65} /></mesh>
      <mesh position={[0, 12, 0]}><octahedronGeometry args={[1.2]} /><meshStandardMaterial color={color} emissive={stop.type === 'custom' ? '#16495a' : '#6b2d12'} /></mesh>
      <Html position={[0, 14.5, 0]} center distanceFactor={22}><button className="rounded border border-white/20 bg-[#0d1117] px-2.5 py-1 text-xs font-mono font-medium text-white shadow-md hover:bg-white/10" onClick={() => useMissionStore.getState().setSelectedWaypoint(stop.id)}>{label}</button></Html>
    </group>
  })}</>
}

export default function MarsWalk() {
  const bootstrap = useMissionStore((state) => state.bootstrap)!
  const plan = useMissionStore((state) => state.plan)!
  const activeRoute = useMissionStore((state) => state.activeRoute)
  const route = (activeRoute === 'alternative' ? plan.alternative : plan.primary)!
  const mission = useMissionStore((state) => state.mission)!
  const guided = useMissionStore((state) => state.guided)
  const playing = useMissionStore((state) => state.playing)
  const speed = useMissionStore((state) => state.speed)
  const progress = useMissionStore((state) => state.progress)
  const walkTelemetry = useMissionStore((state) => state.walkTelemetry)
  const setWalkState = useMissionStore((state) => state.setMarsWalkState)
  const applyEnergyLoss = useMissionStore((state) => state.applyEnergyLoss)
  const requestEmergency = useMissionStore((state) => state.requestEmergencyReturn)
  const selectedWaypoint = useMissionStore((state) => state.selectedWaypoint)
  const { transitionTo } = useViewTransition()
  const [routeIndex, setRouteIndex] = useState(0)
  const [compact, setCompact] = useState(() => window.innerWidth < 768)
  const [touchInput, setTouchInput] = useState({ forward: 0, turn: 0 })
  const [cameraMode, setCameraMode] = useState<'chase' | 'drone' | 'pov'>('chase')
  const cameraControllerRef = useRef<CameraControllerState>({
    yaw: 0,
    pitch: 0.35,
    distance: 12,
    mode: 'chase',
    setPreset: () => {},
    resetCamera: () => {},
  })
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const routeCoordinate = route.coordinates[Math.min(routeIndex, route.coordinates.length - 1)]
  const coordinate = walkTelemetry?.coordinate ?? { longitude: routeCoordinate[0], latitude: routeCoordinate[1] }
  const remaining = Math.max(0, mission.energy_budget - route.metrics.energy_units * progress)
  const nextVisit = route.stop_visits.find((visit) => visit.route_vertex_index > routeIndex)
  const nextWaypointId = nextVisit?.id ?? 'HAB'

  // Human-friendly label resolver for waypoints and checkpoints (prevents raw UUIDs)
  const getWaypointDisplayName = (id: string): string => {
    if (id === 'HAB') return 'Habitat Base'
    const customStop = mission.route_stops.find((s) => s.id === id && s.type === 'custom') as CustomRouteStop | undefined
    if (customStop?.name) return customStop.name
    const scienceFeature = bootstrap.waypoints.features.find((f) => f.properties.id === id)
    if (scienceFeature?.properties.name) return scienceFeature.properties.name
    return id
  }

  const targetName = getWaypointDisplayName(nextWaypointId)

  const cycleSpeed = () => {
    const currentIndex = SPEED_STEPS.indexOf(speed)
    const nextSpeed = SPEED_STEPS[(currentIndex + 1) % SPEED_STEPS.length] ?? 8
    setWalkState({ speed: nextSpeed })
  }

  useEffect(() => {
    const resize = () => setCompact(window.innerWidth < 768)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    const feature = bootstrap.waypoints.features.find((item) => item.properties.id === nextWaypointId)
    if (!feature) return
    const [lon, lat] = feature.geometry.coordinates
    if (Math.hypot(coordinate.longitude - lon, coordinate.latitude - lat) < 0.00025) {
      useMissionStore.getState().setSelectedWaypoint(nextWaypointId)
    }
  }, [coordinate, nextWaypointId, bootstrap.waypoints.features])

  const updateJoystick = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - (bounds.left + bounds.width / 2)) / (bounds.width / 2)
    const y = (event.clientY - (bounds.top + bounds.height / 2)) / (bounds.height / 2)
    setTouchInput({ forward: Math.max(-1, Math.min(1, -y)), turn: Math.max(-1, Math.min(1, -x)) })
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, input, aside, .pointer-events-auto')) return
    isDraggingRef.current = true
    dragStartRef.current = { x: event.clientX, y: event.clientY }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    const dx = event.clientX - dragStartRef.current.x
    const dy = event.clientY - dragStartRef.current.y
    dragStartRef.current = { x: event.clientX, y: event.clientY }

    const ctrl = cameraControllerRef.current
    ctrl.yaw += dx * 0.005
    // Clamp pitch: -0.2 (low angle) to 1.45 (~83° steep top-down overhead)
    ctrl.pitch = Math.max(-0.2, Math.min(1.45, ctrl.pitch + dy * 0.005))
  }

  const handlePointerUp = () => {
    isDraggingRef.current = false
  }

  const containerRef = useRef<HTMLDivElement>(null)

  // Non-passive wheel listener with e.preventDefault to strictly block browser page zoom on trackpad pinch
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const ctrl = cameraControllerRef.current
      const delta = event.deltaY * 0.015
      ctrl.distance = Math.max(0.2, Math.min(80, ctrl.distance + delta))
      if (ctrl.distance <= 0.6) {
        setCameraMode('pov')
      } else if (ctrl.distance > 30) {
        setCameraMode('drone')
      } else {
        setCameraMode('chase')
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handleZoomIn = () => {
    const ctrl = cameraControllerRef.current
    ctrl.distance = Math.max(0.2, ctrl.distance * 0.75)
    if (ctrl.distance <= 0.6) {
      setCameraMode('pov')
    } else if (ctrl.distance > 30) {
      setCameraMode('drone')
    } else {
      setCameraMode('chase')
    }
  }

  const handleZoomOut = () => {
    const ctrl = cameraControllerRef.current
    ctrl.distance = Math.min(80, Math.max(1.5, ctrl.distance * 1.35))
    if (ctrl.distance <= 0.6) {
      setCameraMode('pov')
    } else if (ctrl.distance > 30) {
      setCameraMode('drone')
    } else {
      setCameraMode('chase')
    }
  }

  return <div
    ref={containerRef}
    className="marswalk-shell overflow-hidden bg-[#9b472c] select-none cursor-grab active:cursor-grabbing touch-none"
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerUp}
    onPointerCancel={handlePointerUp}
  >
    <Canvas shadows={false} dpr={compact ? 1 : [1, 1.5]} camera={{ fov: 52, near: 0.2, far: compact ? 3200 : 5000, position: [0, 8, 15] }} gl={{ antialias: !compact, powerPreference: 'high-performance' }}>
      <Suspense fallback={<SuspenseFallback />}>
        <Scene
          route={route}
          scene={bootstrap.scene}
          onTelemetry={(telemetry) => {
            if (telemetry.routeIndex !== null) setRouteIndex(telemetry.routeIndex)
          }}
          touchInput={touchInput}
          compact={compact}
          cameraControllerRef={cameraControllerRef}
          onCameraModeChange={(m) => m !== 'free' && setCameraMode(m)}
        />
      </Suspense>
    </Canvas>

    {/* Top Back Navigation */}
    <div className="absolute left-3 top-3 z-10">
      <button className="flex min-h-10 items-center gap-2 rounded-lg border border-white/20 bg-[#0d1117] px-3 text-xs font-semibold text-white shadow-md hover:bg-white/10" onClick={() => transitionTo('planner')}>
        <ChevronLeft size={16} /> Planner
      </button>
    </div>

    {/* UNIFIED MISSION CONSOLE DOCK (DUAL-DECK SYMMETRICAL) */}
    <div className="absolute inset-x-3 bottom-3 z-20 mx-auto max-w-3xl rounded-xl border border-white/20 bg-[#0d1117] p-2.5 shadow-2xl">
      {/* 1. Timeline Scrubber */}
      <div className="flex items-center gap-3 px-1 mb-2">
        <span className="min-w-8 text-right font-mono text-[10px] text-slate-300 font-bold">{Math.round(progress * 100)}%</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={progress}
          onChange={(event) => {
            const val = parseFloat(event.target.value)
            setWalkState({ progress: val, playing: false })
          }}
          className="flex-1 cursor-pointer"
          aria-label="Route timeline scrub"
        />
        <span className="min-w-24 font-mono text-[10px] text-slate-300 text-right font-bold">
          {((route.metrics.distance_m * progress) / 1000).toFixed(2)} / {(route.metrics.distance_m / 1000).toFixed(2)} km
        </span>
      </div>

      {/* 2. Core Playback Console (Centered Master Deck) */}
      <div className="flex items-center justify-center gap-2 pb-2 border-b border-white/10">
        <button
          className="flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-[#161b22] px-3 text-xs text-white hover:bg-white/10 transition"
          onClick={() => setWalkState({ guided: !guided, playing: false })}
          title={guided ? 'Switch to free walking' : 'Switch to guided tour'}
        >
          <Footprints size={14} className={guided ? 'text-sky-400' : 'text-slate-400'} />
          <span className="font-medium text-[11px]">{guided ? 'Guided Tour' : 'Free Walk'}</span>
        </button>

        <button
          className="grid size-9 place-items-center rounded-md bg-[#1f6feb] text-white hover:bg-[#388bfd] transition shadow-md font-bold border border-[#58a6ff]/40"
          onClick={() => setWalkState({ playing: !playing })}
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={16} /> : <Play size={16} className="translate-x-0.5" />}
        </button>

        <button
          className="flex h-8 items-center gap-1 rounded-md border border-white/10 bg-[#161b22] px-2.5 font-mono text-xs text-white hover:bg-white/10 font-bold transition"
          onClick={cycleSpeed}
          title="Cycle playback speed"
        >
          <FastForward size={13} className="text-sky-400" />
          <span>{speed}×</span>
        </button>

        <button
          className="h-8 w-8 grid place-items-center rounded-md border border-white/10 bg-[#161b22] text-white hover:bg-white/10 transition"
          onClick={() => setWalkState({ progress: 0, playing: false })}
          title="Reset to mission origin"
          aria-label="Reset to mission origin"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      {/* 3. Symmetrical Auxiliary Wings (Telemetry Left · Camera Right) */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2">
        {/* Left Wing: Suit Telemetry & Safety Actions */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
          <div className="flex items-center gap-2 font-mono text-xs px-2.5 py-1 rounded-md bg-[#161b22] border border-white/10">
            <BatteryCharging size={14} className="text-mars" />
            <strong className="text-white font-bold">{Math.round(remaining).toLocaleString()} EU</strong>
            <span className="text-slate-500">·</span>
            <span className={`font-bold text-[10px] ${remaining > mission.energy_budget * mission.return_reserve_pct / 100 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {remaining > mission.energy_budget * mission.return_reserve_pct / 100 ? 'SAFE' : 'CAUTION'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              className="flex h-7 items-center rounded border border-white/15 bg-[#161b22] px-2 text-[11px] font-mono font-medium text-slate-300 hover:text-white hover:bg-white/10 transition"
              onClick={() => applyEnergyLoss()}
              title="Simulate 20% Suit Energy Depletion"
            >
              <span className="text-amber-400 font-bold">-20%</span>
            </button>
            <button
              className="flex h-7 items-center gap-1.5 rounded border border-red-700 bg-[#b91c1c] px-2.5 text-[11px] font-mono font-bold uppercase tracking-wider text-white hover:bg-[#dc2626] transition shadow-sm"
              onClick={() => requestEmergency(coordinate)}
              title="Emergency Abort Path to Habitat Base"
            >
              <AlertTriangle size={12} className="text-white" />
              <span>Abort</span>
            </button>
          </div>
        </div>

        {/* Right Wing: Camera Optics & Zoom */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          {/* Zoom In (+) / Zoom Out (-) */}
          <div className="flex items-center rounded-md border border-white/10 bg-[#161b22] p-0.5">
            <button
              className="grid size-6 place-items-center rounded text-slate-300 hover:text-white hover:bg-white/10 transition"
              onClick={handleZoomIn}
              title="Zoom Camera In"
              aria-label="Zoom in"
            >
              <Plus size={13} />
            </button>
            <button
              className="grid size-6 place-items-center rounded text-slate-300 hover:text-white hover:bg-white/10 transition border-l border-white/10"
              onClick={handleZoomOut}
              title="Zoom Camera Out"
              aria-label="Zoom out"
            >
              <Minus size={13} />
            </button>
          </div>

          {/* Camera View Presets & Compass Reset */}
          <div className="flex items-center gap-0.5 rounded-md border border-white/10 bg-[#161b22] p-0.5">
            {(['chase', 'drone', 'pov'] as const).map((mode) => (
              <button
                key={mode}
                className={`px-2 py-0.5 text-[11px] font-mono font-semibold uppercase rounded transition ${
                  cameraMode === mode
                    ? 'bg-[#1f6feb] text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
                onClick={() => cameraControllerRef.current.setPreset(mode)}
                title={`Switch camera view to ${mode.toUpperCase()}`}
              >
                {mode}
              </button>
            ))}
            <button
              className="grid size-6 place-items-center rounded text-slate-400 hover:text-white hover:bg-white/10 transition border-l border-white/10 ml-0.5 pl-0.5"
              onClick={() => cameraControllerRef.current.resetCamera()}
              title="Reset view to Chase angle"
              aria-label="Reset Camera View"
            >
              <Compass size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>

    {!guided && compact && (
      <div className="absolute bottom-24 left-4 z-20 size-28 touch-none rounded-full border border-white/20 bg-black/40" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateJoystick(event) }} onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && updateJoystick(event)} onPointerUp={() => setTouchInput({ forward: 0, turn: 0 })} onPointerCancel={() => setTouchInput({ forward: 0, turn: 0 })}>
        <span className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35" />
      </div>
    )}

    {selectedWaypoint && <WaypointOverlay />}
  </div>
}

function SuspenseFallback() {
  return <Html center><div className="terrain-loader flex min-w-48 flex-col items-center gap-3 rounded-lg border border-white/20 bg-[#0d1117] p-5 shadow-2xl"><span className="spinner" /><strong className="font-mono text-xs text-slate-200">Streaming Jezero DTM sectors…</strong></div></Html>
}

function WaypointOverlay() {
  const id = useMissionStore((state) => state.selectedWaypoint)!
  const bootstrap = useMissionStore((state) => state.bootstrap)!
  const mission = useMissionStore((state) => state.mission)
  const setSelected = useMissionStore((state) => state.setSelectedWaypoint)
  const waypoint = bootstrap.waypoints.features.find((item) => item.properties.id === id)
  const customStop = mission?.route_stops.find((s) => s.id === id && s.type === 'custom') as CustomRouteStop | undefined

  if (!waypoint && !customStop) return null

  if (customStop) {
    let nearestImage: { img: typeof bootstrap.surface_images[0]; distanceM: number } | null = null
    if (bootstrap.surface_images.length > 0) {
      const cosLat = Math.cos((customStop.latitude * Math.PI) / 180)
      let minD = Infinity
      for (const img of bootstrap.surface_images) {
        const imgLon = Number(img.longitude)
        const imgLat = Number(img.latitude)
        const dx = ((imgLon - customStop.longitude) * Math.PI / 180) * 3396190 * cosLat
        const dy = ((imgLat - customStop.latitude) * Math.PI / 180) * 3396190
        const d = Math.hypot(dx, dy)
        if (d < minD) {
          minD = d
          nearestImage = { img, distanceM: Math.round(d) }
        }
      }
    }
    const distStr = nearestImage && (nearestImage.distanceM >= 1000 ? `${(nearestImage.distanceM / 1000).toFixed(1)} km` : `${nearestImage.distanceM} m`)

    return (
      <aside className="absolute inset-x-3 bottom-3 z-30 max-h-[70svh] overflow-auto rounded-xl border border-white/20 bg-[#0d1117] p-5 shadow-2xl md:inset-auto md:right-4 md:top-20 md:w-84">
        <button className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => setSelected(null)}>✕</button>
        <span className="flex items-center gap-1.5 text-xs font-mono font-semibold tracking-wider text-sky-400 uppercase">
          <MapPin size={13} /> Custom Checkpoint
        </span>
        <h2 className="mb-1 mt-2 pr-6 text-lg font-semibold text-white">{customStop.name}</h2>
        <p className="mb-3 font-mono text-xs text-slate-400">Coord: {customStop.latitude.toFixed(4)}°N, {customStop.longitude.toFixed(4)}°E</p>
        {nearestImage && (
          <div className="mb-3">
            <img className="aspect-video w-full rounded-lg border border-white/10 object-cover" src={`/assets/thumbnails/surface/${nearestImage.img.product_id}.jpg`} alt="Nearest rover observation" />
            <p className="mt-1 font-mono text-[10px] text-slate-400">Nearest Observation · Sol {nearestImage.img.sol} ({distStr} away)</p>
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-white/10 pt-2 text-[10px] text-slate-400 font-mono">
          <Activity size={12} className="text-sky-400" />
          <span>User-defined exploration stop</span>
        </div>
      </aside>
    )
  }

  if (!waypoint) return null

  const images = bootstrap.surface_images.filter((item) => item.waypoint_id === id)
  const evidence = bootstrap.science_evidence[id]

  return <aside className="absolute inset-x-3 bottom-3 z-30 max-h-[70svh] overflow-auto rounded-xl border border-white/20 bg-[#0d1117] p-5 shadow-2xl md:inset-auto md:right-4 md:top-20 md:w-84">
    <button className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => setSelected(null)}>✕</button>
    <span className="flex items-center gap-1.5 text-xs font-mono font-semibold tracking-wider text-mars uppercase">
      <Target size={13} /> Science Target · Sol {waypoint.properties.sol}
    </span>
    <h2 className="mb-2 mt-2 pr-6 text-lg font-semibold text-white">{waypoint.properties.name}</h2>
    <p className="mb-3 text-xs leading-relaxed text-slate-300">{waypoint.properties.science_rationale}</p>
    <div>
      {images[0] && <img className="aspect-video w-full rounded-lg border border-white/10 object-cover" src={`/assets/thumbnails/surface/${images[0].product_id}.jpg`} alt="Rover observation" />}
    </div>
    <dl className="mt-3 grid grid-cols-3 gap-1.5 text-xs font-mono">
      <div className="rounded-md border border-white/10 bg-[#161b22] p-2">
        <dt className="text-[10px] text-slate-400">Priority</dt>
        <dd className="font-semibold text-mars">{waypoint.properties.priority}/3</dd>
      </div>
      <div className="rounded-md border border-white/10 bg-[#161b22] p-2">
        <dt className="text-[10px] text-slate-400">Geology</dt>
        <dd className="font-semibold text-white">{evidence?.geology_symbol ?? '—'}</dd>
      </div>
      <div className="rounded-md border border-white/10 bg-[#161b22] p-2">
        <dt className="text-[10px] text-slate-400">OLINDEX3</dt>
        <dd className="font-semibold text-white">{evidence?.crism.olindex3?.toFixed(3) ?? 'nodata'}</dd>
      </div>
    </dl>
    <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-2 text-[10px] text-slate-400 font-mono">
      <Activity size={12} className="text-mars" />
      <span>Measured Mastcam-Z/Navcam · CRISM & USGS Nili units</span>
    </div>
  </aside>
}

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Html, Line, Stars } from '@react-three/drei'
import {
  AlertTriangle, ChevronLeft, FastForward, Footprints, Gauge, Map, Pause, Play,
  RotateCcw, ShieldCheck, Target, Zap, Activity,
} from 'lucide-react'
import * as THREE from 'three'
import { useMissionStore } from '../store'
import type { CustomRouteStop, RouteCandidate, SceneManifest, SceneTile } from '../types'

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

function Scene({ route, scene, onPosition, touchInput, compact }: { route: RouteCandidate; scene: SceneManifest; onPosition: (position: Position, index: number) => void; touchInput: { forward: number; turn: number }; compact: boolean }) {
  const guided = useMissionStore((state) => state.guided)
  const playing = useMissionStore((state) => state.playing)
  const speed = useMissionStore((state) => state.speed)
  const reducedMotion = useMissionStore((state) => state.reducedMotion)
  const progress = useMissionStore((state) => state.progress)
  const setWalkState = useMissionStore((state) => state.setMarsWalkState)
  const emergencyRoute = useMissionStore((state) => state.emergencyRoute)
  const avatar = useRef<THREE.Group>(null)
  const cameraTarget = useRef(new THREE.Vector3())
  const smoothedElevation = useRef<number | null>(null)
  const keys = useRef(new Set<string>())
  const routePath = useMemo(() => routeInterpolator(route.scene_coordinates), [route])
  const overview = useBinary(scene.overview.url)
  const [avatarPosition, setAvatarPosition] = useState<Position>(() => {
    const initial = routePath.at(progress).position
    return [initial[0], initial[1] + 0.18, initial[2]]
  })
  const direction = useRef(routePath.at(progress).direction)
  const lastStoreUpdate = useRef(0)
  const lastUiUpdate = useRef(0)
  const { camera } = useThree()

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
    if (guided) {
      let nextProgress = useMissionStore.getState().progress
      if (playing) nextProgress = Math.min(1, nextProgress + (speed * delta) / routePath.total)
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
      onPosition(next, routeIndex)
      lastUiUpdate.current = performance.now()
    }
    if (avatar.current) {
      avatar.current.position.set(...next)
      avatar.current.rotation.y = Math.atan2(direction.current.x, direction.current.z)
    }

    // DUAL-DAMPED STABLE CAMERA SYSTEM:
    // 1. Smooth the height for camera placement to filter out rocky micro-bumps
    if (smoothedElevation.current === null) {
      smoothedElevation.current = next[1]
    } else {
      smoothedElevation.current = THREE.MathUtils.damp(smoothedElevation.current, next[1], 4.2, delta)
    }

    // 2. Compute desired camera position with distance and smoothed elevation
    const desired = new THREE.Vector3(next[0], smoothedElevation.current + 5.5, next[2]).addScaledVector(direction.current, -10)
    camera.position.lerp(desired, reducedMotion ? 0.25 : 1 - Math.exp(-delta * 5.0))

    // 3. Smooth the lookAt target to eliminate pitch oscillations/jitter
    const rawTarget = new THREE.Vector3(next[0], smoothedElevation.current + 1.4, next[2])
    cameraTarget.current.lerp(rawTarget, reducedMotion ? 0.35 : 1 - Math.exp(-delta * 6.5))
    camera.lookAt(cameraTarget.current)
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
      <Html position={[0, 14.5, 0]} center distanceFactor={22}><button className="rounded-md border border-white/20 bg-[#0d1117]/85 px-2.5 py-1.5 text-xs font-mono font-medium text-white shadow-md backdrop-blur hover:bg-white/10" onClick={() => stop.type === 'science' && useMissionStore.getState().setSelectedWaypoint(stop.id)}>{label}</button></Html>
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
  const reducedMotion = useMissionStore((state) => state.reducedMotion)
  const progress = useMissionStore((state) => state.progress)
  const setWalkState = useMissionStore((state) => state.setMarsWalkState)
  const setView = useMissionStore((state) => state.setView)
  const applyEnergyLoss = useMissionStore((state) => state.applyEnergyLoss)
  const requestEmergency = useMissionStore((state) => state.requestEmergencyReturn)
  const selectedWaypoint = useMissionStore((state) => state.selectedWaypoint)
  const [routeIndex, setRouteIndex] = useState(0)
  const [compact, setCompact] = useState(() => window.innerWidth < 768)
  const [touchInput, setTouchInput] = useState({ forward: 0, turn: 0 })
  const coordinate = route.coordinates[Math.min(routeIndex, route.coordinates.length - 1)]
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
    if (Math.hypot(coordinate[0] - lon, coordinate[1] - lat) < 0.00025) {
      useMissionStore.getState().setSelectedWaypoint(nextWaypointId)
    }
  }, [coordinate, nextWaypointId, bootstrap.waypoints.features])

  const updateJoystick = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - (bounds.left + bounds.width / 2)) / (bounds.width / 2)
    const y = (event.clientY - (bounds.top + bounds.height / 2)) / (bounds.height / 2)
    setTouchInput({ forward: Math.max(-1, Math.min(1, -y)), turn: Math.max(-1, Math.min(1, -x)) })
  }

  return <div className="marswalk-shell overflow-hidden bg-[#9b472c]">
    <Canvas shadows={false} dpr={compact ? 1 : [1, 1.5]} camera={{ fov: 52, near: 0.2, far: compact ? 3200 : 5000, position: [0, 8, 15] }} gl={{ antialias: !compact, powerPreference: 'high-performance' }}>
      <Suspense fallback={<SuspenseFallback />}>
        <Scene route={route} scene={bootstrap.scene} onPosition={(_, index) => setRouteIndex(index)} touchInput={touchInput} compact={compact} />
      </Suspense>
    </Canvas>

    {/* Top Mission Telemetry Bar */}
    <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-center gap-2">
      <button className="pointer-events-auto flex min-h-10 items-center gap-2 rounded-lg border border-white/15 bg-[#0d1117]/85 px-3 text-xs font-medium text-white shadow-md backdrop-blur hover:bg-white/10" onClick={() => setView('planner')}>
        <ChevronLeft size={16} /> Planner
      </button>
      <span className="rounded-lg border border-white/15 bg-[#0d1117]/85 px-3 py-1.5 backdrop-blur shadow-md">
        <small className="block text-[9px] uppercase tracking-wider text-white/50">MarsWalk · 3D EVA Reconstruction</small>
        <strong className="block max-w-56 truncate text-xs font-semibold text-white">
          {nextWaypointId === 'HAB' ? 'Return to Habitat Base' : `En route to ${targetName}`}
        </strong>
      </span>
      <span className="ml-auto hidden rounded-lg border border-white/10 bg-[#0d1117]/80 px-2.5 py-1 text-[10px] font-mono tracking-wide text-mars sm:block">
        MRO HiRISE DTM · 1× ELEVATION
      </span>
    </div>

    {/* Bottom-left telemetry metrics */}
    <div className="absolute inset-x-3 bottom-28 z-10 flex justify-center gap-2 sm:bottom-4 sm:left-3 sm:right-auto">
      <div className="flex min-w-24 items-center gap-2 rounded-lg border border-white/15 bg-[#0d1117]/85 px-3 py-1.5 backdrop-blur shadow-md">
        <Gauge size={16} className="text-mars" />
        <span>
          <small className="block text-[9px] font-mono uppercase tracking-wider text-white/50">Progress</small>
          <strong className="font-mono text-xs">{Math.round(progress * 100)}%</strong>
        </span>
      </div>
      <div className="flex min-w-28 items-center gap-2 rounded-lg border border-white/15 bg-[#0d1117]/85 px-3 py-1.5 backdrop-blur shadow-md">
        <Zap size={16} className="text-mars" />
        <span>
          <small className="block text-[9px] font-mono uppercase tracking-wider text-white/50">Energy</small>
          <strong className="font-mono text-xs">{Math.round(remaining).toLocaleString()} EU</strong>
        </span>
      </div>
      <div className="hidden min-w-24 items-center gap-2 rounded-lg border border-white/15 bg-[#0d1117]/85 px-3 py-1.5 backdrop-blur shadow-md sm:flex">
        <ShieldCheck size={16} className="text-mars" />
        <span>
          <small className="block text-[9px] font-mono uppercase tracking-wider text-white/50">Return</small>
          <strong className={`font-mono text-xs ${remaining > mission.energy_budget * mission.return_reserve_pct / 100 ? 'text-safe' : 'text-danger'}`}>
            {remaining > mission.energy_budget * mission.return_reserve_pct / 100 ? 'SAFE' : 'CAUTION'}
          </strong>
        </span>
      </div>
    </div>

    {/* Interactive Timeline Scrubber Slider */}
    <div className="absolute bottom-16 left-1/2 z-20 flex w-[92vw] max-w-lg -translate-x-1/2 items-center gap-3 rounded-lg border border-white/15 bg-[#0d1117]/85 px-3.5 py-1.5 backdrop-blur shadow-xl">
      <span className="min-w-8 text-right font-mono text-[10px] text-white/60">{Math.round(progress * 100)}%</span>
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
        aria-label="Route timeline progress"
      />
      <span className="min-w-20 font-mono text-[10px] text-white/60 text-right">
        {((route.metrics.distance_m * progress) / 1000).toFixed(2)} / {(route.metrics.distance_m / 1000).toFixed(2)} km
      </span>
    </div>

    {/* Center Playback Console */}
    <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-white/15 bg-[#0d1117]/90 p-1 backdrop-blur shadow-2xl">
      <button
        className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs text-white/80 hover:bg-white/10"
        onClick={() => setWalkState({ guided: !guided, playing: false })}
        title={guided ? 'Switch to free walking' : 'Switch to guided tour'}
      >
        <Footprints size={15} />
        <span className="hidden sm:inline font-medium">{guided ? 'Guided' : 'Free walk'}</span>
      </button>

      <button
        className="grid size-9 place-items-center rounded-lg bg-mars text-[#140b07] hover:bg-mars/90 transition shadow"
        onClick={() => setWalkState({ playing: !playing })}
        title={playing ? 'Pause' : 'Play'}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause size={17} /> : <Play size={17} />}
      </button>

      <button
        className="flex h-9 items-center gap-1 rounded-lg px-2.5 font-mono text-xs text-white/90 hover:bg-white/10"
        onClick={cycleSpeed}
        title="Cycle playback speed"
      >
        <FastForward size={14} className="text-mars" />
        <span>{speed}×</span>
      </button>

      <button
        className="hidden h-9 w-9 place-items-center rounded-lg text-white/80 hover:bg-white/10 sm:grid"
        onClick={() => setWalkState({ progress: 0, playing: false })}
        title="Reset to mission origin"
        aria-label="Reset to mission origin"
      >
        <RotateCcw size={15} />
      </button>
    </div>

    {/* Emergency Actions (Right side) */}
    <div className="absolute bottom-3 right-3 z-20 hidden flex-col gap-2 sm:flex">
      <button className="flex min-h-10 items-center gap-2 rounded-lg border border-white/15 bg-[#0d1117]/85 px-3 text-xs font-medium text-white hover:bg-white/10 shadow-md backdrop-blur" onClick={() => applyEnergyLoss()}>
        <Zap size={15} className="text-caution" /> Simulate -20% EU
      </button>
      <button className="flex min-h-10 items-center gap-2 rounded-lg border border-danger/50 bg-[#2d1217]/85 px-3 text-xs font-medium text-danger hover:bg-danger/20 shadow-md backdrop-blur" onClick={() => requestEmergency({ longitude: coordinate[0], latitude: coordinate[1] })}>
        <AlertTriangle size={15} /> Emergency Abort
      </button>
    </div>

    {/* Reduced motion toggle */}
    <label className="absolute right-3 top-16 z-10 hidden items-center rounded-lg border border-white/10 bg-[#0d1117]/80 px-2.5 py-1.5 text-xs text-white/70 backdrop-blur sm:flex cursor-pointer hover:bg-white/10">
      <input className="mr-2 accent-mars" type="checkbox" checked={reducedMotion} onChange={(event) => setWalkState({ reducedMotion: event.target.checked })} />
      Damped camera
    </label>

    {!guided && compact && (
      <div className="absolute bottom-20 left-4 z-20 size-28 touch-none rounded-full border border-white/20 bg-black/40" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateJoystick(event) }} onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && updateJoystick(event)} onPointerUp={() => setTouchInput({ forward: 0, turn: 0 })} onPointerCancel={() => setTouchInput({ forward: 0, turn: 0 })}>
        <span className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35" />
      </div>
    )}

    {selectedWaypoint && <WaypointOverlay />}
  </div>
}

function SuspenseFallback() {
  return <Html center><div className="terrain-loader flex min-w-48 flex-col items-center gap-3 rounded-lg border border-white/15 bg-[#0d1117]/90 p-5 shadow-2xl backdrop-blur"><span className="spinner" /><strong className="font-mono text-xs text-white/80">Streaming Jezero DTM sectors…</strong></div></Html>
}

function WaypointOverlay() {
  const id = useMissionStore((state) => state.selectedWaypoint)!
  const bootstrap = useMissionStore((state) => state.bootstrap)!
  const setSelected = useMissionStore((state) => state.setSelectedWaypoint)
  const waypoint = bootstrap.waypoints.features.find((item) => item.properties.id === id)
  const images = bootstrap.surface_images.filter((item) => item.waypoint_id === id)
  const evidence = bootstrap.science_evidence[id]
  if (!waypoint) return null
  return <aside className="absolute inset-x-3 bottom-3 z-30 max-h-[70svh] overflow-auto rounded-xl border border-white/15 bg-[#0d1117]/95 p-5 shadow-2xl backdrop-blur md:inset-auto md:right-4 md:top-20 md:w-84">
    <button className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" onClick={() => setSelected(null)}>✕</button>
    <span className="flex items-center gap-1.5 text-xs font-mono font-semibold tracking-wider text-mars uppercase">
      <Target size={13} /> Science Target · Sol {waypoint.properties.sol}
    </span>
    <h2 className="mb-2 mt-2 pr-6 text-lg font-semibold text-white">{waypoint.properties.name}</h2>
    <p className="mb-3 text-xs leading-relaxed text-white/70">{waypoint.properties.science_rationale}</p>
    <div>
      {images[0] && <img className="aspect-video w-full rounded-lg border border-white/10 object-cover" src={`/assets/thumbnails/surface/${images[0].product_id}.jpg`} alt="Rover observation" />}
    </div>
    <dl className="mt-3 grid grid-cols-3 gap-1.5 text-xs font-mono">
      <div className="rounded-md border border-white/5 bg-white/5 p-2">
        <dt className="text-[10px] text-white/50">Priority</dt>
        <dd className="font-semibold text-mars">{waypoint.properties.priority}/3</dd>
      </div>
      <div className="rounded-md border border-white/5 bg-white/5 p-2">
        <dt className="text-[10px] text-white/50">Geology</dt>
        <dd className="font-semibold text-white/90">{evidence?.geology_symbol ?? '—'}</dd>
      </div>
      <div className="rounded-md border border-white/5 bg-white/5 p-2">
        <dt className="text-[10px] text-white/50">OLINDEX3</dt>
        <dd className="font-semibold text-white/90">{evidence?.crism.olindex3?.toFixed(3) ?? 'nodata'}</dd>
      </div>
    </dl>
    <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-2 text-[10px] text-white/40">
      <Activity size={12} className="text-mars/80" />
      <span>Measured Mastcam-Z/Navcam · CRISM & USGS Nili units</span>
    </div>
  </aside>
}

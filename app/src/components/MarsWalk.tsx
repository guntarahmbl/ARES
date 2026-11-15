import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Html, Line, Stars } from '@react-three/drei'
import {
  AlertTriangle, ChevronLeft, Compass, FastForward, Footprints, MapPin, Minus, Pause, Play, Plus, RotateCcw, X
} from 'lucide-react'
import * as THREE from 'three'
import { useMissionStore } from '../store'
import { useSettingsStore } from '../settingsStore'
import { localToProjected, projectedToCoordinate } from '../lib/marsProjection'
import { useViewTransition } from '../hooks/useViewTransition'
import type { CustomRouteStop, RouteCandidate, SceneManifest, SceneTile, WalkTelemetry } from '../types'

type Position = [number, number, number]

const SPEED_STEPS = [1, 8, 32, 64, 128, 256]

const BASE_LOD_M = 5
const heightCache = new Map<string, Float32Array>()
// Tile id -> height file of the mesh currently on screen, so walking follows what is drawn rather than a finer cached level.
const shownLod = new Map<string, string>()
const UP = new THREE.Vector3(0, 1, 0)
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

function useBinary(url: string) {
  const [data, setData] = useState<Float32Array | null>(() => heightCache.get(url) ?? null)
  useEffect(() => {
    const cached = heightCache.get(url)
    if (cached) { setData(cached); return }
    let active = true
    fetch(url).then((response) => response.arrayBuffer()).then((buffer) => {
      const heights = new Float32Array(buffer)
      heightCache.set(url, heights)
      if (active) setData(heights)
    }).catch((error) => console.error(`Unable to load ${url}`, error))
    return () => { active = false }
  }, [url])
  return data
}

// Height samples sit on routing-grid cell centres, while tile bounds follow cell edges.
function tileGrid(tile: SceneTile) {
  const base = tile.lods.find((item) => item.resolution_m === BASE_LOD_M) ?? tile.lods[0]
  const [xMin, zMin, xMax, zMax] = tile.bounds_local
  return { base, cellX: (xMax - xMin) / base.cols, cellZ: (zMax - zMin) / base.rows }
}

// Interpolates on the same triangles the terrain meshes are built from.
function sampleHeights(heights: Float32Array, rows: number, cols: number, gridX: number, gridZ: number) {
  const x = THREE.MathUtils.clamp(gridX, 0, cols - 1)
  const z = THREE.MathUtils.clamp(gridZ, 0, rows - 1)
  const col = Math.min(cols - 2, Math.floor(x))
  const row = Math.min(rows - 2, Math.floor(z))
  if (col < 0 || row < 0) return heights[0]
  const fx = x - col
  const fz = z - row
  const h00 = heights[row * cols + col]
  const h01 = heights[row * cols + col + 1]
  const h10 = heights[(row + 1) * cols + col]
  const h11 = heights[(row + 1) * cols + col + 1]
  return fx + fz <= 1
    ? h00 + fx * (h01 - h00) + fz * (h10 - h00)
    : h11 + (1 - fx) * (h10 - h11) + (1 - fz) * (h01 - h11)
}

/** Terrain height in scene units under (x, z): the level drawn for that tile, else the finest one already loaded. */
function groundHeight(scene: SceneManifest, x: number, z: number): number | null {
  for (const tile of scene.tiles) {
    const [xMin, zMin, xMax, zMax] = tile.bounds_local
    if (x < xMin || x > xMax || z < zMin || z > zMax) continue
    const { base, cellX, cellZ } = tileGrid(tile)
    const cellsX = (x - xMin) / cellX - 0.5
    const cellsZ = (z - zMin) / cellZ - 0.5
    if (cellsX < 0 || cellsZ < 0) continue
    const shown = shownLod.get(tile.id)
    for (const lod of [...tile.lods].sort((a, b) => Number(b.url === shown) - Number(a.url === shown) || a.resolution_m - b.resolution_m)) {
      const heights = heightCache.get(lod.url)
      if (!heights) continue
      const step = lod.resolution_m / base.resolution_m
      if (cellsX / step > lod.cols - 1 || cellsZ / step > lod.rows - 1) continue
      const sampled = sampleHeights(heights, lod.rows, lod.cols, cellsX / step, cellsZ / step)
      if (Number.isFinite(sampled)) return sampled - scene.origin.elevation
    }
  }
  const overview = heightCache.get(scene.overview.url)
  if (!overview || !scene.tiles.length) return null
  const { base, cellX, cellZ } = tileGrid(scene.tiles[0])
  const step = Math.max(1, Math.round(scene.overview.resolution_m / base.resolution_m))
  const sampled = sampleHeights(
    overview, scene.overview.rows, scene.overview.cols,
    ((x - scene.bounds_local[0]) / cellX - 0.5) / step, ((z - scene.bounds_local[1]) / cellZ - 0.5) / step,
  )
  return Number.isFinite(sampled) ? sampled - scene.origin.elevation : null
}

// Boots are ~0.35 m from the body centre; on a slope the uphill boot needs the higher ground.
const FOOTPRINT = [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]
function footingHeight(scene: SceneManifest, x: number, z: number): number | null {
  let highest = groundHeight(scene, x, z)
  if (highest === null) return null
  for (const [dx, dz] of FOOTPRINT) {
    const sampled = groundHeight(scene, x + dx, z + dz)
    if (sampled !== null && sampled > highest) highest = sampled
  }
  return highest
}

function useOptionalTexture(url: string | undefined, anisotropy: number) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!url) { setTexture(null); return }
    let active = true
    let loaded: THREE.Texture | null = null
    new THREE.TextureLoader().load(url, (result) => {
      if (!active) { result.dispose(); return }
      result.anisotropy = anisotropy
      loaded = result
      setTexture(result)
    }, undefined, (error) => console.error(`Unable to load ${url}`, error))
    return () => { active = false; loaded?.dispose() }
  }, [url, anisotropy])
  return texture
}

function OverviewTerrain({ scene }: { scene: SceneManifest }) {
  const heights = useBinary(scene.overview.url)
  const texture = useLoader(THREE.TextureLoader, '/assets/web/basemap.webp')
  const geometry = useMemo(() => {
    if (!heights) return null
    const [xMin, zMin, xMax, zMax] = scene.bounds_local
    const rows = scene.overview.rows
    const cols = scene.overview.cols
    const grid = scene.tiles.length ? tileGrid(scene.tiles[0]) : null
    const step = grid ? Math.max(1, Math.round(scene.overview.resolution_m / grid.base.resolution_m)) : 0
    const positions = new Float32Array(rows * cols * 3)
    const uvs = new Float32Array(rows * cols * 2)
    const indices: number[] = []
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col
        const u = grid ? (0.5 + col * step) * grid.cellX / (xMax - xMin) : col / Math.max(1, cols - 1)
        const v = grid ? (0.5 + row * step) * grid.cellZ / (zMax - zMin) : row / Math.max(1, rows - 1)
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
  }, [heights, scene.bounds_local, scene.overview, scene.origin.elevation, scene.tiles])

  useEffect(() => () => geometry?.dispose(), [geometry])
  useEffect(() => { texture.colorSpace = THREE.SRGBColorSpace }, [texture])
  if (!geometry) return null
  // Backdrop only: detail tiles mark the stencil buffer and the coarse 20 m surface skips those pixels, so it cannot poke through them.
  return <mesh geometry={geometry} renderOrder={1}><meshStandardMaterial map={texture} roughness={1} metalness={0} stencilWrite stencilRef={1} stencilFunc={THREE.NotEqualStencilFunc} /></mesh>
}

function TerrainTile({ tile, lod, elevationOffset, compact, onShown }: { tile: SceneTile; lod: number; elevationOffset: number; compact: boolean; onShown: () => void }) {
  const descriptor = tile.lods.find((item) => item.resolution_m === lod) ?? tile.lods.at(-1)!
  const heights = useBinary(descriptor.url)
  const texture = useLoader(THREE.TextureLoader, tile.texture_url)
  const normalMap = useOptionalTexture(tile.normal_url, compact ? 4 : 16)
  const geometry = useMemo(() => {
    if (!heights) return null
    const [xMin, zMin, xMax, zMax] = tile.bounds_local
    const { base, cellX, cellZ } = tileGrid(tile)
    const step = descriptor.resolution_m / base.resolution_m
    const positions = new Float32Array(descriptor.rows * descriptor.cols * 3)
    const uvs = new Float32Array(descriptor.rows * descriptor.cols * 2)
    const indices: number[] = []
    for (let row = 0; row < descriptor.rows; row += 1) {
      for (let col = 0; col < descriptor.cols; col += 1) {
        const index = row * descriptor.cols + col
        const u = (0.5 + col * step) * cellX / (xMax - xMin)
        const v = (0.5 + row * step) * cellZ / (zMax - zMin)
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
  useEffect(() => {
    if (!geometry) return
    shownLod.set(tile.id, descriptor.url)
    onShown()
    return () => { if (shownLod.get(tile.id) === descriptor.url) shownLod.delete(tile.id) }
  }, [geometry, tile.id, descriptor.url, onShown])
  useEffect(() => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = compact ? 4 : 16; texture.needsUpdate = true }, [texture, compact])
  if (!geometry) return null
  return <mesh geometry={geometry} receiveShadow>
    <meshStandardMaterial key={normalMap ? 'relief' : 'plain'} map={texture} normalMap={normalMap} normalMapType={THREE.ObjectSpaceNormalMap} roughness={1} metalness={0} stencilWrite stencilRef={1} stencilZPass={THREE.ReplaceStencilOp} />
  </mesh>
}

function TerrainWorld({ scene, avatar, compact, onShown }: { scene: SceneManifest; avatar: Position; compact: boolean; onShown: () => void }) {
  const visible = useMemo(() => scene.tiles.map((tile) => {
    const [xMin, zMin, xMax, zMax] = tile.bounds_local
    const distance = Math.hypot((xMin + xMax) / 2 - avatar[0], (zMin + zMax) / 2 - avatar[2])
    // Distance to the tile's edge (0 inside it), so the tile underfoot always gets the finest level.
    const edge = Math.hypot(Math.max(xMin - avatar[0], 0, avatar[0] - xMax), Math.max(zMin - avatar[2], 0, avatar[2] - zMax))
    const wanted = compact
      ? (edge < 60 || distance < 450 ? 5 : distance < 800 ? 10 : 20)
      : (edge < 60 || distance < 400 ? 2 : distance < 900 ? 5 : distance < 1400 ? 10 : 20)
    // Older asset builds have no 2 m level: fall back to the finest level that is not finer than requested.
    const lod = tile.lods.reduce((best, item) => item.resolution_m >= wanted && item.resolution_m < best ? item.resolution_m : best, Infinity)
    return { tile, distance, edge, lod }
  }).filter((item) => item.edge < 60 || item.distance < (compact ? 1050 : 1600)), [scene.tiles, avatar[0], avatar[2], compact])

  return <group>
    <OverviewTerrain scene={scene} />
    {/* Each tile suspends on its own texture, so a tile streaming in never blanks the rest of the scene. */}
    {visible.map(({ tile, lod }) => <Suspense key={`${tile.id}-${lod}`} fallback={null}><TerrainTile tile={tile} lod={lod} elevationOffset={scene.origin.elevation} compact={compact} onShown={onShown} /></Suspense>)}
  </group>
}

type AvatarMotion = { speed: number; turn: number }

function Astronaut({ motion }: { motion: React.MutableRefObject<AvatarMotion> }) {
  const group = useRef<THREE.Group>(null)
  const leftArm = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Group>(null)
  const leftLeg = useRef<THREE.Group>(null)
  const rightLeg = useRef<THREE.Group>(null)
  const gait = useRef({ phase: 0, amplitude: 0, lean: 0 })
  useFrame((_, delta) => {
    const { speed, turn } = motion.current
    const pace = Math.abs(speed)
    const walking = pace > 0.05
    const backward = walking && speed < 0
    const state = gait.current
    // Backward steps are shorter and slower; turning in place is a small shuffle.
    const targetAmplitude = walking ? (backward ? 0.55 : 1) : Math.abs(turn) > 0.05 ? 0.3 : 0
    state.amplitude = THREE.MathUtils.damp(state.amplitude, targetAmplitude, 9, delta)
    const cadence = walking ? THREE.MathUtils.clamp(1.15 + pace * 0.09, 1.15, 2.3) * (backward ? 0.8 : 1) : 1.3
    if (targetAmplitude > 0) state.phase += delta * cadence * Math.PI * 2 * (backward ? -1 : 1)
    const targetLean = walking ? (backward ? 0.07 : -0.05 - Math.min(pace, 32) / 32 * 0.08) : 0
    state.lean = THREE.MathUtils.damp(state.lean, targetLean, 6, delta)

    const swing = Math.sin(state.phase) * state.amplitude
    const lift = Math.cos(state.phase) * state.amplitude
    // Positive rotation swings a limb toward the visor (forward). The lifted foot is the one in the air.
    if (leftLeg.current) { leftLeg.current.rotation.x = swing * 0.55; leftLeg.current.position.y = 0.98 + Math.max(0, lift) * 0.09 }
    if (rightLeg.current) { rightLeg.current.rotation.x = -swing * 0.55; rightLeg.current.position.y = 0.98 + Math.max(0, -lift) * 0.09 }
    const armReach = backward ? 0.25 : 0.42
    if (leftArm.current) leftArm.current.rotation.x = -swing * armReach
    if (rightArm.current) rightArm.current.rotation.x = swing * armReach
    if (group.current) {
      group.current.position.y = Math.abs(Math.cos(state.phase)) * 0.04 * state.amplitude
      group.current.rotation.x = state.lean
    }
  })
  const suit = '#e8e2d7'
  const joint = '#262b31'
  return <group ref={group}>
    <mesh position={[0, 1.45, 0]} castShadow><capsuleGeometry args={[0.34, 0.55, 8, 16]} /><meshStandardMaterial color={suit} roughness={0.8} /></mesh>
    <mesh position={[0, 2.15, 0]} castShadow><sphereGeometry args={[0.38, 24, 16]} /><meshStandardMaterial color="#e4e1d8" roughness={0.7} /></mesh>
    <mesh position={[0, 2.17, -0.27]} rotation={[0.12, 0, 0]}><sphereGeometry args={[0.29, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#263846" metalness={0.45} roughness={0.25} /></mesh>
    <mesh position={[0, 1.55, 0.34]} castShadow><boxGeometry args={[0.58, 0.75, 0.28]} /><meshStandardMaterial color="#a8a59d" roughness={0.9} /></mesh>
    {/* Limbs pivot at the shoulder and hip, and each boot travels with its leg. */}
    <group ref={leftArm} position={[-0.48, 1.86, 0]}><mesh position={[0, -0.38, 0]} castShadow><capsuleGeometry args={[0.11, 0.65, 6, 10]} /><meshStandardMaterial color={suit} /></mesh></group>
    <group ref={rightArm} position={[0.48, 1.86, 0]}><mesh position={[0, -0.38, 0]} castShadow><capsuleGeometry args={[0.11, 0.65, 6, 10]} /><meshStandardMaterial color={suit} /></mesh></group>
    <group ref={leftLeg} position={[-0.19, 0.98, 0]}>
      <mesh position={[0, -0.43, 0]} castShadow><capsuleGeometry args={[0.14, 0.72, 6, 10]} /><meshStandardMaterial color={suit} /></mesh>
      <mesh position={[0, -0.86, -0.09]}><boxGeometry args={[0.32, 0.16, 0.52]} /><meshStandardMaterial color={joint} /></mesh>
    </group>
    <group ref={rightLeg} position={[0.19, 0.98, 0]}>
      <mesh position={[0, -0.43, 0]} castShadow><capsuleGeometry args={[0.14, 0.72, 6, 10]} /><meshStandardMaterial color={suit} /></mesh>
      <mesh position={[0, -0.86, -0.09]}><boxGeometry args={[0.32, 0.16, 0.52]} /><meshStandardMaterial color={joint} /></mesh>
    </group>
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

type CameraMode = 'chase' | 'drone' | 'pov'
type WalkInput = { forward: number; turn: number }

interface CameraControllerState {
  /** Orbit offset from the astronaut's heading: 0 sits behind them, or in POV looks straight ahead. */
  yaw: number
  pitch: number
  distance: number
  mode: CameraMode
  setPreset: (preset: CameraMode) => void
  resetCamera: () => void
}

// POV can look up as well as down; the orbit camera stays above the ground.
const clampPitch = (pitch: number, mode: CameraMode) => mode === 'pov'
  ? THREE.MathUtils.clamp(pitch, -1.3, 1.3)
  : THREE.MathUtils.clamp(pitch, -0.2, 1.45)

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

function Scene({
  route,
  scene,
  onTelemetry,
  inputRef,
  compact,
  cameraControllerRef,
  onCameraModeChange,
}: {
  route: RouteCandidate
  scene: SceneManifest
  onTelemetry: (telemetry: WalkTelemetry) => void
  inputRef: React.MutableRefObject<WalkInput>
  compact: boolean
  cameraControllerRef: React.MutableRefObject<CameraControllerState>
  onCameraModeChange: (mode: CameraMode) => void
}) {
  const guided = useMissionStore((state) => state.guided)
  const playing = useMissionStore((state) => state.playing)
  const speed = useMissionStore((state) => state.speed)
  const setWalkState = useMissionStore((state) => state.setMarsWalkState)
  const setWalkTelemetry = useMissionStore((state) => state.setWalkTelemetry)
  const emergencyRoute = useMissionStore((state) => state.emergencyRoute)
  const avatar = useRef<THREE.Group>(null)
  const cameraTarget = useRef(new THREE.Vector3())
  const eyePoint = useRef(new THREE.Vector3())
  const scratch = useRef(new THREE.Vector3())
  const smoothedElevation = useRef<number | null>(null)
  const cameraHeading = useRef<number | null>(null)
  const keys = useRef(new Set<string>())
  const motion = useRef<AvatarMotion>({ speed: 0, turn: 0 })
  const routePath = useMemo(() => routeInterpolator(route.scene_coordinates), [route])
  useBinary(scene.overview.url)
  // Bumped whenever a terrain mesh appears, so draped overlays re-sample the surface that is drawn.
  const [terrainRevision, setTerrainRevision] = useState(0)
  const onTerrainShown = useCallback(() => setTerrainRevision((value) => value + 1), [])
  // The astronaut moves every frame through a ref; React only re-renders when terrain detail has to follow.
  const [lodAnchor, setLodAnchor] = useState<Position>(() => {
    const { guided: startGuided, walkTelemetry, progress } = useMissionStore.getState()
    if (!startGuided && walkTelemetry?.mode === 'free') return walkTelemetry.localPosition
    const initial = routePath.at(progress).position
    return [initial[0], initial[1] + 0.18, initial[2]]
  })
  const position = useRef<Position>(lodAnchor)
  const direction = useRef<THREE.Vector3>(null!)
  if (!direction.current) {
    const { guided: startGuided, walkTelemetry, progress } = useMissionStore.getState()
    direction.current = !startGuided && walkTelemetry?.mode === 'free'
      ? new THREE.Vector3(Math.sin(walkTelemetry.headingRad), 0, -Math.cos(walkTelemetry.headingRad))
      : routePath.at(progress).direction
  }
  const lastStoreUpdate = useRef(0)
  const lastUiUpdate = useRef(0)
  const { camera } = useThree()

  const controller = cameraControllerRef.current

  useEffect(() => {
    controller.setPreset = (preset: CameraMode) => {
      controller.yaw = 0
      controller.pitch = preset === 'chase' ? 0.35 : preset === 'drone' ? 1.15 : 0
      controller.distance = preset === 'chase' ? 12 : preset === 'drone' ? 42 : 0.2
      controller.mode = preset
      onCameraModeChange(preset)
    }
    controller.resetCamera = () => controller.setPreset('chase')
  }, [controller, onCameraModeChange])

  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (!isTyping(event.target)) keys.current.add(event.code) }
    const up = (event: KeyboardEvent) => keys.current.delete(event.code)
    const release = () => keys.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release) }
  }, [])

  useFrame((_, frameDelta) => {
    const delta = Math.min(frameDelta, 0.1)
    const previous = position.current
    let next: Position = [previous[0], previous[1], previous[2]]
    let routeIndex = 0
    let currentProgress = useMissionStore.getState().progress
    const pov = controller.mode === 'pov'
    if (guided) {
      let nextProgress = currentProgress
      if (playing) nextProgress = Math.min(1, nextProgress + (speed * delta) / routePath.total)
      currentProgress = nextProgress
      const sample = routePath.at(nextProgress)
      next = [sample.position[0], sample.position[1], sample.position[2]]
      routeIndex = sample.index
      direction.current.copy(sample.direction)
      motion.current.speed = playing && nextProgress < 1 ? speed : 0
      motion.current.turn = 0
      if (performance.now() - lastStoreUpdate.current > 100) {
        setWalkState({ progress: nextProgress, playing: nextProgress < 1 && playing })
        lastStoreUpdate.current = performance.now()
      }
    } else {
      const held = (...codes: string[]) => Number(codes.some((code) => keys.current.has(code)))
      const forward = THREE.MathUtils.clamp(held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown') + inputRef.current.forward, -1, 1)
      const turn = THREE.MathUtils.clamp(held('KeyA', 'ArrowLeft') - held('KeyD', 'ArrowRight') + inputRef.current.turn, -1, 1)
      let steer = turn * delta * 1.6
      // Forward always means "where the camera looks": in POV the body follows the view at once,
      // in the orbit views the astronaut swings round to it as soon as they start walking.
      if (controller.yaw !== 0 && (pov || forward !== 0)) {
        const offset = wrapAngle(controller.yaw)
        const step = pov ? offset : THREE.MathUtils.clamp(offset, -4 * delta, 4 * delta)
        steer += step
        controller.yaw = offset - step
      }
      direction.current.applyAxisAngle(UP, steer)
      next[0] += direction.current.x * forward * Math.min(speed, 32) * delta
      next[2] += direction.current.z * forward * Math.min(speed, 32) * delta
      const [xMin, zMin, xMax, zMax] = scene.bounds_local
      next[0] = THREE.MathUtils.clamp(next[0], xMin + 5, xMax - 5)
      next[2] = THREE.MathUtils.clamp(next[2], zMin + 5, zMax - 5)
      const moved = Math.hypot(next[0] - previous[0], next[2] - previous[2])
      motion.current.speed = delta > 0 ? Math.sign(forward) * moved / delta : 0
      motion.current.turn = turn
    }
    // Stand on the terrain that is actually drawn, taking the highest ground under the boots.
    const ground = footingHeight(scene, next[0], next[2])
    next[1] = ground !== null ? ground + 0.06 : guided ? next[1] + 0.1 : previous[1]
    position.current = next
    if (Math.hypot(next[0] - lodAnchor[0], next[2] - lodAnchor[2]) > 15) setLodAnchor(next)
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
    const facing = Math.atan2(direction.current.x, direction.current.z)
    if (avatar.current) {
      avatar.current.position.set(...next)
      // The model's visor points down -Z, so turn it half a circle to face the walking direction.
      avatar.current.rotation.y = facing + Math.PI
      avatar.current.visible = !pov
    }

    // Always-on camera elevation stabilizer
    if (smoothedElevation.current === null) {
      smoothedElevation.current = next[1]
    } else {
      smoothedElevation.current = THREE.MathUtils.damp(smoothedElevation.current, next[1], 4.2, delta)
    }

    // The camera rides with the astronaut's heading. A guided route turns in sharp corners, so ease through them.
    if (cameraHeading.current === null || !guided) cameraHeading.current = facing
    else cameraHeading.current += wrapAngle(facing - cameraHeading.current) * (1 - Math.exp(-delta * 3.5))
    const yaw = cameraHeading.current + Math.PI + controller.yaw
    const cosPitch = Math.cos(controller.pitch)

    if (pov) {
      // Eyes sit in the helmet and move rigidly with the body; only small bumps are smoothed out.
      const eyeY = Math.max(smoothedElevation.current, next[1] - 0.4) + 2.05
      eyePoint.current.set(next[0], eyeY, next[2])
      camera.position.copy(eyePoint.current)
      camera.lookAt(scratch.current.set(next[0] - Math.sin(yaw) * cosPitch, eyeY - Math.sin(controller.pitch), next[2] - Math.cos(yaw) * cosPitch))
      cameraTarget.current.copy(eyePoint.current)
    } else {
      const targetY = smoothedElevation.current + 1.35
      cameraTarget.current.lerp(scratch.current.set(next[0], targetY, next[2]), 1 - Math.exp(-delta * 8.0))
      const dx = controller.distance * cosPitch * Math.sin(yaw)
      const dy = controller.distance * Math.sin(controller.pitch)
      const dz = controller.distance * cosPitch * Math.cos(yaw)
      const desiredY = Math.max(smoothedElevation.current + 0.35, targetY + dy)
      camera.position.lerp(scratch.current.set(next[0] + dx, desiredY, next[2] + dz), 1 - Math.exp(-delta * 7.5))
      // Keep the camera above whatever terrain it is over, not only above the astronaut's elevation.
      const cameraGround = groundHeight(scene, camera.position.x, camera.position.z)
      if (cameraGround !== null) camera.position.y = Math.max(camera.position.y, cameraGround + 0.8)
      camera.lookAt(cameraTarget.current)
    }
  })

  const routeLine = useMemo(() => drape(scene, route.scene_coordinates, 0.45), [scene, route, terrainRevision])
  const emergencyLine = useMemo(() => emergencyRoute && drape(scene, emergencyRoute.scene_coordinates, 0.7), [scene, emergencyRoute, terrainRevision])

  return <>
    <color attach="background" args={['#c75f32']} />
    <fog attach="fog" args={['#b95a35', 800, 2600]} />
    <ambientLight intensity={1.25} />
    <directionalLight position={[600, 900, -500]} intensity={2.4} color="#ffe0b5" castShadow={false} />
    <hemisphereLight color="#ffd3ac" groundColor="#4d2118" intensity={0.65} />
    <TerrainWorld scene={scene} avatar={lodAnchor} compact={compact} onShown={onTerrainShown} />
    <Line points={routeLine} color="#38d4f8" lineWidth={2.2} transparent opacity={0.85} />
    {emergencyLine && <Line points={emergencyLine} color="#ff6579" lineWidth={3} dashed dashSize={12} gapSize={8} />}
    <group ref={avatar}><Astronaut motion={motion} /></group>
    <WaypointMarkers scene={scene} terrainRevision={terrainRevision} />
    <Stars radius={2500} depth={200} count={400} factor={2} saturation={0.2} fade speed={0.1} />
  </>
}

/** Lays route points on the terrain that is drawn, which can differ from the routing grid's elevation. */
function drape(scene: SceneManifest, points: number[][], lift: number) {
  return points.map((point) => [point[0], (groundHeight(scene, point[0], point[2]) ?? point[1]) + lift, point[2]] as Position)
}

// `terrainRevision` is only a re-render trigger: marker bases follow the surface as finer terrain streams in.
function WaypointMarkers({ scene, terrainRevision: _terrainRevision }: { scene: SceneManifest; terrainRevision: number }) {
  const mission = useMissionStore((state) => state.mission)!
  const bootstrap = useMissionStore((state) => state.bootstrap)!
  const route = useMissionStore((state) => state.plan?.primary)
  if (!route) return null
  return <>{mission.route_stops.map((stop) => {
    const visit = route.stop_visits.find((item) => item.id === stop.id)
    if (!visit) return null
    const [x, routeY, z] = route.scene_coordinates[visit.route_vertex_index]
    const y = groundHeight(scene, x, z) ?? routeY
    const label = stop.type === 'custom' ? stop.name : (bootstrap.waypoints.features.find((f) => f.properties.id === stop.id)?.properties.name ?? stop.id)
    const color = stop.type === 'custom' ? '#62c7e8' : '#ffb86c'
    return <group key={stop.id} position={[x, y + 0.2, z]}>
      <mesh position={[0, 6, 0]}><cylinderGeometry args={[0.18, 0.18, 12, 8]} /><meshBasicMaterial color={color} transparent opacity={0.65} /></mesh>
      <mesh position={[0, 12, 0]}><octahedronGeometry args={[1.2]} /><meshStandardMaterial color={color} emissive={stop.type === 'custom' ? '#16495a' : '#6b2d12'} /></mesh>
      <Html position={[0, 14.5, 0]} center distanceFactor={22}><button className="rounded border border-ink bg-panel px-2.5 py-1 text-xs font-medium text-ink hover:bg-panel-2" onClick={() => useMissionStore.getState().setSelectedWaypoint(stop.id)}>{label}</button></Html>
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
  const [touch, setTouch] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  const joystickSide = useSettingsStore((state) => state.joystickSide)
  const inputRef = useRef<WalkInput>({ forward: 0, turn: 0 })
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase')
  const cameraControllerRef = useRef<CameraControllerState>({
    yaw: 0,
    pitch: 0.35,
    distance: 12,
    mode: 'chase',
    setPreset: () => {},
    resetCamera: () => {},
  })
  // Fingers (or the mouse) currently dragging the view: one orbits, two pinch-zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
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
    const coarse = window.matchMedia('(pointer: coarse)')
    const pointerChange = () => setTouch(coarse.matches)
    window.addEventListener('resize', resize)
    coarse.addEventListener('change', pointerChange)
    return () => { window.removeEventListener('resize', resize); coarse.removeEventListener('change', pointerChange) }
  }, [])

  useEffect(() => {
    const feature = bootstrap.waypoints.features.find((item) => item.properties.id === nextWaypointId)
    if (!feature) return
    const [lon, lat] = feature.geometry.coordinates
    if (Math.hypot(coordinate.longitude - lon, coordinate.latitude - lat) < 0.00025) {
      useMissionStore.getState().setSelectedWaypoint(nextWaypointId)
    }
  }, [coordinate, nextWaypointId, bootstrap.waypoints.features])

  // Leaving free walk must not leave a joystick deflection behind.
  useEffect(() => { if (guided) inputRef.current = { forward: 0, turn: 0 } }, [guided])

  // Below 3 m the orbit camera would sit inside the suit, so zooming in past it enters POV and zooming out leaves it.
  const applyDistance = useCallback((requested: number) => {
    const ctrl = cameraControllerRef.current
    let distance = THREE.MathUtils.clamp(requested, 0.2, 80)
    if (distance < 3) distance = distance < ctrl.distance ? 0.2 : 3
    const mode: CameraMode = distance <= 0.6 ? 'pov' : distance > 30 ? 'drone' : 'chase'
    ctrl.distance = distance
    ctrl.mode = mode
    ctrl.pitch = clampPitch(ctrl.pitch, mode)
    setCameraMode(mode)
  }, [])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, input, aside, .pointer-events-auto')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(event.pointerId)
    if (!last) return
    const ctrl = cameraControllerRef.current
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size > 1) {
      const other = [...pointers.current].find(([id]) => id !== event.pointerId)![1]
      const before = Math.hypot(last.x - other.x, last.y - other.y)
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y)
      if (before > 0 && after > 0) applyDistance(ctrl.distance * before / after)
      return
    }
    // Default: the view follows the drag (drag right to look right, drag down to look down). Settings can flip either axis.
    const { invertLookX, invertLookY } = useSettingsStore.getState()
    ctrl.yaw -= (event.clientX - last.x) * 0.005 * (invertLookX ? -1 : 1)
    ctrl.pitch = clampPitch(ctrl.pitch + (event.clientY - last.y) * 0.005 * (invertLookY ? -1 : 1), ctrl.mode)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
  }

  const containerRef = useRef<HTMLDivElement>(null)

  // Non-passive wheel listener with e.preventDefault to strictly block browser page zoom on trackpad pinch
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      applyDistance(cameraControllerRef.current.distance + event.deltaY * 0.015)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyDistance])

  const handleZoomIn = () => applyDistance(cameraControllerRef.current.distance * 0.75)
  const handleZoomOut = () => applyDistance(cameraControllerRef.current.distance * 1.35)

  return <div
    ref={containerRef}
    className="marswalk-shell overflow-hidden bg-[#9b472c] select-none cursor-grab active:cursor-grabbing touch-none"
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerUp}
    onPointerCancel={handlePointerUp}
  >
    <Canvas shadows={false} dpr={compact ? 1 : [1, 2]} camera={{ fov: 52, near: 0.2, far: compact ? 3200 : 5000, position: [0, 8, 15] }} gl={{ antialias: !compact, stencil: true, powerPreference: 'high-performance' }}>
      <Suspense fallback={<SuspenseFallback />}>
        <Scene
          route={route}
          scene={bootstrap.scene}
          onTelemetry={(telemetry) => {
            if (telemetry.routeIndex !== null) setRouteIndex(telemetry.routeIndex)
          }}
          inputRef={inputRef}
          compact={compact}
          cameraControllerRef={cameraControllerRef}
          onCameraModeChange={setCameraMode}
        />
      </Suspense>
    </Canvas>

    <div className="absolute left-3 top-3 z-10">
      <button className="flex h-10 items-center gap-1.5 rounded border border-ink bg-panel pl-2 pr-3 text-[13px] font-medium text-ink hover:bg-panel-2" onClick={() => transitionTo('planner')}>
        <ChevronLeft size={16} /> Planner
      </button>
    </div>

    {/* The joystick stacks on top of the control panel, so it can never cover it whatever height the panel wraps to. */}
    <div className="pointer-events-none absolute inset-x-[max(.75rem,env(safe-area-inset-left))] bottom-[max(.75rem,env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-3xl flex-col gap-2">
      {!guided && touch && <Joystick inputRef={inputRef} side={joystickSide} />}
      <div className="pointer-events-auto rounded border border-ink bg-panel p-3">
      {!guided && !touch && <p className="mb-3 text-center text-xs text-ink-3"><span className="num text-ink-2">W/S</span> walk · <span className="num text-ink-2">A/D</span> turn · drag to look · scroll to zoom</p>}
      {guided && <div className="mb-3 flex items-center gap-3">
        <span className="num w-9 text-right text-xs text-ink-2">{Math.round(progress * 100)}%</span>
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
        <span className="num min-w-28 text-right text-xs text-ink-2">
          {((route.metrics.distance_m * progress) / 1000).toFixed(2)} / {(route.metrics.distance_m / 1000).toFixed(2)} km
        </span>
      </div>}

      <div className="flex items-center justify-center gap-2 border-b border-rule pb-3" data-tour="walk-mode">
        <button
          className="flex h-9 items-center gap-1.5 rounded border border-ink px-3 text-[13px] font-medium text-ink hover:bg-panel-2"
          onClick={() => setWalkState({ guided: !guided, playing: false })}
          title={guided ? 'Switch to free walking' : 'Switch to guided tour'}
        >
          <Footprints size={14} className={guided ? 'text-rust' : 'text-ink-3'} />
          {guided ? 'Guided Tour' : 'Free Walk'}
        </button>

        <button
          className="grid size-10 place-items-center rounded bg-ink text-panel hover:bg-ink-2 disabled:opacity-35"
          disabled={!guided}
          onClick={() => setWalkState({ playing: !playing })}
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={16} /> : <Play size={16} className="translate-x-px" />}
        </button>

        <button
          className="flex h-9 items-center gap-1.5 rounded border border-ink px-3 text-ink hover:bg-panel-2"
          onClick={cycleSpeed}
          title="Cycle playback speed"
        >
          <FastForward size={13} className="text-ink-3" />
          <span className="num text-xs">{speed}×</span>
        </button>

        <button
          className="grid size-9 place-items-center rounded border border-ink text-ink hover:bg-panel-2"
          onClick={() => setWalkState({ progress: 0, playing: false })}
          title="Reset to mission origin"
          aria-label="Reset to mission origin"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <div className="flex flex-col items-center justify-between gap-3 pt-3 sm:flex-row">
        <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:w-auto sm:justify-start">
          <div className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="label text-ink-3">Suit energy</span>
            <strong className="num text-[15px] font-bold text-ink">{Math.round(remaining).toLocaleString()} EU</strong>
            <span className={`text-xs font-medium ${remaining > mission.energy_budget * mission.return_reserve_pct / 100 ? 'text-safe' : 'text-caution'}`}>
              {remaining > mission.energy_budget * mission.return_reserve_pct / 100 ? 'Above reserve' : 'Below reserve'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              className="h-8 rounded border border-ink px-2 text-xs text-ink-2 hover:bg-panel-2 hover:text-ink"
              onClick={() => applyEnergyLoss()}
              title="Simulate 20% suit energy loss"
            >
              <span className="num">−20%</span>
            </button>
            <button
              className="flex h-8 items-center gap-1.5 rounded bg-danger px-3 text-[13px] font-semibold text-panel hover:bg-danger/85"
              onClick={() => requestEmergency(coordinate)}
              title="Emergency abort path to habitat"
            >
              <AlertTriangle size={13} />
              Abort
            </button>
          </div>
        </div>

        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end" data-tour="walk-camera">
          <div className="flex items-center rounded border border-ink">
            <button
              className="grid size-8 place-items-center text-ink-2 hover:text-ink"
              onClick={handleZoomIn}
              title="Zoom camera in"
              aria-label="Zoom in"
            >
              <Plus size={13} />
            </button>
            <button
              className="grid size-8 place-items-center border-l border-ink text-ink-2 hover:text-ink"
              onClick={handleZoomOut}
              title="Zoom camera out"
              aria-label="Zoom out"
            >
              <Minus size={13} />
            </button>
          </div>

          <div className="flex items-center rounded border border-ink">
            {(['chase', 'drone', 'pov'] as const).map((mode) => (
              <button
                key={mode}
                className={`h-8 px-2.5 text-xs font-medium capitalize ${
                  cameraMode === mode ? 'bg-ink text-panel' : 'text-ink-2 hover:text-ink'
                }`}
                onClick={() => cameraControllerRef.current.setPreset(mode)}
                title={`Switch camera view to ${mode}`}
              >
                {mode === 'pov' ? 'POV' : mode}
              </button>
            ))}
            <button
              className="grid size-8 place-items-center border-l border-ink text-ink-2 hover:text-ink"
              onClick={() => cameraControllerRef.current.resetCamera()}
              title="Reset view to chase angle"
              aria-label="Reset Camera View"
            >
              <Compass size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>

    </div>

    {selectedWaypoint && <WaypointOverlay />}
  </div>
}

/** Thumb stick for free walk: push up/down to walk, sideways to turn. Writes straight to a ref so dragging never re-renders the scene. */
function Joystick({ inputRef, side }: { inputRef: React.MutableRefObject<WalkInput>; side: 'left' | 'right' }) {
  const knob = useRef<HTMLSpanElement>(null)
  const active = useRef<number | null>(null)
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const reach = bounds.width / 2 - 28
    let x = event.clientX - (bounds.left + bounds.width / 2)
    let y = event.clientY - (bounds.top + bounds.height / 2)
    const length = Math.hypot(x, y)
    if (length > reach) { x *= reach / length; y *= reach / length }
    if (knob.current) knob.current.style.transform = `translate(${x}px, ${y}px)`
    // A dead zone stops a resting thumb from drifting, and walking straight from turning by accident.
    const axis = (value: number) => Math.abs(value) < 0.18 ? 0 : Math.sign(value) * (Math.abs(value) - 0.18) / 0.82
    inputRef.current = { forward: axis(-y / reach), turn: axis(-x / reach) }
  }
  const release = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== active.current) return
    active.current = null
    if (knob.current) knob.current.style.transform = ''
    inputRef.current = { forward: 0, turn: 0 }
  }
  useEffect(() => () => { inputRef.current = { forward: 0, turn: 0 } }, [inputRef])
  return (
    <div
      className={`pointer-events-auto grid size-36 touch-none place-items-center rounded-full ${side === 'right' ? 'self-end' : 'self-start'}`}
      role="application"
      aria-label="Walk joystick"
      onPointerDown={(event) => {
        if (active.current !== null) return
        active.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId)
        move(event)
      }}
      onPointerMove={(event) => { if (event.pointerId === active.current) move(event) }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span className="pointer-events-none grid size-28 place-items-center rounded-full border border-ink bg-panel/55">
        <span ref={knob} className="size-12 rounded-full border border-panel bg-ink/75" />
      </span>
    </div>
  )
}

function SuspenseFallback() {
  return <Html center><div className="terrain-loader flex min-w-48 items-center gap-3 rounded border border-ink bg-panel px-4 py-3"><span className="spinner" /><strong className="text-[13px] font-medium text-ink">Streaming Jezero terrain…</strong></div></Html>
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
      <aside className="absolute inset-x-3 bottom-3 z-30 max-h-[70svh] overflow-auto rounded border border-ink bg-panel p-5 md:inset-auto md:right-4 md:top-4 md:w-84">
        <button className="absolute right-3 top-3 grid size-8 place-items-center rounded text-ink-3 hover:bg-panel-2 hover:text-ink" onClick={() => setSelected(null)} aria-label="Close checkpoint details"><X size={15} /></button>
        <span className="label flex items-center gap-1.5 text-ink-3">
          <MapPin size={13} /> Custom Checkpoint
        </span>
        <h2 className="mb-1 mt-1 pr-8 text-lg font-bold text-ink">{customStop.name}</h2>
        <p className="num mb-3 text-xs text-ink-3">Coord: {customStop.latitude.toFixed(4)}°N, {customStop.longitude.toFixed(4)}°E</p>
        {nearestImage && (
          <div className="mb-3">
            <img className="aspect-video w-full rounded-sm object-cover" src={`/assets/thumbnails/surface/${nearestImage.img.product_id}.jpg`} alt="Nearest rover observation" />
            <p className="mt-1 text-[10px] text-ink-3">Nearest Observation · Sol {nearestImage.img.sol} ({distStr} away)</p>
          </div>
        )}
        <p className="border-t border-rule pt-2 text-xs text-ink-3">User-defined exploration stop</p>
      </aside>
    )
  }

  if (!waypoint) return null

  const images = bootstrap.surface_images.filter((item) => item.waypoint_id === id)
  const evidence = bootstrap.science_evidence[id]
  if (!waypoint) return null
  const stat = (label: string, value: string) => (
    <div>
      <dt className="label text-ink-3">{label}</dt>
      <dd className="num mt-1 text-[15px] font-bold leading-none text-ink">{value}</dd>
    </div>
  )
  return <aside className="absolute inset-x-3 bottom-3 z-30 max-h-[70svh] overflow-auto rounded border border-ink bg-panel p-5 md:inset-auto md:right-4 md:top-4 md:w-84">
    <button className="absolute right-3 top-3 grid size-8 place-items-center rounded text-ink-3 hover:bg-panel-2 hover:text-ink" onClick={() => setSelected(null)} aria-label="Close target details"><X size={15} /></button>
    <p className="label text-ink-3">Science target · Sol <span className="num">{waypoint.properties.sol}</span></p>
    <h2 className="mb-2 mt-1 pr-8 text-lg font-bold leading-snug text-ink">{waypoint.properties.name}</h2>
    <p className="mb-3 text-[13px] leading-relaxed text-ink-2">{waypoint.properties.science_rationale}</p>
    {images[0] && <img className="aspect-video w-full rounded-sm object-cover" src={`/assets/thumbnails/surface/${images[0].product_id}.jpg`} alt="Rover observation" />}
    <dl className="mt-3 grid grid-cols-3 gap-3 border-y border-rule py-3">
      {stat('Priority', `${waypoint.properties.priority} of 3`)}
      {stat('Geology', evidence?.geology_symbol ?? '—')}
      {stat('OLINDEX3', evidence?.crism.olindex3?.toFixed(3) ?? 'nodata')}
    </dl>
    <p className="mt-3 text-xs text-ink-3">Measured: Mastcam-Z and Navcam imagery. Derived: CRISM and USGS Nili units.</p>
  </aside>
}

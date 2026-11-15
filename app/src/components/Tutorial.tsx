import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMissionStore } from '../store'
import { useSettingsStore } from '../settingsStore'
import { Button } from './ui/button'

type Step = {
  title: string
  body: string
  /** Matches a `data-tour` attribute; the card is centred when the element is missing or hidden. */
  target?: string
  view?: 'planner' | 'marswalk'
  sidebar?: boolean
}

const STEPS: Step[] = [
  { title: 'Welcome to ARES Path', body: 'A one-minute tour of how to get around. Use Next and Back, or the arrow keys. You can replay it any time from Settings.' },
  { view: 'planner', target: 'views', title: 'Two views', body: 'Use Planner to build and edit your EVA mission. Explore the route in MarsWalk, where you can open a full map without leaving the walk.' },
  { view: 'planner', sidebar: false, target: 'map', title: 'The mission map', body: 'Drag to pan and scroll or pinch to zoom. Select a science target to see why it matters.' },
  { view: 'planner', sidebar: true, target: 'traverse', title: 'Your traverse', body: 'Stops are visited in this order. Drag a stop to reorder it, remove it with the bin, or add your own stop on the map.' },
  { view: 'planner', sidebar: true, target: 'reset-route', title: 'Back to our proposed route', body: 'Changed too much? This restores the route we propose, in one click.' },
  { view: 'marswalk', target: 'walk-mode', title: 'Guided tour or free walk', body: 'Guided Tour plays the route for you. Switch to Free Walk to move yourself: W/S or the joystick to walk, A/D to turn.' },
  { view: 'marswalk', target: 'walk-camera', title: 'Camera', body: 'Drag anywhere on the terrain to look around. Pick Chase, Drone or POV, and zoom with the scroll wheel, a pinch, or the + and − buttons.' },
  { view: 'marswalk', title: 'Inspect a waypoint', body: 'Within 20 metres of a mission waypoint, its details open automatically once during this mission. After closing them, use View details near that waypoint to open them again.' },
  { view: 'marswalk', target: 'minimap', title: 'Where you are', body: 'The minimap follows your position and heading. Use + and − to zoom, or collapse it for a clearer view.' },
  { view: 'marswalk', target: 'expand-map', title: 'Open the full map', body: 'Click the minimap or press M for the full mission map. Movement pauses while it is open. Press M or Esc to return, then Play to resume Guided Tour. Use Open Planner when you want to edit the mission.' },
  { target: 'settings', title: 'Settings and help', body: 'Invert the Free Marswalk camera, move the joystick to the other side, or replay this tutorial from here.' },
]

type Box = { top: number; left: number; width: number; height: number }

export function Tutorial() {
  const open = useSettingsStore((state) => state.tutorialOpen)
  const finish = useSettingsStore((state) => state.finishTutorial)
  const canWalk = useMissionStore((state) => Boolean(state.plan?.primary))
  const steps = useMemo(() => STEPS.filter((step) => step.view !== 'marswalk' || canWalk), [canWalk])
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [cardStyle, setCardStyle] = useState<React.CSSProperties>({})
  const card = useRef<HTMLDivElement>(null)
  const step = steps[Math.min(index, steps.length - 1)]
  const last = index >= steps.length - 1

  useEffect(() => { if (open) setIndex(0) }, [open])

  // Bring the step's screen into place before pointing at it.
  useEffect(() => {
    if (!open) return
    const mission = useMissionStore.getState()
    if (step.view && mission.view !== step.view) mission.setView(step.view)
    if ((step.target === 'minimap' || step.target === 'expand-map') && !mission.minimapOpen) mission.setMinimapOpen(true)
    if (step.sidebar !== undefined && (step.sidebar || window.innerWidth < 768) && mission.sidebarOpen !== step.sidebar) mission.setSidebarOpen(step.sidebar)
  }, [open, step])

  // Targets can mount late (lazy MarsWalk) or move (resize), so keep measuring while the step is shown.
  useEffect(() => {
    if (!open) return
    const measure = () => {
      const element = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null
      const rect = element?.getBoundingClientRect()
      const next = rect && rect.width > 0 && rect.height > 0 ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null
      setBox((previous) => (previous && next && previous.top === next.top && previous.left === next.left && previous.width === next.width && previous.height === next.height) || (!previous && !next) ? previous : next)
    }
    measure()
    const timer = window.setInterval(measure, 200)
    window.addEventListener('resize', measure)
    return () => { window.clearInterval(timer); window.removeEventListener('resize', measure) }
  }, [open, step])

  useLayoutEffect(() => {
    if (!open || !card.current) return
    const { offsetWidth: width, offsetHeight: height } = card.current
    const gap = 12
    if (!box) { setCardStyle({ top: Math.max(gap, (window.innerHeight - height) / 2), left: Math.max(gap, (window.innerWidth - width) / 2) }); return }
    const below = box.top + box.height + gap
    const above = box.top - gap - height
    const top = below + height <= window.innerHeight - gap ? below : above >= gap ? above : Math.max(gap, (window.innerHeight - height) / 2)
    const left = Math.min(Math.max(gap, box.left + box.width / 2 - width / 2), Math.max(gap, window.innerWidth - width - gap))
    setCardStyle({ top, left })
  }, [open, box, index])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish()
      else if (event.key === 'ArrowRight') setIndex((value) => Math.min(steps.length - 1, value + 1))
      else if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, finish, steps.length])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70]" data-testid="tutorial">
      {/* The spotlight's oversized shadow dims everything except the highlighted control. */}
      {box
        ? <div className="pointer-events-none fixed rounded border-2 border-route shadow-[0_0_0_200vmax_rgb(0_0_0/0.5)] transition-all duration-200" style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }} />
        : <div className="fixed inset-0 bg-black/50" />}
      <div ref={card} role="dialog" aria-modal="true" aria-label={`Tutorial: ${step.title}`} className="fixed w-[min(21rem,calc(100vw-1.5rem))] rounded border border-ink bg-panel p-4 text-ink" style={cardStyle}>
        <p className="label text-ink-3">Step <span className="num">{index + 1}</span> of <span className="num">{steps.length}</span></p>
        <h2 className="mt-1 text-[15px] font-bold">{step.title}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <button className="mr-auto text-xs font-medium text-ink-3 underline underline-offset-2 hover:text-ink" onClick={finish}>{last ? 'Close' : 'Skip tutorial'}</button>
          {index > 0 && <Button variant="secondary" size="sm" onClick={() => setIndex(index - 1)}>Back</Button>}
          <Button size="sm" autoFocus key={index} onClick={() => (last ? finish() : setIndex(index + 1))}>{last ? 'Done' : 'Next'}</Button>
        </div>
      </div>
    </div>
  )
}

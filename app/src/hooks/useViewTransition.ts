import { useCallback } from 'react'
import { flushSync } from 'react-dom'
import { useMissionStore } from '../store'

type AppView = 'planner' | 'marswalk'
type ViewTransition = { finished: Promise<void> }
type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransition
}

export function useViewTransition() {
  const view = useMissionStore((state) => state.view)
  const reducedMotion = useMissionStore((state) => state.reducedMotion)
  const transitioning = useMissionStore((state) => state.viewTransitioning)
  const setView = useMissionStore((state) => state.setView)
  const setTransitioning = useMissionStore((state) => state.setViewTransitioning)

  const transitionTo = useCallback((next: AppView) => {
    if (next === view || transitioning) return
    const changeView = () => flushSync(() => setView(next))
    const documentWithTransitions = document as TransitionDocument
    const shouldReduceMotion = reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!documentWithTransitions.startViewTransition || shouldReduceMotion) {
      changeView()
      return
    }

    setTransitioning(true)
    const transition = documentWithTransitions.startViewTransition(changeView)
    void transition.finished.finally(() => setTransitioning(false))
  }, [reducedMotion, setTransitioning, setView, transitioning, view])

  return { transitionTo, transitioning }
}

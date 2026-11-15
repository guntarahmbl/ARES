import { useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Map as MapIcon, X } from 'lucide-react'
import { MarsMap } from './MarsMap'
import { useMissionStore } from '../store'
import { useViewTransition } from '../hooks/useViewTransition'

export function MarsWalkMap() {
  const open = useMissionStore((state) => state.walkMapOpen)
  const setOpen = useMissionStore((state) => state.setWalkMapOpen)
  const previousFocus = useRef<HTMLElement | null>(null)
  const { transitionTo } = useViewTransition()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('textarea, select'))) return
      if (target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit', 'reset'].includes(target.type)) return
      if (event.code !== 'KeyM') return
      const current = useMissionStore.getState().walkMapOpen
      if (!current && document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      setOpen(!current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setOpen])

  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/60" />
      <Dialog.Content
        className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded border border-ink bg-panel text-ink outline-none sm:inset-6"
        onOpenAutoFocus={() => { previousFocus.current = document.activeElement as HTMLElement | null }}
        onCloseAutoFocus={(event) => { event.preventDefault(); previousFocus.current?.focus() }}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink px-3 py-2 sm:px-4">
          <div>
            <Dialog.Title className="flex items-center gap-2 text-sm font-bold"><MapIcon size={16} /> Mission map</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-ink-3">MarsWalk paused · M or Esc to return</Dialog.Description>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button className="rounded border border-ink px-2 py-2 text-xs font-medium hover:bg-panel-2 sm:px-3" onClick={() => { setOpen(false); transitionTo('planner') }}>Open Planner</button>
            <Dialog.Close className="grid size-9 place-items-center rounded hover:bg-panel-2" aria-label="Close full map"><X size={18} /></Dialog.Close>
          </div>
        </div>
        <div className="relative min-h-0 flex-1"><MarsMap readOnly /></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

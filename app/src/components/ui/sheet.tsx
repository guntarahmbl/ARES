import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

export function Sheet({ open, onOpenChange, title, children, side = 'right' }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; side?: 'left' | 'right' | 'bottom' }) {
  const position = side === 'bottom'
    ? 'inset-x-0 bottom-0 max-h-[90svh] border-t'
    : side === 'left'
    ? 'inset-y-0 left-0 w-[min(92vw,400px)] border-r'
    : 'inset-y-0 right-0 w-[min(92vw,460px)] border-l'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/35" />
        <Dialog.Content aria-describedby={undefined} className={cn('fixed z-50 flex flex-col border-ink bg-panel text-ink', position)}>
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-ink pl-5 pr-2">
            <Dialog.Title className="text-[15px] font-bold text-ink">{title}</Dialog.Title>
            <Dialog.Close className="grid size-8 place-items-center rounded text-ink-2 hover:bg-panel-2 hover:text-ink" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

export function Sheet({ open, onOpenChange, title, children, side = 'right' }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; side?: 'left' | 'right' | 'bottom' }) {
  const position = side === 'bottom'
    ? 'inset-x-0 bottom-0 max-h-[90svh] rounded-t-xl border-t'
    : side === 'left'
    ? 'inset-y-0 left-0 w-[min(90vw,400px)] border-r'
    : 'inset-y-0 right-0 w-[min(90vw,440px)] border-l'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity" />
        <Dialog.Content className={cn('fixed z-50 overflow-y-auto border-white/15 bg-[#0d1117] p-5 shadow-2xl backdrop-blur-md', position)}>
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <Dialog.Title className="text-sm font-semibold tracking-wide uppercase text-white/95">{title}</Dialog.Title>
            <Dialog.Close className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

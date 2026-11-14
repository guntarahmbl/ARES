import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded px-3.5 text-[13px] font-semibold transition-colors disabled:pointer-events-none select-none',
  {
    variants: {
      variant: {
        default: 'bg-ink text-panel hover:bg-ink-2 disabled:bg-transparent disabled:font-medium disabled:text-ink-3',
        secondary: 'border border-ink bg-panel text-ink hover:bg-panel-2 disabled:border-rule disabled:text-ink-3',
        ghost: 'text-ink-2 hover:bg-panel-2 hover:text-ink disabled:text-ink-3',
        danger: 'border border-danger text-danger hover:bg-danger/10',
      },
      size: {
        default: 'h-10',
        icon: 'size-9 p-0',
        sm: 'h-8 px-2.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export function Button({ className, variant, size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

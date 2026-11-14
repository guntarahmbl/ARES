import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded px-3.5 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        default: 'bg-ink text-ground hover:bg-white',
        secondary: 'border border-rule bg-panel-2 text-ink hover:border-ink-3',
        ghost: 'text-ink-2 hover:bg-panel-2 hover:text-ink',
        danger: 'border border-danger/50 text-danger hover:bg-danger/10',
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

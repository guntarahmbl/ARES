import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 text-xs font-semibold tracking-wide transition-all disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        default: 'bg-mars text-[#140b07] hover:bg-[#efa06d] active:scale-[0.98] shadow-sm',
        secondary: 'border border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08] active:scale-[0.98]',
        ghost: 'bg-transparent text-white/75 hover:bg-white/10 hover:text-white',
        danger: 'border border-danger/40 bg-danger/20 text-danger hover:bg-danger/30 active:scale-[0.98]',
      },
      size: {
        default: 'h-10',
        icon: 'size-9 min-h-9 p-0',
        sm: 'h-8 min-h-8 px-2.5 text-xs',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export function Button({ className, variant, size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

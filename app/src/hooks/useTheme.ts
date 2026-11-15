import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'ares-theme'
const listeners = new Set<() => void>()

const current = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#18191c' : '#f4f5f1')
  try { localStorage.setItem(KEY, theme) } catch { /* storage blocked: theme still applies for this session */ }
  listeners.forEach((fn) => fn())
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => 'light' as Theme)
  const toggle = useCallback(() => applyTheme(current() === 'dark' ? 'light' : 'dark'), [])
  return { theme, toggle }
}

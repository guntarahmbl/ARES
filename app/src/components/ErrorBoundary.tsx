import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ARES Path UI failure', error, info)
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="grid h-full place-content-center justify-items-center gap-3 bg-ground p-6 text-center">
          <AlertTriangle size={28} className="text-caution" />
          <h1 className="text-lg font-semibold text-ink">Mission display interrupted</h1>
          <p className="max-w-sm text-[13px] text-ink-2">Your data is safe. Reload the local application to restore the prepared mission.</p>
          <button className="h-10 rounded bg-ink px-4 text-[13px] font-medium text-ground hover:bg-white" onClick={() => location.reload()}>Reload ARES Path</button>
        </main>
      )
    }
    return this.props.children
  }
}


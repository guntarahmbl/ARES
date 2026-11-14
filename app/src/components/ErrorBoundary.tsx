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
        <main className="fatal-state">
          <AlertTriangle size={36} />
          <h1>Mission display interrupted</h1>
          <p>Your data is safe. Reload the local application to restore the prepared mission.</p>
          <button className="primary-button" onClick={() => location.reload()}>Reload ARES Path</button>
        </main>
      )
    }
    return this.props.children
  }
}


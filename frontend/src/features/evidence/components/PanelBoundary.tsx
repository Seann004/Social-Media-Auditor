import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

/** Keeps a crash in the evidence panel from taking down the audit page. */
export default class PanelBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Evidence panel crashed:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <p role="alert" className="text-xs text-slate-500">
          AI evidence assessment could not be shown. The rest of the audit still works.
        </p>
      )
    }
    return this.props.children
  }
}

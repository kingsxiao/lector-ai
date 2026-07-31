// Top-level React error boundary for the side panel.
//
// Without a boundary, a render-time throw in any component tree leaves the
// panel BLANK (React unmounts the whole subtree and there is nothing to show
// the error). This boundary catches such throws and renders a recoverable
// diagnostic card so the user sees what went wrong instead of a white panel,
// and can hard-reset the persisted state if a corrupted settings object is the
// cause. It also logs the error + component stack to the console for debugging.
//
// Class component (React error boundaries require getDerivedStateFromError /
// componentDidCatch, which hooks cannot express).

import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null; stack: string | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, stack: error.stack || null }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.error('[Lector] render crashed:', error, info.componentStack || '')
  }

  /** Hard-reset the persisted BYOK settings + zustand localStorage, then
   *  reload. Used by the "reset" button when a corrupted settings shape is the
   *  suspected cause of the crash. Best-effort: wrapped so a missing chrome
   *  API in the reset path never blocks the reload. */
  resetAndReload = () => {
    try {
      window.localStorage.removeItem('lector-ai-storage')
      window.localStorage.removeItem('lector-byok-settings')
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove(['lector_byok_settings', 'lectorCache'], () => {
          window.location.reload()
        })
      } else {
        window.location.reload()
      }
    } catch {
      window.location.reload()
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    const msg = this.state.error.message || String(this.state.error)
    return (
      <div style={{ padding: 20, fontFamily: '-apple-system,system-ui,sans-serif', color: '#2B2620', maxWidth: 420 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 15, color: '#c0392b' }}>
          Lector hit an error
        </h2>
        <p style={{ fontSize: 12, lineHeight: 1.6, color: '#6B6155', margin: '0 0 12px' }}>
          The side panel failed to render. This is usually caused by a stale or
          corrupted settings object from an older version. Resetting your local
          settings (your API key will need to be re-entered) almost always fixes it.
        </p>
        <pre style={{
          fontSize: 10.5, lineHeight: 1.5, color: '#6B6155',
          background: '#F5EFE3', padding: 8, borderRadius: 6,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '0 0 12px',
          maxHeight: 160, overflow: 'auto',
        }}>{msg}</pre>
        <button
          onClick={this.resetAndReload}
          style={{
            padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: '#9C6B3C', color: '#FFF8EE', border: 'none', borderRadius: 8,
          }}
        >
          Reset settings &amp; reload
        </button>
      </div>
    )
  }
}

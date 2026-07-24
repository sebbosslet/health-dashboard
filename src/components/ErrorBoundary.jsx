import { Component } from 'react'

/**
 * A crash inside one app should never blank the whole page.
 * Shows what broke and offers a way back to the hub.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('App crashed:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        position: 'fixed', inset: 0, overflowY: 'auto', background: '#faf8f3', color: '#1f2421',
        fontFamily: "'DM Sans', system-ui, sans-serif", padding: '48px 24px',
      }}>
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <h1 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontWeight: 400, fontSize: 26, marginBottom: 8 }}>
            Something broke
          </h1>
          <p style={{ color: '#6b6f6a', fontSize: 14.5, lineHeight: 1.6, marginBottom: 18 }}>
            This screen hit an error. Your data is safe — nothing was saved in this state.
          </p>
          <pre style={{
            background: '#fff', border: '1px solid #e7e3d9', borderRadius: 10, padding: '14px 16px',
            fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#b5462f', marginBottom: 18,
          }}>{String(this.state.error?.message || this.state.error)}</pre>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => window.location.assign('/')} style={btn(true)}>All apps</button>
            <button onClick={() => window.location.reload()} style={btn(false)}>Reload</button>
          </div>
        </div>
      </div>
    )
  }
}

const btn = (primary) => ({
  font: 'inherit', fontSize: 14, cursor: 'pointer', borderRadius: 8, padding: '7px 14px',
  border: `1px solid ${primary ? '#2d6a4f' : '#e7e3d9'}`,
  background: primary ? '#2d6a4f' : '#fff', color: primary ? '#fff' : '#1f2421',
})

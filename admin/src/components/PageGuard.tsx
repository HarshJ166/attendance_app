import { Component, type ReactNode } from 'react';

/**
 * If one page crashes, show what happened on that page instead of blanking the whole panel.
 * Keyed by page in App.tsx, so navigating away resets it.
 */
export class PageGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[GeoMark admin] page crashed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="notice error" role="alert" style={{ display: 'grid', gap: 8 }}>
          <b>This page hit a problem and couldn’t load.</b>
          <span className="mono">{this.state.error.message}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn small" onClick={() => location.reload()}>Reload</button>
            <a className="btn secondary small" href="#/">Go to Dashboard</a>
          </div>
        </div>
      </div>
    );
  }
}

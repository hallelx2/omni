import { Component, type ErrorInfo, type ReactNode } from "react"

interface State {
  error: Error | null
}

/** Last-resort boundary: shows the error (inline-styled, no Tailwind dependency). */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("Omni UI crashed:", error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          background: "#0d0f14",
          color: "#e7e9ee",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 640, width: "100%" }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Something broke in the UI</div>
          <div style={{ color: "#ff8a80", fontFamily: "ui-monospace, monospace", fontSize: 13, marginBottom: 12 }}>
            {error.message}
          </div>
          <pre
            style={{
              maxHeight: 280,
              overflow: "auto",
              background: "#15181f",
              border: "1px solid #262b36",
              borderRadius: 8,
              padding: 12,
              fontSize: 11.5,
              lineHeight: 1.5,
              color: "#9aa3b2",
              whiteSpace: "pre-wrap",
            }}
          >
            {error.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 14,
              padding: "8px 14px",
              borderRadius: 8,
              border: "none",
              background: "#6c5cf6",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}

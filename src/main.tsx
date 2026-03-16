import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { markPerf } from "./lib/utils/perf";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("Maestro Root Error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: '#ff0000', backgroundColor: '#fff', width: '100vw', height: '100vh', boxSizing: 'border-box', overflow: 'auto', zIndex: 99999, position: 'fixed', top: 0, left: 0 }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '1rem' }}>Application Error (Tauri/WebKit)</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '14px', fontFamily: 'monospace' }}>
            {this.state.error?.stack || String(this.state.error)}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#ff0000', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Tauri/WebKit 下 StrictMode 的双重 effect 执行可能与部分依赖冲突，暂时禁用
const Root = React.Fragment;

markPerf("app_bootstrap_start");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Root>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </Root>,
);

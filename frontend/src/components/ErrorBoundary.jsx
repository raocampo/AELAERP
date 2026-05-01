// ErrorBoundary — captura errores JS en el árbol de componentes
// y muestra una pantalla de error en lugar de una pantalla en blanco.
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error('[AELA ErrorBoundary]', error, info?.componentStack);
  }

  handleReload() {
    // Limpiar el cache del SW si existe para evitar versiones obsoletas
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      });
    }
    window.location.reload();
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          color: '#f1f5f9',
          fontFamily: 'system-ui, sans-serif',
          padding: 24,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Algo salió mal</h1>
          <p style={{ color: '#94a3b8', marginBottom: 24, maxWidth: 480 }}>
            El sistema encontró un error inesperado. Puedes recargar la página para intentarlo de nuevo.
          </p>
          <details style={{ background: '#1e293b', borderRadius: 8, padding: '12px 16px', maxWidth: 600, width: '100%', textAlign: 'left', marginBottom: 24 }}>
            <summary style={{ cursor: 'pointer', color: '#64748b', fontSize: 13 }}>Ver detalles del error</summary>
            <pre style={{ color: '#f87171', fontSize: 12, marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {this.state.error?.toString()}
              {this.state.info?.componentStack}
            </pre>
          </details>
          <button
            onClick={this.handleReload}
            style={{
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 24px',
              fontSize: 15,
              cursor: 'pointer',
            }}
          >
            🔄 Recargar aplicación
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

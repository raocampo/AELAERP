import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import { registrarServiceWorker } from './utils/syncQueue'

// Auto-recuperación: si un módulo lazy-load falla (hash viejo tras redeploy),
// limpiamos SW + caches y recargamos automáticamente.
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || '';
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module')
  ) {
    const reload = () => window.location.reload();
    const clearAndReload = () =>
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .finally(reload);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {})
        .finally(clearAndReload);
    } else {
      clearAndReload();
    }
  }
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Registrar Service Worker para capacidades offline (PWA)
registrarServiceWorker()

# Guía de Implementación — Características Reutilizables en SUJAM y SGD-LTYC

Este documento describe cómo trasladar a SUJAM y SGD-LTYC las mejoras desarrolladas en AELA.
Está organizado por funcionalidad, con la ruta exacta de cada archivo de referencia.

---

## Índice

1. [Cola SRI + Worker de Reintentos](#1-cola-sri--worker-de-reintentos)
2. [PWA — Service Worker + Caché Offline](#2-pwa--service-worker--caché-offline)
3. [IndexedDB + Cola de Sincronización Frontend](#3-indexeddb--cola-de-sincronización-frontend)
4. [Endpoint de Sincronización Backend](#4-endpoint-de-sincronización-backend)
5. [Banner Offline + Toast de Actualización](#5-banner-offline--toast-de-actualización)
6. [Scripts de Instalación y Actualización](#6-scripts-de-instalación-y-actualización)
7. [Declaraciones Tributarias](#7-declaraciones-tributarias)

---

## 1. Cola SRI + Worker de Reintentos

**Aplicable a:** AELA únicamente (los otros sistemas no integran SRI).

---

## 2. PWA — Service Worker + Caché Offline

**Aplicable a:** SUJAM, SGD-LTYC, AELA.

### Archivos a copiar (de AELA)

| Origen AELA | Destino en sistema hermano |
|-------------|----------------------------|
| `frontend/public/sw.js` | `frontend/public/sw.js` |
| `frontend/public/manifest.json` | `frontend/public/manifest.json` |

### Pasos de adaptación

**1. Ajustar manifest.json**

```json
{
  "name": "SUJAM — Sistema Único de Jornadas",
  "short_name": "SUJAM",
  "description": "...",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#1e40af",
  "icons": [{ "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml" }]
}
```

**2. Ajustar sw.js — rutas API cacheables**

En `sw.js`, editar `API_CACHEABLE` con las rutas de lectura frecuente de cada sistema:

```js
// SUJAM
const API_CACHEABLE = [
  '/api/pacientes',
  '/api/profesionales',
  '/api/servicios',
];

// SGD-LTYC
const API_CACHEABLE = [
  '/api/deportistas',
  '/api/disciplinas',
  '/api/instalaciones',
];
```

**3. Actualizar index.html**

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#1e40af" />
<meta name="mobile-web-app-capable" content="yes" />
```

**4. Registrar SW en main.jsx**

```js
// main.jsx — agregar al final
import { registrarServiceWorker } from './utils/syncQueue'
registrarServiceWorker()
```

---

## 3. IndexedDB + Cola de Sincronización Frontend

**Aplicable a:** SUJAM, SGD-LTYC, AELA.

### Archivos a copiar (copiar tal cual, sin modificar)

| Origen AELA | Destino |
|-------------|---------|
| `frontend/src/utils/offlineDB.js` | `frontend/src/utils/offlineDB.js` |
| `frontend/src/utils/syncQueue.js` | `frontend/src/utils/syncQueue.js` |

### Uso en componentes

```jsx
import { apiOffline, apiGet, estaOnline, onConectividadChange } from '../../utils/syncQueue';

// Guardar un registro (con fallback offline)
const resultado = await apiOffline('/pacientes', {
  method: 'POST',
  body: datosPaciente,
  entidad: 'paciente',
  descripcion: 'Nuevo paciente registrado offline',
  respuestaOptimista: { ...datosPaciente, id: `temp-${Date.now()}` },
});

if (resultado.offline) {
  toast.info('Sin conexión — el registro se guardará cuando vuelva el internet');
} else {
  toast.success('Paciente registrado');
}

// Leer datos con caché offline
const { data, offline } = await apiGet('/pacientes', { clave: 'lista_pacientes', ttl: 300 });
if (offline) toast.info('Mostrando datos guardados (sin internet)');
```

### Monitorear estado de conectividad

```jsx
import { estaOnline, onConectividadChange, pendientesLocales } from '../../utils/syncQueue';

// En un componente React
useEffect(() => {
  const unsub = onConectividadChange((online) => {
    setOffline(!online);
  });
  return unsub;
}, []);

// Badge de pendientes locales
const [pendientes, setPendientes] = useState(0);
useEffect(() => {
  pendientesLocales().then(setPendientes);
  window.addEventListener('AELA:sync-complete', () => pendientesLocales().then(setPendientes));
}, []);
```

---

## 4. Endpoint de Sincronización Backend

**Aplicable a:** SUJAM, SGD-LTYC, AELA.

### Archivo de referencia

`backend/routes/sync.js` — Copiar y adaptar la función `procesarOperacion()`.

### Adaptación por sistema

La única parte que cambia es el `switch (entidad)` en `procesarOperacion()`:

**SUJAM:**
```js
switch (entidad) {
  case 'paciente':    return crearPaciente(body, empresaId, usuario);
  case 'consulta':    return crearConsulta(body, empresaId, usuario);
  case 'medicamento': return registrarMedicamento(body, empresaId, usuario);
  default: throw new Error(`Entidad no soportada: ${entidad}`);
}
```

**SGD-LTYC:**
```js
switch (entidad) {
  case 'deportista':   return registrarDeportista(body, empresaId, usuario);
  case 'resultado':    return registrarResultado(body, empresaId, usuario);
  case 'asistencia':   return marcarAsistencia(body, empresaId, usuario);
  default: throw new Error(`Entidad no soportada: ${entidad}`);
}
```

### Registrar en server.js

```js
const syncRoutes = require('./routes/sync');
app.use('/api/sync', syncRoutes);
```

### Protección de conflictos (idempotencia)

El endpoint devuelve `409 Conflict` (no error) cuando el registro ya existe. El frontend lo trata como éxito y elimina la operación de la cola. Asegurarse de que el INSERT use `ON CONFLICT DO NOTHING` o que Prisma lance `P2002` al duplicar un campo único:

```js
const existe = await prisma.pacientes.findFirst({ where: { cedula: body.cedula } });
if (existe) throw new Error('ya existe');
```

---

## 5. Banner Offline + Toast de Actualización

**Aplicable a:** SUJAM, SGD-LTYC, AELA.

### Archivo de referencia

`frontend/src/components/Layout/Layout.jsx` — Copiar el bloque:

```jsx
const [offline, setOffline] = useState(!navigator.onLine);
const [swUpdate, setSwUpdate] = useState(false);

useEffect(() => {
  const onOnline  = () => setOffline(false);
  const onOffline = () => setOffline(true);
  const onSwUpdate = () => setSwUpdate(true);
  window.addEventListener('online',   onOnline);
  window.addEventListener('offline',  onOffline);
  window.addEventListener('AELA:sw-update', onSwUpdate);
  return () => {
    window.removeEventListener('online',  onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('AELA:sw-update', onSwUpdate);
  };
}, []);
```

Y el JSX:

```jsx
{offline && (
  <div className="banner-offline">
    Sin conexión — Puedes seguir trabajando. Los datos se sincronizarán al volver el internet.
  </div>
)}
{swUpdate && (
  <div className="toast-sw-update">
    <span>Nueva versión disponible.</span>
    <button onClick={() => window.location.reload()}>Actualizar ahora</button>
    <button onClick={() => setSwUpdate(false)}>Después</button>
  </div>
)}
```

### Estilos

Copiar de `frontend/src/components/Layout/Layout.css` los bloques:
- `.banner-offline`
- `.toast-sw-update`

---

## 6. Scripts de Instalación y Actualización

**Aplicable a:** SUJAM, SGD-LTYC, AELA.

### Archivos a copiar

| Origen AELA | Destino |
|-------------|---------|
| `scripts/install-linux.sh` | `scripts/install-linux.sh` |
| `scripts/install-windows.ps1` | `scripts/install-windows.ps1` |
| `scripts/update-linux.sh` | `scripts/update-linux.sh` |
| `scripts/update-windows.ps1` | `scripts/update-windows.ps1` |

### Variables a cambiar en cada script

Buscar y reemplazar en todos los scripts:

| Variable | AELA | SUJAM | SGD-LTYC |
|----------|------|-------|----------|
| Nombre sistema | `AELA` | `SUJAM` | `SGD-LTYC` |
| Nombre DB default | `aela_db` | `sujam_db` | `sgd_db` |
| Puerto backend default | `5600` | `5601` | `5602` |
| Puerto frontend default | `5174` | `5175` | `5176` |
| Nombre servicio Win | `AELA-Backend` | `SUJAM-Backend` | `SGDLTYC-Backend` |
| Nombre PM2 | `AELA-backend` | `sujam-backend` | `sgd-backend` |
| Directorio instalación Linux | `/opt/AELA` | `/opt/sujam` | `/opt/sgdltyc` |
| Directorio instalación Windows | `C:\AELA` | `C:\SUJAM` | `C:\SGDLTYC` |
| Variable env edición | `AELA_EDITION` | `SUJAM_EDITION` | `SGD_EDITION` |

### Pasos concretos para Linux

```bash
# 1. Copiar scripts al nuevo proyecto
cp AELA/scripts/install-linux.sh SUJAM/scripts/install-linux.sh

# 2. Reemplazar referencias (Linux/Mac)
sed -i 's/AELA/SUJAM/g; s/AELA/sujam/g; s/5600/5601/g; s/5174/5175/g' SUJAM/scripts/install-linux.sh

# 3. Revisar manualmente el .env template dentro del script
```

### Pasos concretos para Windows

```powershell
# En PowerShell
(Get-Content AELA\scripts\install-windows.ps1) `
  -replace 'AELA','SUJAM' `
  -replace 'AELA','sujam' `
  -replace '5600','5601' `
  -replace '5174','5175' `
  | Set-Content SUJAM\scripts\install-windows.ps1
```

---

## 7. Declaraciones Tributarias

**Aplicable a:** AELA únicamente.

SUJAM y SGD-LTYC no emiten comprobantes electrónicos, por lo que no requieren el módulo de declaraciones SRI.

---

## Checklist de implementación por sistema

### SUJAM

- [ ] Copiar `frontend/public/sw.js` — ajustar `API_CACHEABLE`
- [ ] Copiar `frontend/public/manifest.json` — ajustar nombre/colores
- [ ] Actualizar `frontend/index.html` — agregar meta PWA
- [ ] Copiar `frontend/src/utils/offlineDB.js`
- [ ] Copiar `frontend/src/utils/syncQueue.js`
- [ ] Actualizar `frontend/src/main.jsx` — llamar `registrarServiceWorker()`
- [ ] Copiar `backend/routes/sync.js` — adaptar `procesarOperacion()`
- [ ] Registrar `/api/sync` en `backend/server.js`
- [ ] Agregar banner offline en Layout
- [ ] Copiar y adaptar scripts de instalación

### SGD-LTYC

- [ ] Copiar `frontend/public/sw.js` — ajustar `API_CACHEABLE`
- [ ] Copiar `frontend/public/manifest.json` — ajustar nombre/colores
- [ ] Actualizar `frontend/index.html` — agregar meta PWA
- [ ] Copiar `frontend/src/utils/offlineDB.js`
- [ ] Copiar `frontend/src/utils/syncQueue.js`
- [ ] Actualizar `frontend/src/main.jsx` — llamar `registrarServiceWorker()`
- [ ] Copiar `backend/routes/sync.js` — adaptar `procesarOperacion()`
- [ ] Registrar `/api/sync` en `backend/server.js`
- [ ] Agregar banner offline en Layout
- [ ] Copiar y adaptar scripts de instalación

---

## Notas generales

- **Sin dependencias nuevas:** todo el código offline usa APIs nativas del navegador (IndexedDB, Service Worker, Background Sync). No requiere instalar paquetes npm adicionales.
- **Compatibilidad:** Chrome/Edge 80+, Firefox 75+, Safari 16+. En navegadores sin soporte a Background Sync, la sincronización se dispara con el evento `online` del navegador.
- **Seguridad:** el SW solo cachea rutas GET de la propia API. Los tokens JWT se leen de `localStorage` en cada request, no se cachean en el SW.
- **Tamaño de caché:** la caché del app shell se auto-limpia al activar el SW. La caché de API expira por TTL (configurable, por defecto 5 minutos para datos dinámicos).

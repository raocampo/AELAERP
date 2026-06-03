# AELA ERP — Sesión nocturna 2026-06-02
## Fix: 502 en Buzón SRI (patrón async job)

---

## ✅ Completado en esta sesión

### Fix crítico: 502 en descarga automática del Buzón SRI

**Problema confirmado:** El endpoint `POST /api/buzon/sri/consultar` retornaba 502 porque
Railway corta conexiones HTTP que no responden en ~60 segundos. El scraper Puppeteer puede
tardar 60–120 s, lo que supera ese límite. El proceso Node seguía corriendo correctamente
(por eso no había logs de error), pero Railway ya había cerrado la conexión.

**Fix — patrón async job** (`commit c9e76d8`):

| Componente | Antes | Ahora |
|-----------|-------|-------|
| `POST /sri/consultar` | Esperaba hasta que el scraper terminara (bloqueante) | Responde inmediatamente con `{ jobId, status: 'pending' }` |
| — | — | Lanza el scraper en background (IIFE async) |
| `GET /sri/job/:jobId` | No existía | Nuevo endpoint de polling: devuelve `pending`/`done`/`error` |
| Frontend `consultarSriAutomatico` | Axios esperaba la respuesta completa | POST para obtener jobId, luego polling cada 3 s (máx 4 min) |
| Botón de carga | Texto fijo "Navegando portal SRI... (~60s)" | Muestra mensaje dinámico del servidor en tiempo real |

**Archivos modificados:**
```
backend/routes/buzon.js                    ← SCRAPER_JOBS Map + GET /sri/job/:jobId + POST refactorizado
frontend/src/components/Buzon/BuzonSRI.jsx ← consultarSriAutomatico con polling + estado dmProgreso
```

**Flujo nuevo:**
```
1. Usuario hace clic → POST /api/buzon/sri/consultar
2. Backend responde en <100 ms: { jobId: "abc123", status: "pending" }
3. Scraper corre en background (Node no bloquea Railway)
4. Frontend polling cada 3 s: GET /api/buzon/sri/job/abc123
5. Backend responde { status: "pending", mensaje: "Navegando portal SRI..." }
6. ... (60–120 s después) ...
7. Backend: { status: "done", resultados: [...], total: N, nuevos: M }
8. Frontend sale del polling y muestra Paso 2 con los comprobantes
```

**Limpieza de jobs:** Los jobs se eliminan automáticamente del Map tras 15 minutos.

---

## 🔴 Pendientes para mañana (por prioridad)

### 1. Verificar que el fix del 502 funciona en producción
- Esperar ~3 min a que Railway despliegue el commit `c9e76d8`
- Ir a `aela.corpsimtelec.com/buzon` → Descarga automática
- Ingresar RUC + clave del portal SRI
- El botón debe mostrar el mensaje del servidor ("Navegando portal SRI...") sin 502
- Si sigue fallando, revisar Railway logs → buscar error del scraper (selectores JSF, login bloqueado, OOM)

### 2. Diagnosticar si Chrome está disponible en Railway
- En el Buzón → botón **"Diagnóstico SRI"**
- Resultado esperado:
  - SRI-Portal ✅
  - SRI-API-Movil ❌ 404 (normal, API desactivada)
  - Chrome ✅ con versión de Chromium
- Si Chrome ❌: el nixpacks.toml ya incluye chromium pero puede que el path no se resuelva → ver sección técnica abajo

### 3. Incertidumbre restante del scraper (pendiente de sesión 2026-06-02 AM)

Si el diagnóstico muestra Chrome ✅ pero la descarga automática devuelve `status: 'error'`:

| Síntoma en el error | Causa probable | Acción |
|--------------------|---------------|--------|
| `"No element found for selector"` en select de año/mes | Selectores JSF incorrectos — el portal usa otros IDs | Inspeccionar HTML real de `menu.jsf` con DevTools del SRI |
| `"ERR_NAME_NOT_RESOLVED"` o `"net::ERR_CONNECTION"` | SRI bloqueando IP de Railway (AWS us-east) | Usar Importar TXT/ZIP como método permanente |
| `"credenciales incorrectas"` | RUC/clave erróneos | El cliente debe verificar sus credenciales en srienlinea.sri.gob.ec |
| `"BROWSER_UNAVAILABLE"` | Chrome no encontrado | Verificar PUPPETEER_EXECUTABLE_PATH en Railway env vars |

### 4. mprq — Configuración SRI pendiente del cliente
- El tenant `mprq` necesita que el cliente suba su certificado .p12 en Configuración → SRI
- Sin el .p12 no puede firmar ni enviar comprobantes electrónicos al SRI
- **Acción:** Contactar al cliente mprq para que complete la configuración

### 5. Eliminar tenant loja-torneos-y-competencia
Ejecutar en DBeaver (o psql) sobre la BD master de Railway:
```sql
DELETE FROM aela_master.tenants WHERE slug = 'loja-torneos-y-competencia';
DROP DATABASE IF EXISTS aela_loja_torneos_y_competencia;
```

---

## 🟡 Pendientes medios

### 6. App móvil — Assets reales y prueba en dispositivo
- Carpeta `mobile/` ya tiene el código completo (React Native / Expo)
- Falta sustituir los assets placeholder por el logo real de AELA
- Probar en dispositivo Android/iOS con `expo start`

### 7. App móvil — Prueba impresora térmica ESC/POS
- El hook `mobile/hooks/usePrint.ts` y el backend `backend/utils/impresoraEscPos.js` ya están
- Probar con impresora IP fija en la misma red WiFi

---

## 🟢 Backlog (sin fecha)

| # | Tarea |
|---|-------|
| 8 | Pasarela de pagos — PayPhone o Stripe para activación automática de planes |
| 9 | Impuesto a la Renta en nómina (tabla LORTI) |
| 10 | App móvil — ESC/POS Bluetooth + escáner de código de barras |
| 11 | Tests e2e Playwright (web) y react-native-testing-library (móvil) |
| 12 | Catastro SRI — script para actualizar desde CSV oficial del SRI |
| 13 | Certificados .p12 en Railway — pasar a Railway Volume (filesystem efímero) |

---

## Estado de tenants activos al 2026-06-02

| Tenant | BD | Acceso | Plan | Estado |
|--------|-----|--------|------|--------|
| corpsimtelec (sin slug) | `railway` | aela.corpsimtelec.com | Pro | Operativo |
| mprq | `aela_mprq` | aela.corpsimtelec.com/mprq | Pro | Activo — pendiente .p12 SRI |

---

## Contexto técnico: resolución del path de Chromium en Railway

El `nixpacks.toml` instala `chromium` vía Nix y configura:
```toml
PUPPETEER_EXECUTABLE_PATH = "chromium"
```

La función `_resolverRutaChromium()` en `sriScraper.js` llama a `which chromium` para obtener la
ruta absoluta. En Railway/Nix, Chromium queda en `/nix/store/xxx.../bin/chromium` y hay symlink
en el PATH. Si `which chromium` falla, la función devuelve el string `"chromium"` tal cual.

Si el diagnóstico muestra Chrome ❌, ajustar en Railway env vars:
```
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```
o bien dejar que nixpacks lo resuelva automáticamente añadiendo al `nixpacks.toml`:
```toml
[phases.build]
cmds = ["echo CHROMIUM=$(which chromium) > /tmp/chromium_path"]
```

---

## Commits de esta sesión

| Hash | Descripción |
|------|-------------|
| `c9e76d8` | fix: scraper SRI con patrón async job para evitar timeout de Railway |

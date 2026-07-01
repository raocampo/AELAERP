# AELA ERP — Sesión 2026-06-30

## Resumen ejecutivo

Sesión de diagnóstico profundo del scraper SRI. Se descubrió y corrigió la causa raíz definitiva: el portal SRI hashea la contraseña con **MD5 + SHA-512** en JavaScript antes de enviarla. El scraper enviaba la clave en texto crudo. Además se encontró que el campo visible del form se llama `usuario` (no `username`).

Commits pusheados: `12ea395`, `41c25a4`, `a581579`

---

## 🔴 PENDIENTE CRÍTICO — Verificar el fix del hash en producción

El último commit (`a581579`) aplica el hash correcto. **Mañana al llegar a la oficina:**

1. Abrir AELA → Buzón SRI → "Descarga automática"
2. Ingresar RUC `1103568240001` + clave + rango de fechas
3. Click "Consultar portal SRI"
4. **Log esperado en Railway** (señal de éxito):
   ```
   [SRI-fetch] POST body: usuario=1103568240001 | password_hash=... (160 chars)
   [SRI-fetch] POST resultado: 302 | location: https://srienlinea.sri.gob.ec/tuportal...
   [SRI-fetch] 200 | ViewState:true | ...
   [SRI-fetch] Formulario JSF obtenido correctamente
   [SRI] Fetch-based OK: N comprobantes
   ```
5. **Si da 302 tras el POST** → autenticación exitosa → el scraper funcionó ✅
6. **Si da 200 otra vez** → Keycloak sigue rechazando → ver nueva mensaje de error

---

## Lo que se hizo hoy (cronológico)

### 1. Git pull — 3 commits del 2026-06-29 ya en prod

| Commit | Fix |
|--------|-----|
| `987a6c7` | Declaraciones.jsx usa `api` service (resuelve tenant error) + empresas PUT acepta `esMatriz` |
| `e492a30` | Admin Macro puede hacer switch a todas las empresas |
| `6a2cfe3` | Middleware elimina `modoOperacion`, usa siempre `decoded.empresaId` del JWT |

**Proformas y multiempresa confirmados funcionando en producción.**

---

### 2. Análisis Firecrawl — descartado

Firecrawl (mendableai/firecrawl) fue evaluado y descartado para el scraper SRI:

| Razón | Detalle |
|-------|---------|
| Self-hosted | Requiere Docker + Redis + PostgreSQL + servidor — demasiado para Railway |
| Cloud | Credenciales del contribuyente van a servidores de Firecrawl (riesgo de seguridad) |
| Auth | No maneja flujos Keycloak/OAuth complejos nativamente |
| JSF | No es JSF-aware, sin soporte para ViewState |
| IPs | Self-hosted en Railway = mismas IPs de AWS = mismo bloqueo potencial |

**Conclusión:** Lo que Firecrawl hace internamente (Playwright) lo implementamos directamente con Puppeteer + @sparticuz/chromium, con más control y sin riesgo de seguridad.

---

### 3. Bug fix — ROPC short-circuit (`12ea395`)

**Problema:** Cuando ROPC devolvía `invalid_grant`, el código lanzaba excepción inmediata y el browser flow **nunca se ejecutaba**. El endpoint `/token` de Keycloak puede tener restricciones de IP distintas al form web.

**Fix:** `invalid_grant` de ROPC ahora es un `console.warn`, siempre continúa al browser flow.

```javascript
// ANTES (bug):
if (ropcErr.esCredenciales) {
  throw new Error('Credenciales incorrectas'); // ← nunca llegaba al browser flow
}

// AHORA (fix):
if (ropcErr.esCredenciales) {
  console.warn('[SRI-ROPC] invalid_grant — continuando con browser flow...');
  // continúa → browser flow sí se ejecuta
}
```

---

### 4. @sparticuz/chromium + nixpacks.toml (`12ea395`)

**Problema:** Puppeteer no encuentra Chromium en Railway (filesystem efímero).

**Fix:** `_lanzarNavegador()` con 3 niveles de fallback:
1. `PUPPETEER_EXECUTABLE_PATH` / nixpacks (chromium del sistema)
2. `@sparticuz/chromium` (binario serverless, descarga automática)
3. Puppeteer bundled Chromium (solo dev local)

**Estado actual de @sparticuz en Railway:**
```
[SRI-Browser] Nivel 2 (@sparticuz/chromium) falló: Failed to launch the browser process:
/tmp/chromium: error while loading shared libraries
```
→ Faltan librerías del sistema en el contenedor Railway.

**`backend/nixpacks.toml`** creado — instala Chromium + dependencias via NixPkgs. Railway debe hacer un nuevo deploy desde cero para que aplique.

**Variables Railway pendientes de configurar:**
```
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=chromium
```

---

### 5. Diagnóstico validarUsuario() (`41c25a4`)

Con el browser flow ejecutándose, los logs revelaron:

```
[SRI-fetch] Inputs visibles del form: text[name="usuario" id="usuario"], ...
[SRI-fetch] Scripts externos: .../md5.js | .../sha512.js | .../script.js
```

Se descargó `script.js` del portal SRI y se encontró `validarUsuario()`:

```javascript
function validarUsuario() {
    // 1. Copia campo visible → campo hidden
    document.getElementById('username').value = usuarioPrincipal.toUpperCase();
    
    // 2. Hashea la contraseña: MD5 + SHA-512 concatenados
    var shaObj = new jsSHA(password, 'ASCII');
    document.getElementById('password').value =
        CryptoJS.MD5(password) + shaObj.getHash('SHA-512', 'HEX');
    
    return true;
}
```

---

### 6. Fix definitivo — hash MD5+SHA-512 (`a581579`)

**El bug real:** El scraper enviaba la contraseña en texto crudo. Keycloak espera `md5(pw) + sha512(pw)`.

**Correcciones al POST body:**

| Campo | Antes (incorrecto) | Ahora (correcto) |
|-------|-------------------|------------------|
| `usuario` | no se enviaba | `1103568240001` (campo visible) |
| `username` | `1103568240001` | `1103568240001` (sin cambio) |
| `password` | `clave_en_crudo` | `md5hex(32) + sha512hex(128)` = 160 chars |
| `ciAdicional` | no se enviaba | `""` (vacío) |
| `login` | no se enviaba | `""` (submit button) |

**Implementación en Node.js (usa `crypto` nativo — sin dependencias nuevas):**

```javascript
function _hashPasswordSRI(password) {
    const md5    = crypto.createHash('md5').update(password, 'utf8').digest('hex');
    const sha512 = crypto.createHash('sha512').update(password, 'ascii').digest('hex');
    return md5 + sha512;  // 32 + 128 = 160 chars
}
```

---

## 🟡 Pendientes para mañana

### Prioridad 1 — Verificar que el scraper ya funciona
Probar el buzón SRI con el último deploy. Ver sección "PENDIENTE CRÍTICO" arriba.

### Prioridad 2 — Puppeteer en Railway (si el fetch sigue fallando)

El @sparticuz/chromium falla por librerías del sistema faltantes. Opciones:

**Opción A — nixpacks.toml (ya creado, pero Railway necesita rebuild limpio):**
En Railway dashboard → Settings → "Trigger redeploy" (no desde push, sino forzar rebuild).
Después agregar vars: `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` + `PUPPETEER_EXECUTABLE_PATH=chromium`

**Opción B — Dockerfile explícito en `backend/`:**
```dockerfile
FROM node:18-slim
RUN apt-get update && apt-get install -y \
    chromium libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
```

### Prioridad 3 — Otros pendientes anteriores

| Módulo | Tarea |
|--------|-------|
| AyudaSistema.jsx | Sección multiempresa/Admin Macro desactualizada |
| App móvil | Logos reales AELA, Expo start, ESC/POS, APK |

---

## Archivos modificados hoy

| Archivo | Cambio |
|---------|--------|
| `backend/utils/sriScraper.js` | Bug ROPC, hash MD5+SHA512, campos POST, @sparticuz/chromium 3 niveles, diagnóstico JS |
| `backend/package.json` | Agrega `@sparticuz/chromium`, `puppeteer-core` |
| `backend/package-lock.json` | Actualizado |
| `backend/nixpacks.toml` | Nuevo — Chromium del sistema para Railway |

---

## Commits de hoy

| Commit | Descripción |
|--------|-------------|
| `12ea395` | fix: ROPC invalid_grant ya no bloquea browser flow + @sparticuz/chromium para Railway |
| `41c25a4` | diag: Puppeteer como fallback real + diagnóstico validarUsuario() SRI |
| `a581579` | fix: replicar validarUsuario() del SRI — hash MD5+SHA-512 y campo usuario |

---

## Contexto técnico rápido

```
Repo:     github.com/raocampo/AELAERP  rama: main
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
DB:       PostgreSQL en Railway
```

**Cómo depurar si el scraper falla mañana:**
1. Railway dashboard → AELA backend → Logs
2. Buscar `[SRI-fetch]` para ver el flujo
3. `POST resultado: 302` = éxito de auth
4. `POST resultado: 200` = Keycloak rechazó → leer el mensaje de error que sigue

**Archivo del scraper:** `backend/utils/sriScraper.js`
- Función principal: `obtenerRecibidosScraper()`
- Login fetch: `_loginYObtenerJSF()`
- Hash de clave: `_hashPasswordSRI()`
- Lanzar navegador: `_lanzarNavegador()`

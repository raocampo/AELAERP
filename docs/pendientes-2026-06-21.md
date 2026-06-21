# AELA ERP — Pendientes 2026-06-21

## Sesión de hoy — resumen ejecutivo

Diagnóstico profundo del scraper SRI: se descubrió que los commits de la sesión anterior nunca llegaron a Railway/Vercel (faltaba `git push`). Una vez en producción, el ROPC de Keycloak confirmó `invalid_grant`, lo que significa que las credenciales son rechazadas por Keycloak — no es problema de IP ni de código. Se implementó modo "Conectar desde portal SRI" (script de consola) pero fue descartado por UX. Se dejaron diagnósticos detallados para la próxima sesión.

Commits pusheados: `5ebae1e`, `8a52403`, `d614142`, `6b11f93`, `b3f8380`, `c1810d2`.

---

## 🔴 CRÍTICO — Scraper SRI bloqueado por credenciales Keycloak

### Diagnóstico confirmado

ROPC (Resource Owner Password Credentials) con `client_id=app-tuportal-internet` devuelve:
```
[SRI-ROPC] client:app-tuportal-internet → 401 | error:invalid_grant
```

**`invalid_grant` = Keycloak rechaza el par RUC+contraseña directamente.**

Esto NO es un problema de IP de Railway ni de código del scraper. Es un problema de credenciales a nivel del portal Keycloak.

### Posibles causas (en orden de probabilidad)

| # | Causa | Síntoma en log |
|---|-------|----------------|
| 1 | **Cuenta bloqueada** por los múltiples intentos fallidos del scraper en días previos | `desc:"Account is temporarily disabled due to too many failed attempts."` |
| 2 | **Usuario usa Microsoft SSO** para entrar al portal SRI y el credential de contraseña de Keycloak está inactivo/sin configurar | `desc:"Invalid user credentials"` |
| 3 | **Contraseña incorrecta**: la clave en AELA ≠ la clave del portal Keycloak | `desc:"Invalid user credentials"` |

### Acción requerida ANTES de continuar — verificar credenciales

**El usuario (Robert) debe hacer esto:**

1. Abrir Chrome en **modo incógnito** (sin cookies, sesión limpia)
2. Ir a **srienlinea.sri.gob.ec**
3. Intentar entrar con **RUC `1103568240001` + la misma clave que se usa en AELA**
4. **SIN usar el botón "Microsoft"** — entrada directa con usuario+clave

**Interpretación del resultado:**

| Resultado | Causa | Solución |
|-----------|-------|----------|
| NO puede entrar con usuario+clave | Usa Microsoft SSO, la contraseña Keycloak está inactiva | Ir a "Generar o recuperar clave" en srienlinea.sri.gob.ec o explorar Microsoft OAuth flow |
| SÍ puede entrar con usuario+clave | Cuenta estaba bloqueada por intentos fallidos — ya se desbloqueó al entrar | Volver a probar en AELA inmediatamente |
| Portal dice "cuenta bloqueada" o similar | Lockout activo | Esperar 30 min O usar "Generar o recuperar clave" para resetear |

### Log esperado en Railway (commit `c1810d2` ya en prod)

El próximo intento mostrará la causa exacta:
```
[SRI-ROPC] client:app-tuportal-internet → 401 | error:invalid_grant | desc:"Account is temporarily disabled..."
→ cuenta bloqueada, usuario debe esperar/recuperar clave

[SRI-ROPC] client:app-tuportal-internet → 401 | error:invalid_grant | desc:"Invalid user credentials"
→ contraseña incorrecta o Microsoft SSO sin clave activa
```

---

## ✅ Completado esta sesión

### 1. Fix crítico — push a GitHub faltante
**Problema:** Los commits `5ebae1e`, `8a52403`, `d614142` existían solo en local. Railway/Vercel nunca los vio. El usuario probó el código ANTIGUO durante horas sin saberlo.

**Fix:** `git push origin main`. Siempre hacer push inmediatamente después de commit.

**Lección:** `git commit` = local. `git push` = GitHub → Railway/Vercel auto-deploy.

---

### 2. Fix _parsearSetCookie — Node 18 multi Set-Cookie (commit `8a52403`)
En Node 18, `headers.get('set-cookie')` concatena todas las cookies con `, `. El parser antiguo solo capturaba la primera, perdiendo `AUTH_SESSION_ID`, `KC_RESTART`, etc.

**Fix:** Parser con 3 niveles de fallback:
```
Nivel 1: headers.getSetCookie()    → Node 20+ (array separado)
Nivel 2: headers.forEach()         → Node 18 undici (itera separado)
Nivel 3: split en ", NombreCookie=" → último recurso
```

---

### 3. Fix campos hidden Keycloak en POST (commit `5ebae1e`)
El POST de credenciales solo enviaba `{username, password, credentialId: ''}`. El form de Keycloak puede tener campos `<input type="hidden">` adicionales con estado de sesión.

**Fix:** Extrae todos los `<input type="hidden">` del form HTML y los incluye en el POST.

---

### 4. Diagnóstico detallado POST Keycloak (commit `6b11f93`)
Agrega logs que antes no existían:
- Valores de campos hidden (no solo nombres): `username="1103568240001"`
- Snippet del HTML del form (primeros 500 chars)
- Cuerpo del POST completo (password maskeado)
- URL completa del form action (sin truncar a 80 chars)
- Headers Sec-Fetch-* para imitar navegador real

---

### 5. ROPC como validador de credenciales (commit `b3f8380`)
Antes del browser flow, intenta `POST /auth/realms/Internet/protocol/openid-connect/token`:
- Si da `200 + access_token` → credenciales correctas, intenta JSF con `Authorization: Bearer`
- Si da `invalid_grant` → credenciales incorrectas → error inmediato sin más intentos
- Si da `unauthorized_client` → ROPC no disponible → cae al browser flow

---

### 6. Log error_description detallado (commit `c1810d2`)
Muestra el mensaje exacto de Keycloak para distinguir:
- `"Account is temporarily disabled"` → cuenta bloqueada
- `"Invalid user credentials"` → clave incorrecta
- `"Account is disabled"` → cuenta deshabilitada

---

### 7. Modo "Conectar desde portal SRI" — implementado, descartado para UX (commit `d614142`)
**Qué hace:** Toggle en Buzón SRI que muestra instrucciones para:
1. Abrir portal SRI en nueva pestaña
2. Buscar comprobantes
3. Pegar script en consola F12 → `sendBeacon` envía claves a AELA

**Por qué se descartó:** Los usuarios finales no son contadores/técnicos. No pueden usar la consola del navegador. El modo automático debe funcionar sin intervención del usuario.

**El código sigue disponible** en la UI como opción avanzada para usuarios técnicos.

**Backend implementado:**
- `POST /api/buzon/sri/sync/:tokenId/recibir` (público, recibe claves via sendBeacon)
- `GET /api/buzon/sri/sync/:tokenId/estado` (polling)
- `POST /api/buzon/sri/sync/iniciar` (autenticado, genera token)

---

## 🟡 Pendientes anteriores (continúan)

### Proformas — verificar en prod

| Check | Cómo |
|-------|------|
| Botón Imprimir | Ventas → Proformas → 🖨️ Imprimir → abre PDF A4 en nueva pestaña |
| RUC sobre razón social en PDF | Panel izquierdo: R.U.C. morado arriba, razón social negro abajo |
| Consumidor Final | PDF con CF → identificación muestra 9999999999999 |
| Firma y sello | Configuración SRI → subir imágenes → aparecen al pie del PDF proforma |
| ErrorBoundary | Tras próximo deploy Vercel → no aparece "Algo salió mal" |

### Otros pendientes

| Módulo | Tarea |
|--------|-------|
| AyudaSistema.jsx | Sección multiempresa / Admin Macro desactualizada |
| App móvil | Logos reales AELA, Expo start, ESC/POS, APK |

---

## Archivos modificados hoy

| Archivo | Cambio |
|---------|--------|
| `backend/utils/sriScraper.js` | ROPC + _jsfConBearer + _parsearSetCookie 3 niveles + fix campos hidden + diagnóstico detallado |
| `backend/routes/buzon.js` | Portal sync: SYNC_SESSIONS + rutas públicas recibir/estado + ruta autenticada iniciar |
| `frontend/src/components/Buzon/BuzonSRI.jsx` | Toggle modo + UI "Conectar desde portal SRI" + estado sync |
| `frontend/src/components/Buzon/BuzonSRI.css` | Estilos toggle + sync pasos + script display |

---

## Commits deployados hoy

| Commit | Descripción |
|--------|-------------|
| `5ebae1e` | fix: sriScraper incluye campos hidden Keycloak en POST de credenciales |
| `8a52403` | fix: _parsearSetCookie captura todas las cookies (Node 18 multi Set-Cookie) |
| `d614142` | feat: modo "Conectar desde portal SRI" (sendBeacon, script consola) |
| `6b11f93` | diag: logging detallado POST Keycloak + Sec-Fetch headers |
| `b3f8380` | feat: ROPC validador de credenciales + Bearer token JSF |
| `c1810d2` | diag: ROPC log error_description completo de Keycloak |

---

## Contexto técnico rápido

```
Repo:     github.com/raocampo/AELAERP  rama: main
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
DB:       PostgreSQL en Railway
```

**IMPORTANTE:** Siempre hacer `git push origin main` después de cada commit. Sin push, Railway/Vercel no ve los cambios.

**Estado del scraper SRI:**
- ROPC: implementado y confirma el error como "invalid_grant" (credenciales)
- Browser flow: funciona en código pero también falla por "invalid_grant" de Keycloak
- Modo "Conectar desde portal SRI": implementado, descartado para usuarios finales
- Próximo paso: verificar credenciales en incógnito (ver sección CRÍTICO arriba)

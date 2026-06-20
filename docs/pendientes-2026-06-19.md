# AELA ERP — Pendientes 2026-06-19

## Sesión de hoy — resumen ejecutivo

Se implementó PDF profesional para proformas (PDFKit, layout idéntico al RIDE), envío por email con adjunto, modal WhatsApp con mensaje formateado, y se reemplazó el tab "Descarga automática" del Buzón SRI con pantalla "Próximamente". Además se analizó la arquitectura interna del portal SRI en línea descubriendo sus endpoints XHR.

Commits pusheados: `2c8082e` (PDF PDFKit), `6f4621a` (Buzón próximamente), `be26dce` (modal WhatsApp) → Railway + Vercel redeploy automático.

---

## ✅ Completado esta sesión

### 1. PDF Proformas con PDFKit (commit `2c8082e`)
**Problema anterior:** Puppeteer en Railway generaba PDF corrupto (Adobe Acrobat: "no es un tipo de archivo admitido o está dañado"). Root cause: Chrome en Railway no accede a URLs externas y el buffer Uint8Array se corrompía al enviarlo con `res.send()`.

**Fix:** se reemplazó Puppeteer por PDFKit (misma librería que genera el RIDE de facturas).

**Qué genera:**
- Panel izquierdo (44%): logo de la empresa desde `configuracion_sri.logoUrl`, razón social, nombre comercial, dirección, teléfono, email, badge RIMPE si aplica
- Panel derecho (56%): RUC label, título "PROFORMA" en morado `#6d28d9`, número centrado, recuadro con 4 campos: fecha emisión, válida desde, válida hasta (bold morado), estado
- Caja cliente: razón social, identificación + teléfono, dirección si existe
- Tabla 7 columnas: Cód. | Cantidad | Descripción | P. Unitario | Descuento | % IVA | Total
- Filas alternadas blanco/`#f5f3ff`; corte de página automático
- Footer izquierdo: tabla INFORMACIÓN ADICIONAL (vigencia desde/hasta, forma de pago, correo, observaciones)
- Footer derecho: totales (subtotal 0%/5%/15% solo los no-cero, descuento si > 0, IVA, VALOR TOTAL en fondo `#ede9fe`)
- Disclaimer legal en pie de página

**Archivos modificados:**
- `backend/routes/proformas.js` — función `_generarPdfProforma()` + `_resolverLogo()` + endpoint `GET /:id/pdf`

### 2. Email con PDF adjunto (commit `2c8082e`)
`POST /proformas/:id/enviar-email` ahora genera el PDF antes de enviar y lo incluye como attachment.
Si la generación del PDF falla, el email igual se envía (sin adjunto, con warning en consola).

**Archivo modificado:** `backend/routes/proformas.js`

### 3. Modal WhatsApp con mensaje formateado (commit `be26dce`)
**Antes:** botón WhatsApp abría `wa.me` con texto plano simple.
**Ahora:** abre un modal con:
- Mensaje completo pre-construido con emojis y formato: cabecera, datos cliente, detalle de productos (cant × precio | IVA% = *total*), subtotales, IVA, TOTAL, forma de pago, observaciones, disclaimer
- Textarea editable antes de enviar
- 4 botones: **Cancelar** | **📋 Copiar** (clipboard) | **⬇️ Descargar PDF** | **💬 Abrir WhatsApp** (verde)
- Nota informativa: wa.me no soporta adjuntos de archivo; el usuario descarga el PDF y lo adjunta manualmente

**Archivo modificado:** `frontend/src/components/Proformas/DetalleProforma.jsx`

### 4. Print CSS mejorado (commit `2c8082e`)
`@media print` en `DetalleProforma.css` ahora:
- `@page { size: A4; margin: 12mm 14mm; }`
- Colores morado imprimibles (`-webkit-print-color-adjust: exact`)
- Oculta header, modales, botones
- Tabla con header morado + filas alternadas

### 5. Buzón SRI — tab "Descarga automática" → Próximamente (commit `6f4621a`)
**Motivo:** Chrome/Puppeteer en Railway NO puede acceder a URLs externas (limitación del contenedor). Scraper imposible con la arquitectura actual.

**Implementado:**
- Badge "🚀 Próximamente" con gradiente morado
- Descripción de qué incluirá la función
- Formulario desactivado (overlay `opacity: 0.38, pointerEvents: none`)
- Sección verde con shortcuts clickeables hacia tabs TXT y ZIP (que sí funcionan)

**Archivo modificado:** `frontend/src/components/Buzon/BuzonSRI.jsx`

---

## 🔴 Pendiente crítico — Buzón SRI scraper (fetch puro)

**Por qué es pendiente:** Railway permite Node.js `fetch` a URLs externas pero NO Chrome. El scraper debe reescribirse sin Puppeteer usando fetch puro.

**Arquitectura del portal SRI descubierta hoy:**
El portal migró de JSF a Angular + Keycloak OIDC. Se descubrieron los endpoints internos vía DevTools Network:

| Endpoint | Para qué sirve |
|----------|---------------|
| `vigentes` | **Listado de comprobantes** ← el que necesitamos |
| `porTipo?tipo=NAT` | Documentos por tipo de contribuyente |
| `token` | Token de sesión actual |
| `perfil` | Datos del contribuyente |
| `principal` | Datos principales |
| `vencimiento`, `vigencia` | Obligaciones tributarias |

**URL portal:** `https://srienlinea.sri.gob.ec/sri-en-linea/`
**Auth:** Keycloak OIDC — `client_id: app-tuportal-internet` (NO `app-sri-claves-angular`)
**Token expira:** 300 segundos

### Qué capturar desde DevTools para implementar el scraper

**Opción A — Más rápida** (ya estás logueado en el portal, hazlo desde casa):
1. Ir a `https://srienlinea.sri.gob.ec` → DevTools → Network → Fetch/XHR
2. Recargar la página (F5)
3. Clic en el request `vigentes` → copiar:
   - **Request URL completa** (ej: `https://srienlinea.sri.gob.ec/api/.../vigentes`)
   - **Request Headers** → buscar `Authorization: Bearer eyJ...` o `Cookie: ...`
   - **Response** → estructura JSON (qué campos devuelve)
4. Clic en el request `token` → copiar Response (estructura del token)

**Opción B — Capturar login POST:**
1. Cerrar sesión del portal SRI completamente
2. Abrir DevTools → Network → activar **"Preserve log"** ✅
3. Navegar a `https://srienlinea.sri.gob.ec`
4. Ingresar RUC + contraseña → clic **Ingresar**
5. Buscar POST a `login-actions/authenticate` con `client_id=app-tuportal-internet`
6. Copiar: URL completa (con session_code, execution, tab_id) + Request Body (campos username, password, etc.)

### Implementación planeada (una vez tengas los datos)
```
Archivos a modificar:
  backend/utils/sriScraper.js   ← reescribir con fetch (eliminar Puppeteer)
  backend/routes/buzon.js       ← nuevo endpoint /sri/descargar-auto

Flujo:
  1. GET login page → extraer session_code, execution, tab_id del HTML
  2. POST credentials (form-urlencoded)
  3. Seguir redirect → extraer authorization code
  4. POST /token con grant_type=authorization_code → access_token
  5. GET vigentes con Authorization: Bearer {token}
  6. Parsear JSON → importar comprobantes
```

---

## 🟡 Verificar en producción

| Check | Cómo |
|-------|------|
| PDF descargable | Ventas → Proformas → abrir una → botón ⬇️ PDF |
| PDF se abre en Acrobat sin error | Verificar que no aparezca "archivo dañado" |
| Email con adjunto | Botón 📧 Email → revisar correo recibido → debe incluir .pdf adjunto |
| Modal WhatsApp | Botón 💬 WhatsApp → debe abrir modal con mensaje formateado |

---

## 🟢 Backlog (sin fecha)

| # | Módulo | Tarea | Notas |
|---|--------|-------|-------|
| 1 | Buzón SRI | Scraper fetch puro — capturar datos DevTools (ver sección arriba) | Próximo paso inmediato |
| 2 | App Móvil | Reemplazar assets placeholder | icon 1024×1024, adaptive-icon 1024×1024, splash 512×512 |
| 3 | App Móvil | Cuenta EAS en expo.dev + campo `owner` en `eas.json` | Necesario para APK |
| 4 | App Móvil | `eas build --platform android --profile apk` | Genera APK instalable |
| 5 | App Móvil | ESC/POS desde celular Bluetooth | Requiere dev build (salir de Expo Go) |
| 6 | SaaS | Panel Super Admin (tenants, planes, stats) | — |
| 7 | Pagos | Pasarela PayPhone / Stripe | — |
| 8 | Nómina | LORTI — tabla impuesto a la renta | — |
| 9 | Ayuda | AyudaSistema.jsx — sección multiempresa / Admin Macro | — |
| 10 | Tests | e2e Playwright (flujo factura, proforma, login) | — |

---

## Archivos modificados hoy

| Archivo | Cambio |
|---------|--------|
| `backend/routes/proformas.js` | `_resolverLogo()` + `_generarPdfProforma()` PDFKit + `GET /:id/pdf` + email con adjunto |
| `frontend/src/components/Proformas/DetalleProforma.jsx` | Modal WhatsApp + botón PDF + `descargarPdf()` + `abrirModalWhatsApp()` |
| `frontend/src/components/Proformas/DetalleProforma.css` | `@media print` A4 mejorado + `.modal-overlay` + `.modal-content` |
| `frontend/src/components/Buzon/BuzonSRI.jsx` | Tab "Descarga automática" → pantalla Próximamente |
| `frontend/src/components/Buzon/BuzonSRI.css` | `.buzon-proximamente-card` |

---

## Commits desplegados hoy

| Commit | Descripción |
|--------|-------------|
| `be26dce` | Modal WhatsApp con mensaje formateado editable (4 acciones) |
| `2c8082e` | PDF proformas con PDFKit (fix corrupto) + email con adjunto + print CSS |
| `6f4621a` | Buzón SRI: tab Descarga → pantalla Próximamente |

---

## Contexto técnico rápido (para retomar desde casa)

```
Repo:     github.com/raocampo/AELAERP  rama: main
Backend:  Railway → aelaerp-production.up.railway.app  (push a main = redeploy auto)
Frontend: Vercel  → aela.corpsimtelec.com              (push a main = redeploy auto)
DB:       PostgreSQL en Railway
  BD principal: railway     (Corp Simtelec — sin tenant slug)
  BD tenant:    aela_mprq   (Miryan Patricia Ramon Quezada)
```

**Stack:**
- Backend: Node.js / Express / Prisma (schema) + `$queryRawUnsafe` para tablas custom
- Frontend: React 18 + Vite + React Router v6 + React Hot Toast
- PDF: PDFKit (npm `pdfkit`) — en `backend/routes/proformas.js` y `backend/utils/sri.js`
- Multi-tenant: AsyncLocalStorage Proxy en `config/prisma.js` + `X-Tenant-Slug` header

**Patrón para agregar columnas a tablas fuera de Prisma:**
→ Agregar `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` en `backend/scripts/applySchemaFixes.js` array `FIXES`
→ Se aplica automáticamente en el próximo deploy (`start.sh` llama `node scripts/applySchemaFixes.js`)

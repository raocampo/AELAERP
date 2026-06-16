# AELA ERP — Pendientes 2026-06-16

## Sesión: EmpresaSwitcher Admin Macro + UX ConfiguracionSRI

---

## ✅ Verificado en producción (esta sesión)

| Item | Estado |
|------|--------|
| Flujo multiempresa Andrea Maza | ✅ Funciona |
| Flujo multiempresa Lucia (CONSORCIO VIAL) | ✅ Funciona |
| Tenant mprq — certificado .p12 | ✅ Subido y operativo |
| Tenant loja-torneos-y-competencia | ✅ Eliminado (BD + master) |

---

## ✅ Resuelto esta sesión (1 commit — `9d85c05`)

### Fix 1 — EmpresaSwitcher no mostraba las 3 empresas a Admin Macro

**Problema:** Robert Ocampo (Admin Macro) veía correctamente las 3 empresas en
`/empresas` (GestionEmpresas), pero el EmpresaSwitcher (selector al cambiar empresa)
solo mostraba 2.

**Causa raíz:** `GET /mis-empresas` (usado por `cargarEmpresasDisponibles` en AuthContext)
no tenía la lógica de Admin Macro. Solo devolvía `empresa default + usuario_empresas`
(filas explícitas). Como Robert no tenía todas las empresas en `usuario_empresas`, veía menos.

**Fix (`backend/routes/empresas.js`):**
- Consulta `usuarios.rol` del usuario actual
- Si `rol base = 'admin'` → devuelve **todas las empresas activas** con `rol: 'admin'`
- Mismo patrón que ya existía en `GET /empresas`

```js
const esAdminMacro = normalizarRol(usuarioBase?.rol) === 'admin';
if (esAdminMacro) {
  const empresas = await req.prisma.empresas.findMany({ where: { activo: true }, ... });
  return res.json({ data: empresas.map(e => ({ ...e, rol: 'admin' })) });
}
```

---

### Fix 2 — Botón "Guardar Configuración" pegado al formulario de Firma Electrónica

**Problema:** El botón "Guardar Configuración" aparecía visualmente pegado encima
de la sección "Firma Electrónica" porque:
- Estaba en `sri-form-actions` al fondo del form, alineado a la derecha
- `.sri-cert-section` tenía `margin-top: 0` → sin separación visual

**Fix (`ConfiguracionSRI.jsx` + `ConfiguracionSRI.css`):**
- Botón movido al **header** (top-right), junto a ← Volver y 🔗 Probar conexión
- Eliminado el bloque `sri-form-actions` del fondo del form
- `handleGuardar` acepta `e` opcional (`if (e?.preventDefault) e.preventDefault()`)
  para poder llamarse tanto desde el form como desde el header
- `.sri-cert-section { margin-top: 32px; }` — separación visual clara

**Resultado:** "Guardar Configuración" siempre visible en el header sin scrollear,
Firma Electrónica claramente separada debajo.

---

## 🔴 Pendientes inmediatos

### 1. Verificar en producción (post-deploy `9d85c05`)

- [ ] EmpresaSwitcher como Robert Ocampo → debe mostrar **3 empresas**
- [ ] Cambiar a cada empresa → rol correcto en sidebar
- [ ] ConfiguracionSRI → botón "Guardar Configuración" en header (top-right)
- [ ] Sección Firma Electrónica con separación visual (no pegada al formulario)

### 2. Buzón SRI — Scraper Puppeteer sin verificar en producción

- Ir a `/buzon` → pestaña **Descarga automática** → **Diagnóstico SRI**
- Chrome debe aparecer como ✅ en el diagnóstico de Railway
- Si falla: revisar `PUPPETEER_EXECUTABLE_PATH` en Railway env vars
- Flujo completo: RUC + clave SRI → Consultar → polling → resultados
- Si los selectores JSF fallan: inspeccionar IDs reales del `<select>` año/mes en el portal

---

## 🟡 Pendientes medios

### 3. App Móvil — lanzamiento

- Assets reales en `mobile/assets/`:
  - `icon.png` (1024×1024) — logo AELA
  - `adaptive-icon.png` (1024×1024) — Android adaptativo
  - `splash-icon.png` (512×512) — pantalla de carga
- Cuenta EAS en expo.dev + campo `owner` en `eas.json`
- Generar APK: `eas build --platform android --profile apk`
- Prueba completa en dispositivo físico Android/iOS
- ESC/POS directo desde celular requiere **Expo dev build** (salir de Expo Go)
  con `react-native-tcp-socket`

### 4. AyudaSistema.jsx — sección multiempresa

- Agregar sección: **Multiempresa y Admin Macro** (flujo, roles, cómo cambiar empresa)
- Archivo: `frontend/src/components/Ayuda/AyudaSistema.jsx`

---

## 🟢 Backlog

| # | Tarea | Notas |
|---|-------|-------|
| 1 | Panel Super Admin SaaS | Tenants, estado, plan, stats de uso |
| 2 | Pasarela de pagos | PayPhone o Stripe |
| 3 | Impuesto a la Renta en nómina | Tabla LORTI |
| 4 | App móvil: ESC/POS Bluetooth | `react-native-tcp-socket` en dev build |
| 5 | App móvil: escáner código de barras | `expo-camera` + `expo-barcode-scanner` |
| 6 | App móvil: dashboard/métricas del día | Ventas, facturas emitidas, caja |
| 7 | App móvil: notificaciones push | Estado SRI en tiempo real |
| 8 | Tests e2e | Playwright (web) + `@testing-library/react-native` (móvil) |
| 9 | Catastro SRI | Actualización desde CSV oficial |
| 10 | GestionEmpresas | Selector "Asignar usuario" muestra usuarios de empresas hermanas |

---

## Archivos modificados esta sesión

| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `backend/routes/empresas.js` | Fix | `/mis-empresas` devuelve todas las empresas si Admin Macro |
| `frontend/src/components/Facturacion/ConfiguracionSRI.jsx` | UX | Guardar al header, handleGuardar acepta e opcional |
| `frontend/src/components/Facturacion/ConfiguracionSRI.css` | UX | `sri-cert-section` margin-top 0→32px, elimina `sri-form-actions` |

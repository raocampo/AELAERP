# Pendientes AELA ERP — Sesión 2026-04-30

## ✅ Completado hoy

### POS — Correcciones
- **Caja Diaria**: sobrante/faltante ahora muestra etiqueta correcta (Sobrante/Faltante/Cuadrado) con valor absoluto en positivo y color verde/rojo/azul, tanto en KPIs como en pestaña Cierre.
- **POS — Toast verde**: eliminado el `toast.success` redundante al emitir documento (el modal ✅ ya confirma la operación).
- **POS — Cliente manual en BD**: al emitir, si el cliente fue ingresado manualmente (SRI sin datos completos), se crea en BD automáticamente vía `POST /clientes`.
- **POS — Mensaje verde**: el mensaje "✓ Encontrado en BD: NOMBRE" ya no se muestra. Si al cliente le faltan datos aparece `⚠ Datos incompletos — completa y se actualizarán al guardar`.
- **POS — Campo Teléfono**: agregado entre Dirección y Email en el formulario del cliente.
- **POS — Actualizar cliente existente**: si el cliente ya existe en BD pero le faltaban dirección/email/teléfono, al emitir el documento se actualiza el registro con los datos nuevos (solo campos que estaban vacíos).
- **POS — Forma de pago monto incorrecto**: corregido. Antes enviaba el subtotal ($110). Ahora calcula y envía `totalConIva` ($126.50). El footer del POS también refleja el total con IVA para facturas.
- **POS — Total en modal**: el modal de confirmación ahora muestra el `importeTotal` devuelto por el backend (no el calculado en frontend).

### Rebrand SCFI → AELA
- 24 archivos frontend actualizados (localStorage keys, eventos ServiceWorker, IndexedDB, comentarios, mensajes UI).
- 29 archivos backend actualizados (variables de entorno, mensajes de API, package.json, middleware, rutas, utils).
- 10 archivos de documentación actualizados (todos los `.md` en `/docs`).
- Variables de entorno renombradas: `SCFI_EDITION` → `AELA_EDITION`, `SCFI_DOMINIO_BASE` → `AELA_DOMINIO_BASE`, `SCFI_TENANT_SLUG` → `AELA_TENANT_SLUG`.
- LocalStorage keys: `scfi_token/usuario/empresa/sistema` → `aela_token/usuario/empresa/sistema`.
- IndexedDB: `scfi_offline` → `aela_offline`.
- Eventos SW: `scfi:sync-complete` → `aela:sync-complete`, `scfi:sw-update` → `aela:sw-update`.
- Emails: `ventas@scfi.ec` / `info@scfi.ec` → `ventas@aela.ec` / `info@aela.ec`.
- Nombres de paquetes: `scfi-backend` → `aela-backend`, `scfi-frontend` → `aela-frontend`.
- Archivo de plantilla productos: `scfi-plantilla-productos.xlsx` → `aela-plantilla-productos.xlsx`.

---

## ⏳ Pendientes — Continuar mañana

### 1. Renombrar bases de datos PostgreSQL (CRÍTICO para producción)
Las bases de datos físicas siguen llamándose `scfi_dev` y `scfi_master`. El `.env` apunta a ellas con los nombres originales para no romper el sistema en desarrollo. Cuando se haga el despliegue a producción o se tenga una ventana de mantenimiento:

```sql
-- En psql como superusuario:
ALTER DATABASE scfi_dev RENAME TO aela_dev;
ALTER DATABASE scfi_master RENAME TO aela_master;
```

Luego actualizar `.env`:
```
DATABASE_URL=postgresql://postgres:CONTRASEÑA@localhost:5432/aela_dev
DATABASE_MASTER_URL=postgresql://postgres:postgres@localhost:5432/aela_master
```

### 2. Landing page — Actualizar branding
Archivo: `landing/ant/index.html` y `landing/ant/style.css`
- Cambiar `SCFI` → `AELA` en título, meta tags, navegación, pie de página, copyright.
- Actualizar email de contacto `info@scfi.ec` → `info@aela.ec`.
- Cambiar "Sistema de Comprobantes Fiscales Inteligentes" por descripción de AELA.

### 3. Service Worker (`/sw.js` o `public/sw.js`)
Si existe un Service Worker en el frontend, revisar que maneje el evento `aela:sync-complete` (antes `scfi:sync-complete`) y que el Background Sync esté registrado como `aela-sync-queue`.
Buscar el archivo `sw.js` en `frontend/public/`.

### 4. POS — Cliente con datos incompletos: modal de edición
El usuario pidió que si el cliente no tiene datos completos, "se abra un modal para crearlo". Actualmente se muestra un mensaje ⚠ y los datos se actualizan al guardar, pero NO hay un modal explícito. Pendiente implementar un modal/drawer de edición del cliente que se abra automáticamente al detectar datos incompletos.

### 5. POS — Teléfono no se pasa a la nota de venta
La nota de venta no tiene campo `telefono` en el schema de Prisma. Solo se pasa en la creación del cliente. Si se necesita en el cuerpo del documento (impresión del recibo), agregar el campo en `notas_venta`.

### 6. Actualizar variables en Railway / servidor de producción
En Railway (o donde esté el backend desplegado):
- Renombrar `SCFI_EDITION` → `AELA_EDITION` en el panel de variables.
- Renombrar `SCFI_DOMINIO_BASE` → `AELA_DOMINIO_BASE`.
- Renombrar `SCFI_TENANT_SLUG` → `AELA_TENANT_SLUG`.

### 7. Verificar `railway.toml`
El archivo tiene referencias a variables de entorno. Verificar que los nombres coincidan con los nuevos `AELA_*`.

### 8. Manual de usuario del sistema
Elaborar la documentación de usuario final de AELA ERP. Debe cubrir:
- Inicio de sesión y configuración inicial de la empresa
- Módulo POS: cómo realizar una venta, buscar clientes, emitir factura o nota de venta, imprimir recibo
- Módulo Caja Diaria: apertura, movimientos manuales, cierre, lectura de sobrante/faltante
- Módulo Facturación: emisión de facturas, notas de crédito, retenciones, consulta de estado SRI
- Módulo Inventario / Productos: carga masiva, ajustes de stock
- Módulo Clientes: búsqueda por cédula/RUC, datos SRI, historial de compras
- Módulo Contabilidad: plan de cuentas, asientos automáticos por venta
- Módulo Bancos: conciliación, movimientos
- Declaraciones / ATS / Reportes tributarios
- Formatos sugeridos: PDF descargable desde el sistema, sección `/ayuda` en la app

### 9. Módulo de Contabilidad — Plan de cuentas
El plan base del ERP decía "plan base SCFI" — ya está actualizado a "plan base AELA" en el frontend. Revisar si en backend el plan de cuentas tiene alguna descripción o identificador que diga "SCFI" en la base de datos (campo `nombre` o `descripcion` en la tabla `plan_cuentas`).

### 9. Sesiones activas de usuarios
El cambio de `scfi_token` → `aela_token` cierra automáticamente la sesión de todos los usuarios con sesión activa (localStorage key diferente = no encuentra el token). Comunicar a los usuarios que deben volver a iniciar sesión.

### 10. Favicon / íconos / PWA manifest
Si existe un `manifest.json` o `site.webmanifest` en `frontend/public/`, actualizar:
- `"name"` y `"short_name"` que digan SCFI → AELA.
- `"description"` → descripción de AELA.

---

## 📋 Registro de archivos modificados hoy

### Frontend (24 archivos JS/JSX/CSS)
| Archivo | Cambio |
|---------|--------|
| `context/AuthContext.jsx` | localStorage keys `scfi_*` → `aela_*` |
| `services/api.js` | SESSION_STORAGE_KEYS, token read |
| `services/api.test.js` | Keys en tests |
| `utils/syncQueue.js` | Token, eventos SW, sync name |
| `utils/offlineDB.js` | DB name `scfi_offline` → `aela_offline` |
| `components/Layout/Layout.jsx` | Token, evento `aela:sw-update` |
| `components/POS/PuntoVenta.jsx` | Token, nuevo estado teléfono, lógica cliente, total con IVA |
| `components/NotasVenta/DetalleNotaVenta.jsx` | Token |
| `components/GuiasRemision/ListaGuiasRemision.jsx` | Token |
| `components/GuiasRemision/FormGuiaRemision.jsx` | Token |
| `components/Facturacion/DetalleFactura.jsx` | Token |
| `components/Facturacion/FormRetencion.jsx` | Token |
| `components/Facturacion/ListaNotasDebito.jsx` | Token |
| `components/Facturacion/FormNotaDebito.jsx` | Token |
| `components/Declaraciones/Declaraciones.jsx` | Token |
| `components/Contabilidad/ContabilidadHub.jsx` | "plan base AELA" |
| `components/Dashboard/Dashboard.jsx` | Fallback name |
| `components/Productos/GestionProductos.jsx` | Nombre plantilla, texto |
| `components/Upgrade/UpgradePage.jsx` | Email, comentario |
| `components/Upgrade/UpgradeModal.jsx` | Email, comentario |
| `components/ErrorBoundary.jsx` | Log prefix |
| `App.jsx` | Comentario header |
| `App.css` | Comentario header |
| `components/Bancos/Bancos.css` | Comentario header |

### Backend (29 archivos)
| Archivo | Cambio |
|---------|--------|
| `.env` | `AELA_EDITION`, `AELA_DOMINIO_BASE` (DB URLs sin cambiar) |
| `.env.example` | Igual que .env |
| `package.json` | `"name": "aela-backend"` |
| `server.js` | Mensaje consola, var entorno |
| `app.js` | Mensaje API |
| `middleware/auth.js` | Var entorno |
| `middleware/edition.js` | Var entorno, mensajes de plan |
| `middleware/tenant.js` | Var entorno, dominio base |
| `config/prismaMaster.js` | Comentarios |
| `prisma/schema.prisma` | Comentarios |
| `routes/auth.js` | Var entorno |
| `routes/registro.js` | Dominio base |
| `routes/notasVenta.js` | Comentario |
| `routes/guiasRemision.js` | Comentario |
| `routes/bancos.js` | Comentario |
| `routes/buzon.js` | Comentario |
| `routes/productos.js` | Nombre archivo descarga |
| `routes/sync.js` | Comentario |
| `routes/facturas.js` | Comentario |
| `utils/configuracionSistema.js` | Var entorno |
| `utils/contabilidad.js` | Mensajes de error |
| `utils/colaSRI.js` | Comentario |
| `utils/buzon.js` | Comentario |
| `utils/importacionProductos.js` | Texto de ejemplo |
| `utils/provisionarTenant.js` | Nombre BD nuevos tenants `aela_${slug}` |
| `test/app.test.js` | Mensaje API en test |

### Documentación (10 archivos .md)
`README.md`, `docs/README.md`, `docs/arquitectura.md`, `docs/arquitectura-multitenant.md`, `docs/despliegue.md`, `docs/estado-proyecto.md`, `docs/guia-implementacion-sistemas-hermanos.md`, `docs/instalacion.md`, `docs/modulos.md`, `docs/puesta-en-marcha.md`

---

## ⚠️ Nota importante — Bases de datos
El `.env` actualmente apunta a `scfi_dev` y `scfi_master` (nombres originales). El código ya usa `AELA_EDITION` etc. pero la BD física no fue renombrada para no interrumpir el servicio en desarrollo. El renombrado de BD es el único pendiente crítico antes del despliegue a producción con la marca AELA.

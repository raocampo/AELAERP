# AELA ERP — Pendientes 2026-06-17

## Sesión: Módulo de Proformas (Cotizaciones / Presupuestos)

---

## ✅ Implementado esta sesión (commit `b12c644`)

### Módulo Proformas — completo

#### Base de datos
- Tabla `proformas` creada vía `applySchemaFixes.js` (idempotente — se aplica a BD principal y todas las BDs tenant al arrancar):
  - Campos: `id`, `empresaId`, `numero` (PRF-001-000000001), `secuencial`, datos cliente, totales (subtotal0/5/15, totalIva, importeTotal), `detalles` (JSONB), `vigenciaDesde/Hasta`, `estado`, `facturaId`, `creadoPor`
  - Estados: `BORRADOR` → `ENVIADA` → `ACEPTADA`/`RECHAZADA` → `CONVERTIDA`/`ANULADA`

#### Backend (`backend/routes/proformas.js`)
| Endpoint | Descripción |
|----------|-------------|
| `GET  /api/proformas` | Listar con filtros (estado, búsqueda, paginación 25/pág) |
| `POST /api/proformas` | Crear nueva proforma |
| `GET  /api/proformas/:id` | Detalle |
| `PUT  /api/proformas/:id` | Editar (solo BORRADOR o ENVIADA) |
| `POST /api/proformas/:id/estado` | Cambiar estado (ENVIADA, ACEPTADA, RECHAZADA) |
| `POST /api/proformas/:id/marcar-convertida` | Marcar como CONVERTIDA con facturaId |
| `POST /api/proformas/:id/anular` | Anular |

#### Permisos (`backend/utils/roles.js`)
- `proformas.gestionar` → admin, supervisor, facturador, secretaria
- `proformas.convertir` → admin, supervisor, facturador
- `proformas.anular`   → admin, supervisor

#### Frontend
| Componente | Ruta | Descripción |
|-----------|------|-------------|
| `ListaProformas.jsx` | `/proformas` | Tabla con filtros por estado (chips), búsqueda, paginación |
| `FormProforma.jsx` | `/proformas/nueva` y `/proformas/:id/editar` | Crear/editar: cliente con SRI lookup, líneas de detalle con búsqueda de producto del catálogo (dropdown), cálculo de totales en tiempo real, vigencia, observaciones |
| `DetalleProforma.jsx` | `/proformas/:id` | Vista detalle imprimible (`window.print()`), acciones por estado |

#### Flujo de conversión a Factura
- Botón **"Convertir a Factura"** en DetalleProforma (visible en BORRADOR/ENVIADA/ACEPTADA)
- Navega a `/facturas/nueva` pasando los datos de la proforma como `location.state.proforma`
- Al crear la factura exitosamente, se llama `POST /api/proformas/:id/marcar-convertida` con el `facturaId`
- La proforma queda en estado `CONVERTIDA` con link a la factura generada

#### Menú
- Nuevo ítem 📋 **Proformas** en el grupo **Ventas** del sidebar (entre Facturas y Notas de Venta)

---

## 🔴 Pendiente: Integración FormFactura ← Proforma

El botón "Convertir a Factura" lleva al usuario a `/facturas/nueva` con `location.state.proforma`. Falta implementar en `FormFactura.jsx`:

```js
// En FormFactura, al inicio:
const location = useLocation();
useEffect(() => {
  const proforma = location.state?.proforma;
  if (!proforma) return;
  // Pre-llenar campos del cliente
  // Pre-llenar detalles
  // Guardar proformaId en state local para llamar marcar-convertida al guardar
}, []);
```

Y al crear la factura exitosamente:
```js
if (proformaId) {
  await api.post(`/proformas/${proformaId}/marcar-convertida`, { facturaId: res.data.data.id });
}
```

**Archivo a modificar:** `frontend/src/components/Facturacion/FormFactura.jsx`

---

## 🟡 Pendientes medios

### Verificar en producción (deploy actual)
- [ ] Sidebar → Ventas → 📋 Proformas visible
- [ ] Crear proforma nueva: cliente (Consumidor Final y por CI/RUC), agregar líneas del catálogo y manuales
- [ ] Estados: Borrador → Enviada → Aceptada → Convertir a Factura
- [ ] Imprimir desde DetalleProforma (browser print)
- [ ] Buzón SRI — scraper aún sin verificar

### App Móvil
- Assets reales en `mobile/assets/`
- Cuenta EAS + generar APK

---

## 🟢 Backlog

| # | Tarea |
|---|-------|
| 1 | FormFactura: pre-llenar desde proforma (location.state.proforma) |
| 2 | Proformas: PDF descargable (en lugar de solo window.print) |
| 3 | Proformas: envío por email al cliente |
| 4 | Panel Super Admin SaaS |
| 5 | Pasarela de pagos PayPhone/Stripe |
| 6 | LORTI en nómina |
| 7 | App móvil ESC/POS + escáner barras |
| 8 | Tests e2e |

---

## Archivos creados / modificados

| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `backend/scripts/applySchemaFixes.js` | Mod | CREATE TABLE proformas + índices |
| `backend/utils/roles.js` | Mod | 3 permisos proformas.* |
| `backend/routes/proformas.js` | Nuevo | 7 endpoints CRUD + estado + convertir + anular |
| `backend/app.js` | Mod | require + app.use /api/proformas |
| `frontend/src/App.jsx` | Mod | lazy imports + 4 rutas /proformas |
| `frontend/src/components/Layout/Layout.jsx` | Mod | ítem Proformas en menú Ventas |
| `frontend/src/components/Proformas/ListaProformas.jsx` | Nuevo | Lista con filtros y paginación |
| `frontend/src/components/Proformas/ListaProformas.css` | Nuevo | Estilos lista |
| `frontend/src/components/Proformas/FormProforma.jsx` | Nuevo | Crear/editar + SRI lookup + búsqueda productos |
| `frontend/src/components/Proformas/FormProforma.css` | Nuevo | Estilos formulario |
| `frontend/src/components/Proformas/DetalleProforma.jsx` | Nuevo | Vista imprimible + acciones por estado |
| `frontend/src/components/Proformas/DetalleProforma.css` | Nuevo | Estilos detalle + @media print |

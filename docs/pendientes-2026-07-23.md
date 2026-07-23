# AELA ERP — Sesión 2026-07-22 / 2026-07-23 — TENANT_MISMATCH (parte 2), RIDE dinámico, Regalos/Combos en compras, Etiquetas de Productos, fix consulta SRI

## 🟢 PARA RETOMAR — checklist rápido

**Código**: todo commiteado y pusheado a `main` — commits `83d89e7` (TENANT_MISMATCH
en ListaFacturas.jsx + RIDE dinámico), `d180385` (commit vacío para forzar
redeploy tras un hiccup de infraestructura de Railway) y el commit de esta
documentación (regalos/combos + etiquetas + fix SRI). Nada sin commitear.

1. **Probar en producción con datos reales** (todo lo de esta sesión se probó
   local/con scripts ad-hoc, nada probado end-to-end en vivo por un usuario
   real todavía):
   - Descargar el RIDE PDF de una factura con descripción u observación larga
     (ej. facturas a instituciones públicas) y confirmar visualmente que no
     hay solapamiento — verificado localmente con PyMuPDF, pero no visto por
     el cliente.
   - Cargar una compra de Comercial S&S (tenant "sys") con las líneas de
     regalo reales (`P-1043664`, `M-1026055`) y confirmar que ya NO se crean
     productos huérfanos y que el stock del producto real sube correctamente.
   - Probar "Obsequios pendientes" con un ítem real que no matchee ningún
     prefijo, y confirmar que "Asignar a producto existente" mueve inventario
     sin tocar el costo del producto.
   - Imprimir una etiqueta real en la impresora térmica de un cliente y
     escanearla de vuelta contra el buscador de productos — el comando ESC/POS
     `GS k` (Code128) se armó y verificó a nivel de bytes, pero nunca se
     imprimió en una impresora física real.
   - Confirmar en Configuración Inicial (primer ingreso) que el RUC de una
     empresa nueva (no precargada en el catastro local) ahora sí autocompleta
     razón social/dirección desde el SRI — el fix se verificó contra el
     endpoint en vivo del SRI con RUCs reales, pero no se probó el flujo de
     onboarding completo en el navegador.
2. **Preguntar al cliente de Comercial S&S** si la lista de prefijos default
   (`P-`, `M-`, `OBQ-`, `COMBO-`, `REGALO-`, `BONI-`) cubre todos sus
   proveedores, o si necesita agregar más desde Configuración → Inventario
   (el editor de prefijos ya está implementado).
3. **Deuda técnica anotada, sin implementar (no urgente)**:
   - El matching de regalo/combo por prefijo solo funciona si la línea del
     producto real aparece en algún orden dentro de la MISMA factura y ya
     existe en catálogo (o se crea antes en el mismo array de detalles). Si el
     producto real todavía no existe en catálogo Y aparece después del regalo
     en la lista de líneas, el regalo cae en "Obsequios pendientes" en vez de
     matchear — caso borde no cubierto, aceptado como parte del diseño v1.
   - El campo `codigoAuxiliar` sigue siendo la convención implícita de
     "código de barras" (no hay un campo dedicado `codigoBarras` en el
     schema) — documentado así desde antes de esta sesión, sin cambios.

---

## 1. TENANT_MISMATCH — segunda ocurrencia (ListaFacturas.jsx)

Continuación del bug corregido en la sesión anterior (commit previo, ya
desplegado): el mismo patrón de `fetch()` directo con solo el header
`Authorization` (sin `X-Tenant-Slug`) apareció en 3 funciones más, todas
dentro de `frontend/src/components/Facturacion/ListaFacturas.jsx`, que mi
búsqueda anterior no cubrió porque usaban una variante distinta
(`SERVER_BASE` + `localStorage.getItem('token')` en vez de
`aela_token || token`):

- `descargarPDF` (RIDE de factura) y `descargarXML` dentro de `TabFacturas`.
- `descargarPDFnc` (RIDE de Nota de Crédito) dentro de `TabNotasCredito`.

Corregido reemplazando las 3 por `abrirBlobEnNuevaPestana`/`descargarXml`
(las mismas utilidades ya creadas en la sesión anterior en
`frontend/src/utils/exportCsv.js`), y se eliminó la constante `SERVER_BASE`
ya sin uso. Re-escaneado todo `frontend/src` — no quedan más ocurrencias del
patrón (`localStorage.getItem('token')`/`aela_token`) fuera de los 2 casos ya
confirmados como falsos positivos (`Layout.jsx`, `AuthContext.jsx`).

## 2. RIDE de factura — layout dinámico (descripción/observación largas)

`backend/utils/sri.js` → `generarRIDEFactura`: la tabla de detalle y la
sección "Información Adicional" usaban alto de fila **fijo** con
`lineBreak: false`, así que una Descripción u Observación larga (reportado
con una factura a un GAD provincial, concepto de contrato largo) se recortaba
y se solapaba con la fila/sección siguiente.

Corregido:
- Alto de fila de la tabla de detalle calculado con `doc.heightOfString()`
  sobre el texto real de la Descripción antes de dibujar el rectángulo de
  fondo (antes: `ROW_H = 13` fijo).
- Mismo tratamiento para cada fila de "Información Adicional" (Observación
  incluida).
- Salto de página (`doc.addPage()`) calculado explícitamente si el footer
  completo (Información Adicional + Forma de pago + caja de Totales) no cabe
  en lo que resta de la página — antes se asumía un margen fijo de 160pt que
  ya no alcanza con texto largo.

**Verificado** con PyMuPDF (renderizado a PNG, inspección visual): caso normal
(igual a la factura reportada) sin solapamiento, y caso extremo (observación
>600 caracteres + 15 líneas de detalle largas) — pasa correctamente a una
segunda página sin recortar ni solapar nada.

---

## 3. Regalos/combos de proveedor en compras — ya no crean productos huérfanos

### Problema reportado (Comercial S&S, tenant "sys")

Al inventariar una compra (manual, XML, clave de acceso o Buzón SRI), los
proveedores facturan ítems de regalo/combo a **$0.00** con un código derivado
del producto real mediante un prefijo (ej. producto real `1043664` → regalo
`P-1043664` "OBQ-DUCALES 120G"; producto real `1026055` → regalo
`M-1026055`). Las 3 rutas que auto-creaban productos (`compras.js` x2,
`buzon.js`) solo hacían matching **exacto** de código, así que estos ítems
siempre creaban un producto nuevo e independiente en vez de sumar su cantidad
al producto real. El cliente pidió explícitamente que esto no llenara la base
de datos de productos huérfanos.

### Implementación

- **Nuevo modelo** `items_compra_pendientes` (migración
  `20260722020000_items_compra_pendientes`) — registra los ítems a $0.00 sin
  match en vez de crear un producto huérfano: `codigoPrincipal`,
  `codigoAuxiliar`, `descripcion`, `cantidad`, `prefijoDetectado`, `estado`
  (`PENDIENTE`/`RESUELTO`/`IGNORADO`), y referencias a la compra, al producto
  asignado (si se resolvió) y al movimiento de inventario generado.
- **Nuevo campo** `configuracion_sistema.prefijosRegaloCompras` (JSON en
  texto) — lista de prefijos configurable por empresa, con default
  `['P-', 'M-', 'OBQ-', 'COMBO-', 'REGALO-', 'BONI-']`. Editor tipo "chips" en
  Configuración del Sistema (sección Inventario).
- **Función compartida** `backend/utils/comprasInventario.js` →
  `resolverOMarcarPendiente()`: centraliza en un solo lugar la lógica que
  antes estaba duplicada en 3 sitios (`compras.js` `POST /` y
  `POST /:id/registrar-inventario`, y `buzon.js` `importarDocumentoRecibido`).
  Lógica en 3 niveles:
  1. Match exacto (comportamiento histórico, sin cambios para ítems normales
     con costo > 0).
  2. Si no hay match exacto y el ítem cuesta $0.00: intenta emparejar por
     prefijo contra las demás líneas de la MISMA factura (ej. `P-1043664` →
     busca hermano `1043664`). Si lo encuentra y el producto ya existe en
     catálogo, suma la cantidad **sin pasar `costoUnitario`** al aplicar el
     movimiento de inventario — importante: `aplicarMovimientoInventario`
     (`backend/utils/inventario.js`) **sobreescribe** el costo del producto
     con el valor recibido, no calcula un promedio ponderado, así que pasar
     `costoUnitario: 0` habría corrompido el costo real del producto a $0.
  3. Si no hay match en ningún nivel: se registra en
     `items_compra_pendientes` en vez de crear un producto (salvo que se pida
     crear explícitamente, comportamiento legado ahora opt-in).
- **Nueva página** "Obsequios pendientes" (Compras → Obsequios pendientes,
  `frontend/src/components/Compras/ObsequiosPendientes.jsx`): lista los
  ítems por estado, con acciones "Asignar a producto existente" (busca y
  suma cantidad), "Ignorar" (sin efecto en inventario) o "Crear producto
  nuevo" (opt-in explícito, con PVP/IVA/inventariable editables).
- **Nuevos endpoints** `backend/routes/comprasPendientes.js`, montados como
  sub-ruta de `/api/compras/pendientes` (antes de cualquier ruta `/:id` del
  router de compras, para que Express no confunda "pendientes" con un id).

**Verificado** con un script ad-hoc contra la BD (transacción con rollback
intencional, sin dejar datos de prueba): confirmado que (a) una línea normal
se comporta exactamente igual que antes, (b) un regalo con prefijo
reconocido suma stock al producto real y **no** altera su `costoUnitario`, y
(c) un regalo sin match no crea ningún producto huérfano.

---

## 4. Módulo de Etiquetas de Productos + lector de código de barras

Pedido explícito del cliente ("esto se puede aplicar a todos los tenants"):
generar/imprimir etiquetas con código de barras para pegar en productos
físicos, y poder leer productos con pistola/lector en más pantallas.

- **`backend/utils/impresoraEscPos.js`**: nuevas funciones
  `generarBarcode128()` (comando ESC/POS nativo `GS k`, Code128 subset B —
  la impresora rasteriza el barcode ella misma, no requiere generar/enviar
  una imagen), `generarEtiquetaProducto()` (nombre + precio + barcode,
  repetible N copias con corte de papel entre cada una) e `imprimirBuffer()`
  (envío TCP genérico, reutilizable fuera de recibos de venta).
- **Nuevos endpoints** en `backend/routes/impresora.js`:
  `POST /api/impresora/etiquetas/preview` (datos resueltos para previsualizar
  en el frontend sin imprimir) y `POST /api/impresora/etiquetas/imprimir`.
- **Nueva página** "Etiquetas de Productos" (menú Inventario,
  `frontend/src/components/Productos/EtiquetasProductos.jsx`): buscar
  productos, elegir cantidad de copias por producto, seleccionar ancho de
  papel (58/80mm) y imprimir en la térmica ya configurada en Configuración →
  Impresora.
- **Convención de barcode**: usa `codigoAuxiliar` del producto (ya era la
  convención implícita de "código de barras" desde la importación masiva por
  Excel) con fallback a `codigoPrincipal`.
- **Lector de código de barras (pistola) agregado en 2 pantallas más** (en
  POS ya funcionaba desde antes):
  - `FormFactura.jsx`: `onKeyDown` de Enter en la barra de búsqueda de
    productos ya existente, agrega la línea con match exacto (mismo patrón
    que POS).
  - `FormCompra.jsx`: nuevo input dedicado (antes no existía ningún buscador
    de producto en este formulario, todo era 100% manual) — al escanear,
    agrega la línea usando el **costo** del producto (no el PVP de venta,
    distinción importante porque en compras el campo relevante es el costo).

**Verificado**: bytes del buffer ESC/POS inspeccionados manualmente (`GS h`,
`GS w`, `GS H`, `GS k` con el largo correcto de datos) — no probado contra
una impresora térmica física todavía (ver checklist arriba).

---

## 5. Fix: autocompletado de datos de empresa desde el SRI no funcionaba

Reportado en la pantalla de "Configuración inicial" (primer ingreso): al
ingresar el RUC, siempre mostraba "No se encontró información en el SRI.
Puedes continuar ingresando los datos manualmente."

**Causa raíz** (verificada empíricamente con llamadas HTTPS reales, no
solo lectura de código): el SRI descontinuó sin aviso público el endpoint
`ConsolidadoContribuyente/obtenerPorNumeroRuc` que usaba
`backend/utils/sriContribuyente.js` (responde 404 de forma consistente). El
autocompletado solo funcionaba para RUCs ya precargados en la tabla local
`contribuyentes_sri` (catastro CSV del SRI, ~6.8M de filas) — cualquier RUC
no incluido ahí (empresa nueva, RUC reciente) caía siempre en "no
encontrado", tanto en "Configuración inicial" como en el botón "Consultar
SRI" de Configuración SRI (ambos comparten la misma función
`obtenerEmpresaSri()`).

**Fix**: se identificó el endpoint vigente del SRI —
`ConsolidadoContribuyente/obtenerPorNumerosRuc` (nótese el plural "Numeros",
distinto del anterior) con el parámetro `ruc` (no `numeroRuc`), que devuelve
un **array** en vez de un objeto suelto, y ya no incluye dirección ni nombre
comercial (esos datos ahora viven en un endpoint separado,
`Establecimiento/consultarPorNumeroRuc`). `consultarContribuyenteSri()` ahora
llama ambos endpoints en paralelo y combina el resultado en el mismo formato
que ya esperaba `parsearContribuyenteSri()`, con un ajuste menor en ese
parser para el campo renombrado `estadoContribuyenteRuc`.

**Verificado**: función probada de punta a punta contra RUCs reales (ej.
`0190301850001`, "FLORIPAMBA") vía llamada directa a la función y vía el
endpoint HTTP real (`GET /api/auth/empresa-sri/:ruc`) — ambos devuelven los
datos completos (razón social, nombre comercial, dirección, régimen,
obligado a contabilidad, etc.).

---

## Verificación general de la sesión

- Backend: `node -c` en todos los archivos tocados, sin errores de sintaxis.
- Backend: servidor de desarrollo reiniciado (nodemon) tras cada cambio, sin
  errores en logs; `GET /api/health` responde `ok` en todo momento.
- Frontend: `npx vite build` limpio, sin errores, para todos los componentes
  nuevos/modificados (`ListaFacturas`, `ObsequiosPendientes`,
  `EtiquetasProductos`, `FormCompra`, `FormFactura`, `ConfiguracionSistema`).
- Migración Prisma (`items_compra_pendientes` + `prefijosRegaloCompras`)
  aplicada limpiamente contra la BD de desarrollo local (`prisma migrate
  deploy`, ya que `migrate dev` requiere una terminal interactiva no
  disponible en este entorno).
- Nada de lo anterior se probó todavía contra producción ni fue confirmado
  visualmente por un usuario real en el navegador — ver checklist al inicio
  de este documento.

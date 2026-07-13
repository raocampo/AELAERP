# AELA ERP — Sesión 2026-07-13

## Resumen ejecutivo

Sesión de correcciones de bugs detectados en uso real + feature de importación masiva de cobros.
Commit principal: `b1be14a`.

---

## 1 — Bug: compras manuales excluidas de declaraciones F104/F101

**Síntoma**: facturas de compra ingresadas manualmente (sin XML del SRI) no aparecían en el
formulario F104 ni en el resumen F101, aunque estaban en el sistema.

**Causa raíz** (`backend/routes/declaraciones.js`): el filtro `receptorEsRuc: { not: false }` en
Prisma+PostgreSQL genera `WHERE campo != false`, que por SQL three-valued logic excluye NULLs
(`NULL != false → NULL → falsy`). Las compras manuales tienen `receptorEsRuc = null` (no se
sabe si fue a RUC o cédula) → se excluían silenciosamente.

El comentario en el código decía "receptorEsRuc null SÍ se incluye" pero el filtro hacía lo
contrario. El ATS solo muestra documentos autorizados SRI — ese comportamiento es **correcto y
por diseño**, no es un bug.

**Fix**: F104 y F101 usan `OR: [{ receptorEsRuc: null }, { receptorEsRuc: true }]` que genera
`WHERE (campo IS NULL OR campo = true)` — incluye correctamente las compras manuales.

---

## 2 — Bug: cambiar cuenta contable no regeneraba el asiento

**Síntoma** (cliente LSAC, empresa Consorcio): al cambiar la cuenta contable de una compra,
guardar y actualizar, el asiento contable existente no se actualizaba.

**Causa raíz — DetalleCompra.jsx**: `guardarCuentaGasto` solo llamaba a `PUT /compras/:id`
(actualiza `cuentaGastoId`) pero nunca llamaba a `POST /compras/:id/regenerar-asiento`. El
usuario tenía que presionar el botón "↺ Regenerar asiento" por separado — no era obvio.

**Causa raíz — ListaCompras.jsx**: `ModalCuenta` mostraba DOS botones ("Guardar" y "Guardar y
regenerar asiento"). El usuario presionó "Guardar" sin ver el segundo botón.

**Fix**:
- `DetalleCompra.jsx`: `guardarCuentaGasto` ahora detecta automáticamente si hay asiento abierto
  (`tieneAsientoContable && !asientoCerrado`) y lo regenera al guardar, sin acción extra.
- `ListaCompras.jsx`: cuando hay asiento abierto, el modal muestra un SOLO botón "↺ Guardar y
  regenerar asiento" (elimina "Guardar solo" para evitar confusión). El aviso cambia de
  "usa Guardar y regenerar" a "el asiento se regenerará automáticamente al guardar".

---

## 3 — Feature: Importar cobros desde Excel (CxC)

Tab "Importar" en Cuentas por Cobrar (antes era `TabProximamente`).

**Backend** (`backend/routes/cxc.js`):
- `GET /api/cxc/cobros/importar/plantilla` — descarga plantilla Excel con encabezados y 2 filas
  de ejemplo. Columnas: Número Factura, Monto, Fecha, Método de Pago, Referencia, Observaciones.
- `POST /api/cxc/cobros/importar` — acepta multipart/form-data con campo `archivo` (.xlsx/.xls/.csv).
  Procesa fila por fila; para cada una: valida campos requeridos, busca la factura por número,
  verifica que no esté anulada y sea AUTORIZADA, calcula saldo pendiente (con FOR UPDATE),
  registra el cobro y genera asiento contable. Omite filas vacías. Devuelve:
  `{ exitosas: [{fila, numeroFactura, monto, numero}], errores: [{fila, numeroFactura, monto, error}],
    totalExitosas, totalErrores }`.

**Frontend** (`CuentasPorCobrarHub.jsx`):
- Nueva función `TabImportarCobros`:
  - Botón "⬇ Descargar plantilla"
  - Área de drop-file (clic para explorar): muestra nombre y tamaño del archivo seleccionado
  - Botón "⬆ Importar cobros" (deshabilitado sin archivo o mientras procesa)
  - Resultado con tarjetas de conteo (verde: exitosas, rojo: errores) + tablas de detalle

---

## 🔴 VERIFICAR EN PRODUCCIÓN

1. **F104 compras manuales** — ingresar una factura de compra manual (sin XML SRI), ir a
   Declaraciones → F104 del período y confirmar que aparece en los totales de compras. Antes
   no aparecía.
2. **Cambiar cuenta contable** — en el detalle de una compra con asiento (✓ Con asiento), cambiar
   la cuenta contable y guardar. Confirmar que el toast dice "Cuenta actualizada y asiento
   regenerado" y que el asiento en Libro Diario usa la cuenta nueva. Probar también desde el
   listado de compras (botón "Cuenta contable") — el modal ahora muestra solo "↺ Guardar y
   regenerar asiento" (no hay "Guardar" separado).
3. **Importar cobros** — en Cuentas por Cobrar → tab "Importar", descargar la plantilla, llenar
   con 2-3 facturas vigentes con sus montos, subir y confirmar que el resultado muestra los
   cobros registrados con número de recibo. Probar también un caso de error (número de factura
   inexistente) para confirmar que aparece en la tabla de errores.

---

## Contexto técnico rápido

```
Repo:     github.com/raocampo/AELAERP  rama: main
Commit:   b1be14a
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
```

**Archivos modificados:**

| Archivo | Cambio |
|---------|--------|
| `backend/routes/declaraciones.js` | Fix filtro receptorEsRuc null en F104 y F101 |
| `backend/routes/cxc.js` | +multer +xlsx; GET /cobros/importar/plantilla; POST /cobros/importar |
| `frontend/src/components/Compras/DetalleCompra.jsx` | guardarCuentaGasto auto-regenera asiento |
| `frontend/src/components/Compras/ListaCompras.jsx` | ModalCuenta unifica en un solo botón regenerar |
| `frontend/src/components/CuentasPorCobrar/CuentasPorCobrarHub.jsx` | TabImportarCobros completo |

---

## 🟡 BACKLOG — Próximas sesiones

### CxC pendiente
- **Órdenes de pago** — sigue como `TabProximamente`. Definir qué significa exactamente en
  contexto ecuatoriano: ¿documentos que el cliente emite para autorizar un pago? ¿órdenes
  internas? Confirmar con el cliente antes de implementar.

### General (heredado)
- Inventario multi-bodega (grande, planear aparte)
- Caja chica formal
- Anticipos clientes/proveedores
- Pasarela de pagos
- Impuesto a la Renta en nómina (tabla LORTI)
- Panel Super Admin

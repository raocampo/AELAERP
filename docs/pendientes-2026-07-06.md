# AELA ERP — Sesión 2026-07-06

## Resumen ejecutivo

Sesión de retomada: git pull del trabajo hecho desde casa (2026-07-04/05, 24 commits,
HEAD `ee37c7a`), actualización de toda la documentación del proyecto y arranque de
verificación en producción de los 12 puntos pendientes del motor contable.

---

## ✅ Completado al inicio de sesión

- `git pull` exitoso (local stash + pull + fast-forward desde `c09e044` a `ee37c7a`)
- Documentación actualizada:
  - `docs/estado-proyecto.md`: sección §24 con todo lo implementado el 04-05/07
  - `docs/pendientes-2026-07-06.md`: este archivo

---

## 🔴 LISTA DE VERIFICACIÓN EN PRODUCCIÓN — empezar aquí

Todos los puntos vienen del trabajo hecho desde casa. El código está correcto
(verificado con scripts de integración contra Postgres real, 22+ asserts). Lo que
sigue REQUIERE pruebas en el navegador / Railway:

### Punto 0 — [PRIORIDAD] Asientos faltantes en facturas históricas ya importadas

**Qué hacer:**
1. Ir a `aela.corpsimtelec.com` → Ventas → Importar históricas
2. En el Paso 1 (instrucciones), buscar la tarjeta "¿Ya importaste facturas históricas antes?"
3. Hacer clic en **"Generar asientos faltantes"**
4. Confirmar que el resultado muestra "X asientos generados" (no 0)
5. Ir a Contabilidad → Libro Diario y confirmar que aparecen asientos tipo `FACTURA`
   con las fechas históricas correctas (2023, 2024, etc. — no la fecha de hoy)

**¿Por qué?** Todas las facturas importadas ANTES del fix `3a032cf` nunca generaron
asiento contable. Esta operación es idempotente — puede correrse varias veces sin daño.

---

### Punto 1 — Confirmar deploy de Railway

**Qué hacer:**
1. Abrir Railway → proyecto AELA → deployment activo → pestaña "Details"
2. Verificar que el commit de GitHub asociado es `ee37c7a` o posterior
3. Si el deployment activo es anterior (ej. `3 de julio`): forzar "Clear build cache & redeploy"

---

### Punto 2 — Bancos en Consorcio Vial

**Qué hacer:**
1. Cambiar empresa a Consorcio Vial UCH... (EmpresaSwitcher en el header)
2. Ir a Bancos
3. Hacer Ctrl+Shift+R (recarga sin caché)
4. Abrir "Nueva Cuenta Bancaria":
   - El modal debe verse SÓLIDO (fondo blanco/gris, no transparente)
   - El selector "Cuenta contable" debe mostrar las cuentas del Plan de Cuentas
     de Consorcio Vial (no vacío)
5. Crear una cuenta bancaria de prueba vinculada a una cuenta contable, guardar
6. Confirmar que aparece bajo Consorcio Vial (no bajo la empresa base de Robert)

**Fix previo:** `a3ee110` — variables CSS `--color-surface` no definidas → transparencia.
Fix empresa: `2886f8b` — `obtenerEmpresaId` ahora usa `req.empresa.id` (activa).

---

### Punto 3 — Configuración contable de compras

**Qué hacer:**
1. Ir a Contabilidad → Plan de Cuentas → tarjeta "⚙️ Configuración de asientos automáticos — Compras"
2. En el selector "Gasto por compra", elegir una cuenta de gasto propia (no la genérica)
3. Guardar
4. Ir a Compras → registrar o importar una compra no inventariable
5. Ir a Contabilidad → Libro Diario → confirmar que el asiento `COMPRA` usa la cuenta
   que se configuró (no `5.2.01.001 Compras Locales`)

---

### Punto 4 — Costo de ventas en facturas

**Qué hacer:**
1. Emitir una factura con al menos un producto inventariable (con stock disponible)
2. Esperar autorización SRI (o probar en ambiente de pruebas)
3. Ir a Contabilidad → Libro Diario → confirmar DOS asientos para esa factura:
   - `FACTURA`: CxC/Ventas/IVA (ya existía antes)
   - `COSTO_VENTA`: Costo de Ventas Debe / Inventario Haber (nuevo, feat `c7adfd7`)
4. Verificar que el monto del `COSTO_VENTA` = cantidad × costo unitario de la venta

---

### Punto 5 — Asientos de Notas de Venta

**Qué hacer:**
1. Crear una nota de venta (POS/RIMPE) con al menos un producto inventariable
2. Ir a Libro Diario → confirmar DOS asientos:
   - `NOTA_VENTA`: Caja Debe / Ventas Haber (sin IVA — RIMPE)
   - `COSTO_VENTA`: Costo de Ventas Debe / Inventario Haber
3. Anular la nota de venta
4. Confirmar asiento `ANULACION_NOTA` que reversa ambos

---

### Punto 6 — Buzón SRI genera asiento de compra

**Qué hacer:**
1. Importar una factura de compra por el Buzón SRI (XML/ZIP o scraper)
2. Ir a Libro Diario → confirmar asiento `COMPRA` con la fecha del documento

---

### Punto 7 — Scraper SRI login (pendiente desde sesión 2026-07-01)

**Qué hacer:**
1. Abrir Railway → Logs del backend
2. Buscar: `[SRI] sriScraper.js build 2026-07-01 — incluye hash MD5+SHA-512`
3. Si NO aparece → "Clear build cache & redeploy" en Railway

---

### Punto 8 — Movimientos bancarios con asiento contable

**Qué hacer:**
1. Ir a Bancos → seleccionar una cuenta vinculada al Plan de Cuentas
2. Registrar un movimiento (depósito o retiro) ELIGIENDO una cuenta contrapartida
3. Ir a Libro Diario → confirmar asiento `MOVIMIENTO_BANCO`
4. Registrar otro movimiento SIN cuenta contrapartida → confirmar que se guarda igual (sin asiento)

---

### Punto 9 — Retenciones y NC/ND recibidas generan asiento

**Qué hacer:**
1. Importar por el Buzón SRI una retención recibida (un cliente nos retiene)
2. Ir a Libro Diario → confirmar asiento `RETENCION_RECIBIDA`:
   - Debe: Retención IVA `1.1.07.001` + Retención Renta `1.1.07.002`
   - Haber: Cuentas por Cobrar
3. Importar una Nota de Crédito o Nota de Débito recibida de proveedor
4. Confirmar asiento `DOC_RECIBIDO`

---

### Punto 10 — Centros de Costo

**Qué hacer:**
1. Ir a Contabilidad → tab "Centros de Costo" (nuevo)
2. Crear un centro: ej. `SUC01 - Sucursal Norte`
3. Ir a Contabilidad → Libro Diario → "Nuevo asiento contable"
4. En una línea de detalle, usar el selector "Centro de Costo" para asignar el centro creado
5. Guardar y confirmar que el centro aparece en el detalle del asiento

---

### Punto 11 — Provisiones de nómina

**Qué hacer:**
1. Ir a Talento Humano → Nómina
2. Seleccionar una nómina con empleados calculados (BORRADOR)
3. Clic en "▶ Procesar" → leer el toast (debe indicar "Asiento de provisión generado")
4. Ir a Libro Diario → confirmar asiento `NOMINA` con cuentas `5.1.02.xx` / `2.1.05.xx`
5. En la misma nómina, clic en "✅ Pagar"
6. Confirmar segundo asiento `NOMINA` (pago): Sueldos por Pagar Debe / Caja Haber

---

### Punto 12 — Importar compras históricas

**Qué hacer:**
1. Ir a Compras → "Importar históricas" (entrada nueva en el menú)
2. Descargar la plantilla
3. Llenar con al menos 2 filas reales de compras de períodos anteriores
   (campos obligatorios: `numero_factura`, `tipo_id`, `identificacion`, `razon_social`, `fecha_emision`)
4. Cargar el Excel → revisar el preview (errores en rojo)
5. Importar → confirmar que los asientos `COMPRA` aparecen en Libro Diario con la
   **fecha histórica** de cada fila (no la fecha de hoy)

---

## 🟡 BACKLOG — Próximas sesiones (sin urgencia)

### Contabilidad
- **Motor automático SRI → cuenta** (mejora opcional): código retención/IVA 
  auto-mapea a su cuenta sin que el contador tenga que configurarlo manualmente.
  La `configuracion_contable` ya cubre el caso reportado por el cliente.

### Infraestructura / Producción
- **Puppeteer en Railway** — solo si el scraper SRI (punto 7) sigue fallando
- **Panel Super Admin SaaS** — tenants, planes, stats, activar/suspender

### App Móvil
- Logos reales AELA (icon 1024×1024, splash 512×512)
- EAS build → APK para Android
- Bluetooth ESC/POS (impresora térmica)

### Módulos pendientes
- Importar Renta (LORTI) automático en nómina (tabla progresiva)
- Historial salarial por empleado (contratos)
- Pasarela de pagos PayPhone/Stripe
- Tests e2e Playwright/Cypress
- Exportación PDF/Excel de nómina (más allá del CSV actual)

---

## Contexto técnico rápido

```
Repo:     github.com/raocampo/AELAERP  rama: main  HEAD: ee37c7a
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
DB:       PostgreSQL Railway (railway + aela_lsac + aela_mprq)
```

**Migraciones pendientes de aplicar en Railway** (si no se han aplicado aún):
```
20260704000000_configuracion_contable   ← tabla configuracion_contable (6 campos)
20260704120000_centros_costo            ← tabla centros_costo + centroCostoId en detalle
```
Si Railway no las aplicó automáticamente, también están en `applySchemaFixes.js`
(agrega columnas con ALTER TABLE idempotente al arrancar). Verificar en Railway logs
al arrancar: `applySchemaFixes: todas las sentencias ejecutadas`.

**Archivos clave del motor contable:**
| Archivo | Responsabilidad |
|---------|----------------|
| `backend/utils/contabilidad.js` | Todas las funciones de asientos automáticos |
| `backend/routes/contabilidad.js` | CRUD plan, asientos, centros de costo, config |
| `backend/routes/buzon.js` | `_generarAsientoSiAplica` para docs SRI importados |
| `backend/routes/facturas.js` | Asiento venta + costo al autorizar |
| `backend/routes/notasVenta.js` | Asientos nota de venta (crear + anular) |
| `backend/routes/bancos.js` | Asiento opcional movimientos bancarios |
| `backend/routes/talentoHumano.js` | Asientos provisión y pago de nómina |
| `backend/utils/importarComprasHistoricas.js` | Parser Excel compras históricas |
| `frontend/src/components/Compras/ImportarComprasHistoricas.jsx` | UI wizard compras históricas |

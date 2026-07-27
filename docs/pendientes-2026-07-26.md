# AELA ERP — Sesión 2026-07-26 — Cajas físicas por Punto de Emisión + límite SuperAdmin

## 🟢 PARA RETOMAR — checklist rápido

**Código**: commiteado y pusheado a `main` (commit `593e2b1`). Nada sin commitear.

1. **Probar en producción con datos reales** (todo verificado localmente con
   `node --test`, migración aplicada contra `scfi_dev`/`scfi_master` locales, y
   un script ad-hoc de concurrencia con rollback/limpieza explícita — nunca
   contra producción ni en el navegador):
   - Confirmar `[schema-fix]` en logs de arranque de Railway para la BD
     principal, master y cada tenant activo — la migración agrega la tabla
     `cajas`, la columna `puntos_emision.ultimoSecuencialFactura` (con
     backfill) y `empresas.maxSucursales`/`maxCajas`.
   - Ir a Configuración → Sucursales y Puntos de Venta con un tenant real,
     confirmar que cada punto de emisión ya tiene su "Caja General"
     automática (backfill de la migración, no requiere acción manual).
   - Crear una 2ª caja bajo el MISMO punto de emisión en un tenant de prueba
     real, y facturar desde ambas casi simultáneamente para confirmar en el
     navegador que la numeración no se pisa (verificado localmente con 20
     transacciones concurrentes independientes, no con 2 pestañas reales).
   - Confirmar que el panel SuperAdmin permite setear/limpiar
     `maxSucursales`/`maxCajas` de un tenant y que el bloqueo (403) aparece al
     alcanzar el límite.
2. **Terminología en la UI**: la página "Sucursales y Puntos de Venta" ahora
   muestra 3 niveles (Sucursal → Punto de Emisión → Cajas). Revisar con el
   cliente supermercado (motivo original del pedido) que el nuevo flujo
   (agregar cajas dentro de un punto de emisión ya existente, en vez de crear
   un punto de venta nuevo por cada caja) es claro antes de que lo use.
3. **Fuera de alcance esta sesión, documentado a propósito**:
   - Caja Diaria (conciliación de efectivo) sigue siendo 1 sola por empresa
     por día — no se tocó `caja.js`/`CajaDiaria.jsx`. Con `cajas` ya existiendo
     como entidad real, esto queda más fácil para una sesión futura (agregar
     `cajaId` a `cajas_diarias`).
   - El contador atómico solo se implementó para **Facturas**. Notas de
     Crédito/Débito, Retenciones, Liquidaciones de Compra y Guías de Remisión
     siguen con el cálculo viejo de 2 pasos (ya existente, sin regresión) —
     deuda técnica documentada, solo relevante si algún cliente necesita
     múltiples cajas emitiendo esos documentos concurrentemente.
4. **Nota de entorno local** (no relacionado al feature, encontrado de paso):
   `backend/.env` tenía `DATABASE_MASTER_URL`/`DATABASE_ADMIN_URL` con una
   contraseña de Postgres incorrecta (`postgres` en vez de la real) — nunca se
   notó porque `MODO_EMPRESA=mono` no conecta a la BD master en desarrollo.
   Corregido en este equipo (`.env` no se sube al repo) y se creó la BD
   `scfi_master` local (antes no existía) para poder probar el panel
   SuperAdmin localmente.

---

## Contexto

El usuario preguntó cómo se crean los puntos de venta/cajas (ya implementado
en la sesión 07-24), y de paso aclaró el modelo real que necesita: un negocio
puede tener varias cajas registradoras físicas que **comparten un mismo
punto de emisión SRI** (una sola secuencia), en vez de 1 punto de emisión por
caja. Confirmado con el usuario: el punto de emisión es un código
autoasignado por la empresa (no lo registra ni lo limita el SRI, a diferencia
del establecimiento), así que no hace falta declarar uno nuevo por cada caja.

También preguntó si la creación de sucursales/cajas debería controlarse desde
SuperAdmin "para tener más control". Se analizaron 3 opciones con el usuario
(AskUserQuestion) y se eligió: mantener el autoservicio del tenant, pero
agregar un límite numérico configurable solo desde SuperAdmin — mismo patrón
ya existente de `modulosContratados` (techo independiente del plan, `null` =
sin restricción).

---

## Hallazgo crítico durante la investigación (no reportado por el cliente)

Los 7 tipos de documento SRI calculan su siguiente secuencial en 2 pasos
separados sin lock (`findFirst`/`aggregate(max)` + cálculo, luego `create` —
`backend/utils/secuenciales.js` + cada route). Hoy el riesgo es bajo porque
normalmente un solo operador emite a la vez bajo un punto de emisión. En
cuanto varias cajas físicas comparten un mismo punto de emisión, la
concurrencia deja de ser un caso raro — 2 cajas emitiendo casi
simultáneamente podrían leer el mismo máximo y generar secuenciales
duplicados (rechazo del SRI o, peor, un duplicado silencioso).

**Decisión de alcance**: se corrigió el cálculo atómico solo para
**Facturas** (comprobante electrónico SRI real, con clave de acceso — un
duplicado aquí sí es grave). Notas de Venta ya usa un secuencial único
GLOBAL por empresa (no por punto de emisión, no es comprobante electrónico
SRI — comentario explícito en el schema desde antes de esta sesión) y no se
ve afectada por este cambio: compartir cajas bajo un punto de emisión no
cambia su riesgo, que ya era compartido a nivel de toda la empresa. NC/ND/
Retenciones/Liquidaciones/Guías de Remisión son flujos de back-office
(un solo operador), quedan con el patrón actual — deuda técnica documentada,
no urgente.

---

## Implementado

### Modelo de datos
- **Nueva tabla `cajas`**: `empresaId`, `puntoEmisionId` (FK), `nombre`,
  `activo`. Varias cajas pueden compartir el mismo `puntoEmisionId`
  (`@@unique([puntoEmisionId, nombre])`, sin unicidad global de nombre).
- **`puntos_emision.ultimoSecuencialFactura`** (Int, nullable) — contador
  atómico. Migración con backfill: `GREATEST(secInicialFactura, MAX(secuencial)
  real de facturas existentes)` — no reinicia la numeración de nadie.
- Migración `20260726000000_cajas_secuencial_atomico` + reflejada en
  `backend/scripts/applySchemaFixes.js` (obligatorio para tenants ya
  provisionados — lección de la sesión 07-23), incluyendo backfill de "Caja
  General" para cada punto de emisión existente sin ninguna caja todavía.
- **`empresas.maxSucursales`/`maxCajas`** (Int, nullable, `null` = ilimitado)
  + espejo en `tenants` de la BD master (migración nueva en
  `prisma/migrations-master/`, aplicada por `scripts/migrateMaster.js`).

### Backend
- **`backend/utils/secuenciales.js`**: nueva función
  `siguienteSecuencialFacturaAtomico()` — `UPDATE puntos_emision SET
  ultimoSecuencialFactura = ultimoSecuencialFactura + 1` (atómico a nivel de
  fila en Postgres, sin `SELECT FOR UPDATE` explícito). La función vieja
  `siguienteSecuencial()` se mantiene intacta para los demás documentos.
- **`backend/routes/facturas.js`**: usa el nuevo contador atómico en vez del
  cálculo de 2 pasos.
- **`backend/routes/cajas.js` (nuevo)**: CRUD completo + `GET /activas` (lista
  para el selector, auto-crea "Caja General" si un punto de emisión aún no
  tiene ninguna — mismo patrón que `/puntos-emision/activos`). Permiso
  `sucursales.gestionar` reutilizado.
- **`backend/utils/provisionarTenant.js`**: nueva `actualizarLimitesTenant()`
  (dual-write master + BD del tenant, mismo patrón que
  `actualizarModulosContratadosTenant`).
- **`backend/routes/superAdmin.js`**: `PUT /tenants/:id` acepta
  `maxSucursales`/`maxCajas`.
- **Enforcement**: `sucursales.js` y `cajas.js` devuelven 403 al alcanzar el
  límite configurado (si `null`, sin restricción).

### Frontend
- **`Sucursales.jsx`**: cada punto de emisión ahora es una tarjeta con sus
  cajas anidadas (chips + "+ Agregar caja").
- **`SelectorPuntoVenta.jsx`**: cambia de listar puntos de emisión a listar
  cajas (`GET /cajas/activas`), aplanando el resultado al mismo contrato
  `{ establecimiento, puntoEmision }` que ya esperan `PuntoVenta.jsx`,
  `FormFactura.jsx` y `FormGuiaRemision.jsx` — **cero cambios** en esos 3
  archivos. `localStorage` key renombrada a `aela_caja_activa`.
- **`PanelSuperAdmin.jsx`**: 2 inputs numéricos (vacío = ilimitado) + badge
  en la lista de tenants.

---

## Verificación realizada

- `node --test`: 29/29.
- Migración aplicada limpiamente contra `scfi_dev` local (`prisma migrate
  deploy`) y contra `scfi_master` local (`node scripts/migrateMaster.js`,
  ejecutado 2 veces seguidas — confirma idempotencia).
- **Concurrencia real**: script ad-hoc con 20 `prisma.$transaction()`
  **independientes** (cada una su propia conexión, no una transacción
  compartida) disparadas con `Promise.all` contra el mismo punto de emisión
  de prueba — 20 secuenciales únicos y consecutivos (1..20), sin duplicados
  ni saltos. Punto de emisión de prueba eliminado al final, sin dejar datos.
- `npx vite build`: limpio, incluye los chunks de `Sucursales` y
  `PanelSuperAdmin` actualizados.
- Servidor (`node server.js`) levantado localmente: `GET /api/health` → 200,
  `GET /api/cajas` y `/api/cajas/activas` → 401 (montada y protegida, no 404).
- **No probado**: flujo completo en navegador con 2 cajas reales facturando
  al mismo tiempo desde 2 pestañas/dispositivos distintos — la concurrencia
  se verificó a nivel de base de datos, no de UI end-to-end. Ver checklist al
  inicio de este documento.

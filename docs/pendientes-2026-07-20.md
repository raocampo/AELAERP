# AELA ERP — Sesión 2026-07-20 (documentación de trabajo pendiente desde el 2026-07-17)

## Contexto

Al retomar hoy (`git pull` → sin cambios remotos nuevos) se encontró que, además del
commit `51602db` ("módulos activables por cliente"), había un **diff sin commitear**
en el working tree que continúa exactamente la misma feature — probablemente
interrumpido antes de documentarse o comitearse. No existía ningún
`docs/pendientes-*.md` que lo cubriera. Este documento registra ambos: lo ya
commiteado (`51602db`) y lo que seguía sin commitear al momento de retomar.

**Verificado antes de documentar** (para confirmar que el código pendiente está
completo y no a medio terminar):
- `node -c` en los 13 archivos backend modificados → sin errores de sintaxis.
- `node --test test/configuracionSistema.test.js` → 6/6 tests pasan.
- `npx prisma validate` → schema válido.
- `npx vite build` (frontend) → build limpio.

**Verificado también en navegador (Playwright) contra `aela_db` local, con
restauración de todos los datos de prueba al finalizar** (password del usuario 1,
`empresas.plan`, `configuracion_sistema.tipoSistema`/`facturacionHabilitada`
devueltos a su valor original — ver hashes/valores comparados post-restauración):

1. Plan Lite (`tipoSistema='lite'`): `GET /api/configuracion-sistema` devuelve
   `facturacionHabilitada/cajaDiariaHabilitada/posHabilitado/inventarioHabilitado/
   comprasHabilitadas = true` y `buzonSriHabilitado = false`, como se esperaba.
   En el navegador: `/caja`, `/pos`, `/compras`, `/inventario`, `/facturas`
   accesibles; `/buzon` muestra la pantalla "Requiere plan Medium" (bloqueo
   correcto vía `MediumRoute`, que renderiza inline sin cambiar la URL — así que
   la URL igual a `/buzon` en el log no es un bug, es el comportamiento normal de
   esa ruta). Sidebar muestra badge "LITE" y candados 🔒 correctos en Buzón
   SRI/Liquidaciones/Importar históricas.
2. `facturacionHabilitada=false` en plan Pro (para aislar el gate de MediumRoute):
   `GET /api/facturas` → `403` con el mensaje correcto; en el navegador,
   `/facturas` redirige a `/dashboard` (bloqueo real vía `ModuleRoute`, que sí usa
   `<Navigate>`).
3. Botón "Consultar SRI" en Configuración SRI: click real → `GET
   /empresas/consultar-sri/:ruc` → `200 { fuente: "local", ... }`, formulario se
   actualiza con los datos del catastro. Sin errores de consola.
4. Warning de React "two children with the same key ... /productos" visto en
   `/inventario` — se confirmó con `git stash` que **ya existe en el código
   commiteado actual** (no es una regresión de este diff); queda fuera del
   alcance de esta sesión.

No se probó contra Railway/producción — eso ocurre en el paso de despliegue más
abajo.

---

## Ya commiteado — `51602db` (2026-07-17, sesión previa)

feat: módulos activables por cliente, independiente del plan lite/medium/pro

- Cierra huecos del sistema de flags existente: Buzón SRI estaba atado al flag de
  Compras; Bancos/CxC/CxP/Caja Chica/Declaraciones/Retenciones recibidas no tenían
  flag propio.
- Nuevo campo `empresas.modulosContratados` (JSONB, nullable) — techo explícito de
  módulos por tenant, independiente de los 3 planes fijos (lite/medium/pro). `null`
  = usa el techo legado derivado de `plan` (comportamiento actual sin cambios).
  Gestionable desde el panel super-admin (`PanelSuperAdmin.jsx`), con presets
  rápidos por plan y edición individual por tenant.
- Objetivo de negocio: poder vender combos como "solo Contabilidad" o "solo
  Tributario + Buzón SRI" sin depender de los 3 tiers fijos.

---

## Sin commitear al retomar hoy — continuación de la misma feature

### 1. Plan Lite ampliado

Antes: Lite = solo Facturas, Notas de Venta, Clientes, Productos. Ahora Lite
también incluye:
- **Caja Diaria** y **POS** (antes exclusivos de Medium+).
- **Compras — solo ingreso manual** (`FormCompra`). La importación masiva (Excel,
  XML histórico, Buzón SRI) sigue exclusiva de Medium/Pro — gateada ahora a nivel
  de ruta individual (`soloFull` en `/importar/xml`, `/importar/autorizacion`,
  `/importar/plantilla`, `/importar/preview`, `/importar/ejecutar` dentro de
  `compras.js`, y en `POST /proveedores/importar-excel`) en vez de a nivel de
  router completo como antes.
- **Inventario**, con el tope subido de 100 → 200 productos
  (`LIMITE_PRODUCTOS_LITE` en `middleware/edition.js`).

Cambios en `app.js`: `/api/proveedores` y `/api/compras` ya no llevan
`soloMediumOPro` a nivel de router — cada ruta de importación lo aplica
individualmente donde corresponde.

### 2. Nuevo módulo activable: `facturacionHabilitada`

Hasta ahora Facturación (Facturas, Notas de Venta, Notas de Débito, Guías de
Remisión) era el único bloque del sistema **siempre visible, sin flag propio**.
Se agrega como módulo activable más, igual que Compras/Caja/POS/etc.:

- Migración `20260717030000_facturacion_habilitada`: columna
  `configuracion_sistema.facturacionHabilitada BOOLEAN DEFAULT true` (default
  true → no oculta nada a tenants existentes).
- `backend/scripts/applySchemaFixes.js`: mismo `ADD COLUMN IF NOT EXISTS` para
  BDs de tenant.
- Backend: `requiereModulo('facturacionHabilitada')` agregado como gate en
  `facturas.js`, `guiasRemision.js`, `notasDebito.js`, `notasVenta.js`. Las rutas
  `/configuracion*` de `facturas.js` (certificado, firma, logo) se dejan **sin
  gate** porque las usan también retenciones/notas de crédito, no solo emisión.
- Frontend: `ModuleRoute moduleKey="facturacion"` envuelve las rutas de
  facturas/notas-venta/notas-débito/guías-remisión en `App.jsx`; ítem "Facturación"
  en el catálogo de módulos de `ConfiguracionSistema.jsx` y `PanelSuperAdmin.jsx`;
  `obtenerModulosHabilitados()` en `frontend/src/utils/sistema.js` expone la key
  `facturacion`.
- **Caso de uso objetivo**: permite armar un cliente "solo Contabilidad /
  Tributario" (p. ej. una contadora que no emite comprobantes desde este sistema)
  desactivando Facturación sin tocar nada más.

### 3. Botón "Consultar SRI" en Configuración SRI + catastro local primero

- `backend/utils/sriContribuyente.js` → `obtenerEmpresaSri(ruc)`: ahora consulta
  primero `consultarCatastroLocal()` (catastro precargado, ~6.8M RUCs desde CSVs
  del SRI, instantáneo y funciona offline) y solo si no encuentra nada recurre a
  la API en vivo del SRI. Mismo patrón que ya usaban `clientes.js`/`proveedores.js`.
- `backend/routes/empresas.js`: `GET /empresas/consultar-sri/:ruc` — permiso
  ampliado de `soloAdmin` a `adminOContador` (el contador ya puede editar esta
  info manualmente en Configuración SRI, tiene sentido que pueda auto-rellenarla);
  la respuesta ahora incluye `fuente: 'local' | 'sri'`.
- `frontend/src/components/Facturacion/ConfiguracionSRI.jsx`: nuevo botón "🔍
  Consultar SRI" en la sección "Información Tributaria Adicional" — trae RIMPE,
  Contribuyente Especial, Negocio Popular y Obligado a Contabilidad usando el RUC
  ya cargado en el formulario; el admin/contador revisa y guarda con el botón
  normal (no auto-guarda).

### 4. Documentación tocada en el mismo diff (parcial)

`docs/arquitectura-multitenant.md` ya tenía cambios sin commitear actualizando la
tabla de planes (Lite ahora incluye Caja/POS/Compras manual, 200 productos;
Medium destaca productos ilimitados + importación masiva + Buzón SRI). **No**
menciona todavía el módulo `facturacionHabilitada` como pieza del sistema de
"módulos contratados" — puede valer la pena ampliarlo si se usa ese caso de uso
("solo Contabilidad") con un cliente real.

---

## 🔴 Pendiente antes de comitear / desplegar

1. ~~Decidir con el usuario si se commitea~~ — RESUELTO: usuario pidió proceder
   con el despliegue a producción, sin borrar datos de clientes existentes.
2. ~~Probar localmente contra BD real y en el navegador~~ — RESUELTO: ver
   sección de verificación arriba (Playwright contra `aela_db` local).
3. ~~Probar el botón "Consultar SRI"~~ — RESUELTO: verificado con RUC del
   catastro local (`fuente: "local"`). No se probó el caso "solo API en vivo"
   (requeriría un RUC real no precargado y conectividad al SRI en vivo) — bajo
   riesgo, es el mismo código que ya usan `clientes.js`/`proveedores.js` en
   producción.
4. **Migraciones pendientes de aplicar en Railway** (`prisma migrate deploy`,
   automático al arrancar vía `start.sh`) y en BDs de tenant
   (`applySchemaFixes.js`, también automático) — todas las migraciones nuevas
   son `ADD COLUMN` con `DEFAULT`, sin `DROP`/`DELETE`/`TRUNCATE` (revisadas
   línea por línea antes del despliegue). Confirmar en logs de Railway que no
   aparece `P2022` tras el push a `main`.

## 🔴 Pendientes heredados de `docs/pendientes-2026-07-17.md` (aún sin confirmar)

Estos siguen abiertos y no se tocaron hoy — requieren hablar con el cliente o
verificar en producción, no son tareas de código:

1. Confirmar si el reporte de "otras compras exentas/no objeto" del cliente era
   sobre compras manuales (ya cubierto) o carga masiva/Excel histórica (no
   cubierto).
2. Confirmar si el cliente tiene `negocioPopular` marcado en Configuración SRI
   (gate de Notas de Venta en el ATS).
3. Confirmar si tiene compras viejas mal clasificadas como factura que deban
   corregirse manualmente o vía script.
4. Desplegar a Railway/Vercel y probar en producción con datos reales del
   cliente (compra "No objeto/Exento", nota de venta de proveedor RIMPE, ATS de
   negocio popular) — **nada de la sesión del 07-17 ha tocado producción
   todavía**, según el propio checklist de ese día.

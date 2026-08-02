# AELA ERP — Sesión 2026-08-02 — Verificación en navegador + fixes + doc de módulos

## Contexto

Al iniciar la sesión, el checkout local tenía ~2000 líneas "modificadas"/sin
commitear (nómina real, Compras de Importación, migraciones) que resultaron ser
duplicado exacto (byte a byte, salvo CRLF/LF) de 13 commits que otra sesión
(oficina, 2026-07-29/31) ya había pusheado a `origin/main`. Se verificó
contenido archivo por archivo antes de descartar el stash — cero pérdida de
trabajo. Mismo patrón ya documentado varias veces antes (ver
`RECORDATORIO: Push a GitHub` en la memoria persistente) — el flujo de alternar
entre 2 equipos sigue produciendo este falso conflicto cada cierto tiempo.

## 1. Verificación en navegador real de las 6 features de la sesión 07-29/31

La sesión anterior había implementado y pusheado nómina real, Compras de
Importación, catálogo de retenciones, Estado de Flujo de Efectivo, Estado de
Cambios en el Patrimonio y alerta de tope RIMPE, pero **nada se había probado
en un navegador real** (solo contra un backend aislado). Se levantó el entorno
local (backend puerto 5600 + frontend Vite puerto 5174, ambos contra `scfi_dev`
con la empresa de pruebas "Corp Simtelec") y se manejó con Playwright
(`chromium`, instalado ad-hoc en el scratchpad — no hay `chromium-cli` en este
equipo).

**Las 6 features + el cierre de ejercicio (7ma, probada con permiso explícito
del usuario por ser irreversible) funcionan correctamente:**

1. **Talento Humano → Pagos Especiales**: empleado de prueba → nómina Agosto
   2026 procesada → corrida de Décimo Tercero generada y pagada. Cálculo
   correcto ($500 salario / 12 = $41.67), asiento contable generado en el
   Libro Diario.
2. **Compras de Importación (DIM/DAU)**: toggle en Configuración del Sistema +
   formulario completo (FOB/flete/seguro/DAI/FODINFA/ICE/ISD). CIF se calcula
   en vivo correctamente (1000+50+10=1060).
3. **Catálogo de retenciones renta**: 100 opciones en el selector de concepto
   (83 códigos, 17 con variante antes/después de marzo 2026). Verificado que
   el % cambia correctamente (2%→3%) al elegir la variante "307_DESDE".
4. **Estado de Flujo de Efectivo** y **Estado de Cambios en el Patrimonio**:
   renderizan con datos reales de Corp Simtelec, cuadran (Efectivo Final $90,
   Cuadra: Sí).
5. **Alerta de tope RIMPE**: probada con una factura sintética — nivel
   "warn" (80%-100% del tope) y nivel "error" (>100%) ambos con mensaje y
   montos correctos. Requiere `configuracion_sri.negocioPopular` o
   `.contribuyenteRimpe` activo.
6. **Cierre de ejercicio anual**: ejecutado en local con autorización del
   usuario (acción irreversible). Asiento `CIERRE_ANUAL` correcto (traslada
   utilidad neta a "Utilidad del Ejercicio"), campo `cerrado=true` confirmado
   bloqueando edición futura del asiento.

Todos los datos de prueba se limpiaron al terminar (factura sintética,
config RIMPE, empleado, nómina, pago especial) — la contabilidad de Corp
Simtelec quedó exactamente como estaba antes ($275 activos / $245 pasivos).

**Nota**: no se probó la corrida de Utilidades 15% (depende del cierre de
ejercicio, que ahora sí existe en local si se quiere retomar esto después) ni
la Liquidación de haberes — quedan para otra sesión si se necesita.

## 2. Dos bugs reales encontrados y corregidos (commit `811f7bb`)

Durante la verificación en navegador aparecieron 2 problemas que no estaban
documentados:

### a) `backend/routes/impresora.js` — 500 en modo monoinstancia/cliente directo
Los 16 endpoints del módulo de impresora térmica (config, recibo, etiquetas,
cajón de dinero) usaban `req.prisma.X` directo. `req.prisma` solo se setea
cuando `middleware/tenant.js` (`resolverTenant`) resuelve un tenant por
subdominio (modo SaaS) — en monoinstancia/cliente directo (Railway dedicado,
como Puchaicela o Comercial S&S) queda `undefined`, y cualquier llamada
tiraba `TypeError: Cannot read properties of undefined`. Esto es justo lo que
la sesión de nómina (commit `b9c1321`) había detectado como "un 500
preexistente y no relacionado" sin diagnosticar la causa.

**Fix**: reemplazado `req.prisma` por el proxy compartido `config/prisma.js`
(mismo patrón que usa el resto de rutas, ej. `talentoHumano.js`) — resuelve
automáticamente el cliente correcto vía `AsyncLocalStorage` en modo SaaS, o
cae al cliente global en monoinstancia. Cero cambio de comportamiento en modo
SaaS, arregla monoinstancia.

**Impacto real**: afectaba a todo cliente directo con impresora térmica
configurada (funcionalidad de la sesión 2026-07-26) — no solo a un caso de
prueba. Si algún cliente directo reportó "la impresora no funciona" o "no
carga Configuración → Impresora" en las últimas semanas, esta es la causa.

### b) `empleados.cargasFamiliares` sin campo en el formulario
El reparto de utilidades 15% (`talentoHumano.js`, líneas 961-978) ya leía
`empleado.cargasFamiliares` para repartir el 5% correspondiente, y el campo
existe en el schema (`Int @default(0)`) — pero no había ningún input en
`FormEmpleado.jsx` para cargarlo, ni el backend lo aceptaba en
POST/PUT `/empleados`. Degradaba bien (caía a reparto por días con nota
explicativa, no rompía nada), pero la función nunca se podía usar como se
diseñó.

**Fix**: agregado el campo en `FormEmpleado.jsx` (sección "IESS y
Beneficios") y en ambos endpoints de `talentoHumano.js`.

**Verificación**: `GET /impresora/config` ya no da 500 (confirmado en
navegador); empleado de prueba con `cargasFamiliares=3` persiste
correctamente en BD; `node --test`: 29/29. Commiteado y pusheado.

## 3. Cómo funciona la activación de módulos por plan/cliente (documentado a pedido del usuario)

El usuario preguntó cómo activar solo ciertos módulos (ej. "solo POS +
Facturación + Inventario") para un cliente. Dos niveles distintos, ninguno
nuevo — ya existían, solo se explicaron:

- **SuperAdmin (`/super-admin` → editar tenant)**: checkbox "Techo
  personalizado (independiente del plan)" — al activarlo, aparece una grilla
  con los 13 módulos del catálogo (`MODULOS_CATALOGO` en
  `PanelSuperAdmin.jsx`) para elegir exactamente cuáles ve ese cliente, sin
  importar si su plan es Lite/Medium/Pro. Guarda en `empresas.modulosContratados`
  (array; `null` = usa el techo del plan, comportamiento legado). Pensado
  explícitamente para "vender combos" (comentario propio del código). Hay
  presets rápidos por plan para partir de ahí.
- **Configuración → Config Sistema (por empresa)**: el admin de cada empresa
  puede prender/apagar módulos dentro del techo que le fue asignado (checkboxes
  en "Módulos avanzados", más "Punto de Venta (POS)" e "Inventario" en
  secciones separadas) — no puede activar algo por encima del techo.

Backend: `capacidadesPlan()` (techo legado por plan) y `capacidadesModulos()`
(techo por `modulosContratados` si existe, si no cae a `capacidadesPlan`) en
`backend/utils/configuracionSistema.js`. Frontend gatea rutas con
`<ModuleRoute moduleKey="...">` en `App.jsx` y oculta ítems de menú en
`Layout.jsx` (prop `modulo:`).

## 🔴 PARA RETOMAR

1. **App móvil (Expo/React Native, `mobile/`) no respeta el sistema de
   módulos en absoluto.** Los 4 tabs (`app/(tabs)/_layout.tsx`: POS,
   Inventario, Facturas, Configuración) se muestran siempre, sin ninguna
   verificación contra `capacidadesModulos`/`modulosContratados` — a
   diferencia del frontend web, que sí gatea cada ruta con `ModuleRoute`.
   Confirmado con `grep` en `mobile/app`, `mobile/context`, `mobile/services`:
   cero referencias a `modulosContratados`/`posHabilitado`/etc. Si un cliente
   tiene, por ejemplo, un combo "solo Contabilidad" (sin POS), la app móvil
   igual le mostraría el tab de POS. **Pendiente definir con el usuario**: si
   se quiere gating igual que el web (ocultar tabs según módulos contratados),
   o si la app móvil es de alcance más chico a propósito (solo
   POS/Inventario/Facturas, sin Contabilidad/Tributario/etc. de por sí — en
   cuyo caso solo faltaría ocultar el tab si ni siquiera POS/Inventario/
   Facturas están contratados). Explorar `mobile/context/AuthContext.tsx` y
   `mobile/services/api.ts` para ver qué datos de empresa/plan ya llegan al
   login antes de decidir el mecanismo.
2. Buzón SRI — descarga automática con Puppeteer reordenado
   (`@sparticuz/chromium` primero) sigue sin confirmarse en Railway
   producción (ver `docs/pendientes-2026-07-29-*.md` y memoria
   [sri_scraper](../../../.claude/projects/../memory/sri_scraper.md) para el
   detalle técnico completo).
3. 16 registros de Puchaicela con ratio de IVA fuera del patrón conocido,
   pendientes de que la contadora confirme el valor correcto antes de
   tocarlos.
4. Del backlog "más PRO" (auditoría 2026-07-29), sin implementar todavía:
   Anticipo de Impuesto a la Renta, Anexo RDEP, avisos de entrada/salida
   IESS, F101 completo (hoy solo resumen orientativo), notas a los EEFF.

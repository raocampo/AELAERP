# AELA ERP — Sesión 2026-08-03 — Bug tipo de identificación + módulos móvil + Dashboard + estado consolidado

## Contexto

El usuario reportó una factura rechazada por el SRI ("ERROR EN LA
IDENTIFICACION DEL RECEPTOR: la longitud del número de cédula debe ser 10")
a un cliente al que ya se le había facturado sin problema el mes anterior
con el mismo número de identificación.

## 1. Bug real encontrado y corregido (commit `29c9acb`)

**Causa raíz**: en `FormFactura.jsx`, `FormNotaVenta.jsx` y `PuntoVenta.jsx`,
el `<select>` de "Tipo de identificación" (RUC/Cédula) es independiente del
campo de texto donde se escribe el número. Al autocompletar datos del
cliente (búsqueda en BD local o consulta al SRI vía `GET /clientes/sri/:id`),
se rellenaban razón social, dirección, email, teléfono — pero el tipo de
identificación seleccionado **nunca se corregía**. Si el selector quedó en
"Cédula" (su valor por defecto, `useState('05')`) y se escribía/pegaba un
RUC de 13 dígitos, el comprobante se enviaba al SRI con esa combinación
inconsistente y era rechazado — quemando el número secuencial (no se puede
reutilizar, hay que emitir el siguiente).

**Fix**:
- Los 3 formularios ahora corrigen el tipo de identificación según la
  longitud del número apenas se detecta un RUC/cédula válido (antes de
  esperar la respuesta de la búsqueda — así también aplica a clientes
  nuevos sin registro previo), y lo vuelven a ajustar si la búsqueda
  devuelve un `tipoIdentificacion` explícito desde el backend.
- Nueva validación en el backend (`POST /facturas` y `POST /notas-venta`):
  rechaza con un mensaje claro cualquier combinación tipo/longitud
  inconsistente **antes** de consumir un secuencial, en vez de descubrirlo
  recién cuando el SRI lo rechaza.

**Verificado** con Playwright contra datos reales (el mismo cliente del
reporte, "LABORATORIO CLINICA SAN JOSE RUIZ Y GUARICELA Y CIA", RUC
1191794911001, que coincidentemente también existe en la BD local de
pruebas): el selector pasa correctamente de "Cédula" a "RUC (04)" al
escribir el número y salir del campo. `node --test`: 29/29. `vite build`:
sin errores.

**Nota para el usuario**: la factura rechazada (002-002-000000202) queda
permanentemente quemada — hay que emitir una nueva para ese cobro de $500,
ahora sí saldrá correctamente.

## 2. Housekeeping de git (mismo patrón de siempre)

Al retomar, el checkout local tenía ~10 archivos "modificados" que resultaron
ser, otra vez, duplicado exacto (byte a byte, salvo CRLF/LF) de 2 commits que
la sesión de oficina del 2026-08-02 ya había pusheado (`811f7bb` fix
impresora + cargas familiares, `3d60fb4` docs). Se verificó archivo por
archivo antes de descartar (`git diff origin/main -- <archivo>` = 0 líneas)
y se completó el `git pull` sin pérdida de trabajo. Mismo flujo de
"RECORDATORIO: Push a GitHub" documentado ya varias veces — alternar entre
2 equipos sigue produciendo este falso conflicto cada cierto tiempo; seguir
verificando byte a byte antes de descartar cualquier "modificación" local
sospechosa en vez de asumir.

## 3. App móvil: tabs ocultos según módulos contratados (commit `6cbac26`)

Resuelto el pendiente del punto 1 original de esta lista. `GET
/configuracion-sistema` (ya conectado en `AuthContext.recargarSistema`, sin usar)
devuelve `posHabilitado`/`inventarioHabilitado`/`facturacionHabilitada` correctamente
calculados contra el techo del tenant (`capacidadesModulos()`) — solo faltaba leerlos.

- `types/index.ts`: agregado `facturacionHabilitada` a `Sistema`.
- `app/(tabs)/_layout.tsx`: cada `Tabs.Screen` usa `href: null` cuando su módulo
  está deshabilitado — oculta el tab de la barra sin desmontar la ruta (mecanismo
  propio de expo-router, confirmado en `node_modules/expo-router/build/layouts/
  TabsClient.d.ts`).
- `AuthContext.tsx`: nueva `primerTabDisponible(sistema)` (POS→Inventario→Facturas→
  Configuración, primero habilitado; `sistema` null/sesión vieja en caché se trata
  como habilitado para no ocultar de golpe antes de que cargue).
- `app/index.tsx` y el `RouteGuard` de `app/_layout.tsx`: el redirect tras login/
  selección de empresa ya no apunta siempre a `/pos` fijo, usa
  `primerTabDisponible()`.

**Verificado**: `tsc --noEmit` limpio; `GET /configuracion-sistema` contra `scfi_dev`
real confirma los 3 nombres de campo exactos y que responden a toggles reales
(`posHabilitado` probado false→true).
**🔴 Falta**: no hay emulador Android/iOS en este entorno — no se pudo confirmar
visualmente el tab bar renderizado. Probar en la próxima sesión con acceso a un
emulador o dispositivo físico.

## 4. Investigado: app móvil apuntando a "onrender" — no es un bug de código

El usuario reportó que la app instalada se conecta a una URL vieja de onrender.com.
Se buscó "onrender"/"render.com" en TODO el repo — código actual **y todo el
historial de git** — cero coincidencias, esa URL nunca existió en este código.
`mobile/services/api.ts` y `mobile/.env.example` apuntan a
`https://aelaerp-production.up.railway.app/api` desde el primer commit del móvil
(`b9f4b78`).

**Conclusión**: nada que corregir en el código. La app instalada en el teléfono es
un build (APK/IPA) compilado antes de la migración a Railway, con la URL fijada en
tiempo de build (posible env var de EAS en el dashboard de expo.dev, invisible desde
este repo). **Acción pendiente, no de código**: recompilar y reinstalar con
`eas build`. Si tras reinstalar sigue fallando, ahí sí revisar variables de entorno
en expo.dev.

## 5. Bug real: Dashboard sumaba facturas rechazadas/pendientes como ventas (commit `af12c3a`)

Reportado por el usuario: "en el dashboard... suma las ventas [sin verificar] si la
factura está autorizada o rechazada". Confirmado — `GET /empresas/estadisticas`
(panel principal) sumaba `importeTotal` de TODAS las facturas del período sin
filtrar `estadoSri`. Una factura RECHAZADA, o atascada en
PENDIENTE_FIRMA/ENVIADO/ERROR, se contaba igual que una AUTORIZADA en:
- "Ventas del mes" (tarjeta del dashboard),
- "Facturas del año" (contador),
- el cálculo de ingresos anuales para la alerta de tope RIMPE agregada el 08-02
  (mismo bug de origen, nunca se había notado porque la alerta era nueva).

**Fix**: nueva constante `ESTADOS_FACTURA_VALIDOS = ['AUTORIZADO', 'HISTORICO']`
(HISTORICO = venta real importada sin envío al SRI, mismo criterio que ya usa
`POST /facturas/importar-historicas`) aplicada a las 3 queries de facturas del
endpoint. `notas_venta` no necesitaba el mismo filtro — no tienen `estadoSri`, son
documentos internos (RIMPE Negocio Popular) sin flujo de autorización SRI.

**Verificado** contra `scfi_dev` real: con una factura AUTORIZADA de $100 y una
RECHAZADA de $9000 en el mismo mes, el dashboard ahora reporta `ventasMes=100`
(antes 9100), `facturas=1` (antes 2), `alertaRimpe=null` (antes se disparaba por
los $9000 rechazados). `node --test`: 29/29. Datos de prueba limpiados.

**🔴 Sin auditar todavía**: revisar si el mismo patrón (agregación sin filtro de
`estadoSri`) se repite en otro reporte/panel no revisado en esta pasada — este bug
solo se corrigió donde el usuario lo reportó (el dashboard), no se hizo una
auditoría sistemática de todos los `.aggregate()`/`.count()` sobre `facturas` en
el resto del código.

## 🔴 PARA RETOMAR MAÑANA DESDE LA OFICINA (consolidado)

1. **Verificar visualmente en emulador** el gating de módulos de la app móvil
   (punto 3 arriba) — no se pudo hacer en este equipo.
2. ✅ **RESUELTO 2026-08-04** (commit `58db3d7`) — Auditar el resto del código
   por el mismo patrón del punto 5: encontrados 2 archivos más con el mismo
   bug (`declaraciones.js` F104/F101/disponibles y `facturas.js GET
   /reportes/tributario`, el backing real de la página "Reportes
   Tributarios"), corregidos y verificados contra datos reales. Ver
   `docs/pendientes-2026-08-04.md` para el detalle completo.
3. **App móvil "onrender"** (punto 4) — recompilar con `eas build` y reinstalar
   para confirmar que ya toma la URL de Railway; si persiste, revisar env vars en
   expo.dev.
4. **Buzón SRI — descarga automática** sigue sin confirmarse en Railway
   producción (Puppeteer con `@sparticuz/chromium` reordenado, fix ya pusheado
   desde el 07-29, nunca verificado end-to-end en prod real).
5. **16 registros de Puchaicela** con ratio de IVA fuera del patrón conocido —
   esperando que la contadora confirme el valor correcto antes de tocarlos.
6. **Backlog "más PRO"** (auditoría 2026-07-29), sin implementar: Anticipo de
   Impuesto a la Renta, Anexo RDEP, avisos de entrada/salida IESS, F101 completo
   (hoy solo resumen orientativo), notas a los EEFF, apertura automática del año
   siguiente tras el cierre de ejercicio.
7. **Nombre exacto del campo "RUC Proveedor Sistema"** (Res.
   NAC-DGERCGC26-00000027) no verificado contra ninguna ficha técnica del SRI
   publicada — el mecanismo es correcto, la etiqueta es una elección razonable
   propia. Revisar si el SRI publica una ficha técnica actualizada que la
   especifique.
8. **Utilidades 15% y Liquidación de haberes** (nómina) — implementadas pero no
   se alcanzaron a probar en navegador real. Pendiente si se quiere verificar
   antes de que un cliente las use.
9. Dos bugs de timezone/drift ya documentados hace más de una semana y nunca
   corregidos (bajo impacto, ver memoria persistente): `startOfDay`/`endOfDay`
   en `contabilidad.js` puede desplazar el corte de un rango de fechas según el
   offset UTC del servidor; y hay 5-7 tablas en la BD (`cheques_recibidos`,
   `comprobantes_bancarios*`, `movimientos_tarjeta`, `proformas`,
   `tarjetas_credito`) que no están en `schema.prisma` — sin investigar si hay
   que limpiarlas o restaurar su definición.

## Commits de esta sesión (2026-08-03, ambas partes del día)
`29c9acb` fix tipo identificación · `ccabd70` docs · `6cbac26` feat app móvil
módulos · `af12c3a` fix Dashboard ventas rechazadas.

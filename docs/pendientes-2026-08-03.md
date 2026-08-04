# AELA ERP — Sesión 2026-08-03 — Bug tipo de identificación + estado consolidado

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

## 🔴 PARA RETOMAR (consolidado — incluye lo que ya estaba pendiente del 08-02)

1. **App móvil no respeta el sistema de módulos por plan/cliente** — los 4
   tabs (POS/Inventario/Facturas/Configuración) se muestran siempre sin
   verificar `modulosContratados`. Pendiente decidir con el usuario si se
   quiere gating igual que el web, o si la app es de alcance fijo a
   propósito. Ver detalle técnico en `docs/pendientes-2026-08-02.md`.
2. **Buzón SRI — descarga automática** sigue sin confirmarse en Railway
   producción (Puppeteer con `@sparticuz/chromium` reordenado, fix ya
   pusheado desde el 07-29, nunca verificado end-to-end en prod real).
3. **16 registros de Puchaicela** con ratio de IVA fuera del patrón
   conocido — esperando que la contadora confirme el valor correcto antes
   de tocarlos.
4. **Backlog "más PRO"** (auditoría 2026-07-29), sin implementar: Anticipo
   de Impuesto a la Renta, Anexo RDEP, avisos de entrada/salida IESS al
   IESS, F101 completo (hoy solo resumen orientativo), notas a los EEFF,
   apertura automática del año siguiente tras el cierre de ejercicio.
5. **Nombre exacto del campo "RUC Proveedor Sistema"** (Res.
   NAC-DGERCGC26-00000027) no verificado contra ninguna ficha técnica del
   SRI publicada — el mecanismo es correcto, la etiqueta es una elección
   razonable propia. Revisar si el SRI publica una ficha técnica
   actualizada que la especifique.
6. **Utilidades 15% y Liquidación de haberes** (nómina) — implementadas
   pero no se alcanzaron a probar en navegador real en la sesión del 08-02
   (sí Décimo Tercero). Pendiente si se quiere verificar antes de que un
   cliente las use.
7. Dos bugs de timezone/drift ya documentados hace más de una semana y
   nunca corregidos (bajo impacto, ver memoria persistente): `startOfDay`/
   `endOfDay` en `contabilidad.js` puede desplazar el corte de un rango de
   fechas según el offset UTC del servidor; y hay 5-7 tablas en la BD
   (`cheques_recibidos`, `comprobantes_bancarios*`, `movimientos_tarjeta`,
   `proformas`, `tarjetas_credito`) que no están en `schema.prisma` — sin
   investigar si hay que limpiarlas o restaurar su definición.

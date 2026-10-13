# Sesión 2026-10-13 — ATS ronda 5: formaPago se exige desde USD 500, no 1000

Continuación de `docs/pendientes-2026-10-12-cierre-sesion-final.md` (que
cerraba la ronda 4 pendiente de confirmación del usuario con DIMM).

## Reportado

El usuario subió el ATS regenerado (con la ronda 4 ya desplegada) a DIMM.
Resultado: **ERR:1** (antes eran varios tipos distintos de error) —
"No ha reportado las FORMAS DE PAGO utilizadas, aun cuando la suma de las
BASES IMPONIBLES y los MONTOS de IVA e ICE exceden los USD. 500.00",
repetido en 4 líneas (proveedores 1191710149001, 0190360636001,
1104986219001, 1791854616001).

## Diagnóstico

El código (`routes/ats.js`) solo emitía `formaPago` cuando el total de la
línea superaba **$1000** — umbral que venía de un error de DIMM leído de
pasada en la ronda 1 original, nunca re-verificado contra la fuente. Las
4 líneas señaladas tienen totales reales de $580.17, $821.10, $610.00 y
$605.37 — todas entre $500 y $1000, exactamente el rango que el umbral
de $1000 dejaba pasar sin exigir el campo. El propio mensaje de DIMM cita
literalmente "$500.00" como el umbral, así que se corrigió directo sin
necesidad de volver a la Ficha Técnica.

## Fix (commit `3d0552d`)

`totalBaseEImpuestos > 1000` → `totalBaseEImpuestos > 500` en el bloque
`<detalleCompras>` de `routes/ats.js`. Mismo mecanismo de construcción de
`<formasDePago>` (sin cambios ahí), solo cambió el umbral que decide si
se incluye.

## Verificación

165/165 tests backend sin regresiones (no había un test que fijara el
valor del umbral en sí, solo de la estructura del XML generado — no se
agregó uno nuevo porque el umbral vive inline en el handler de la ruta,
no en una función pura extraída, igual que el resto de esa lógica).

## Pendiente

**Falta que el usuario regenere el ATS una vez más y lo vuelva a subir a
DIMM** para confirmar que con el umbral de $500 ya no queda ningún ERR.
Si vuelve a aparecer algo, pedir el texto exacto del reporte (no asumir
que es el mismo patrón) — igual que en las rondas 2-4, cada vuelta reveló
algo puntual y distinto.

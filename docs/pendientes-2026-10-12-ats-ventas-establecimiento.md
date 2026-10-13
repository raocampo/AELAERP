# Sesión 2026-10-12 (3ra vuelta) — ATS: falta `<ventasEstablecimiento>` + advertencias explicadas

Continuación directa de `docs/pendientes-2026-10-12-ats-xml-mal-formado-pagoexterior.md`
(mismo día). El usuario regeneró el ATS de 2026-09 con ese fix aplicado y
volvió a correr DIMM — **el error de "XML mal formado" ya no aparece**. El
nuevo reporte trae 2 tipos de ADVERTENCIA (no bloquean) y 1 ERROR real.

## 1. Advertencia de IVA — confirmado que es del propio DIMM, no de AELA

"EL MONTO DE IVA reportado [X] es diferente al esperado [Y]" en 9 líneas
visibles. Revisando la proporción exacta en las 9: **siempre
`reportado = esperado × 1.25`** (ej. 444.95/355.96=1.2500, 3.65/2.92=1.2500,
0.26/0.21=1.2381≈1.25 con redondeo de centavos). 1.25 = 15% ÷ 12% — DIMM
sigue calculando su "esperado" con la tarifa de IVA vieja (12%, derogada
2024) en vez de la real (15%) vigente para estas fechas. Mismo patrón ya
confirmado puntualmente en la sesión del 09-12 (factura TECNOAUSTRAL,
verificada contra el XML autorizado real del SRI) — ahora con 9 casos más
siguiendo EXACTAMENTE la misma proporción, confirma que es 100%
consistente y es un problema del validador DIMM, no de los datos. **No se
toca código** — cambiarlo falsificaría el IVA real que el SRI ya autorizó.

## 2. Advertencia de "pago al exterior... 22 por ciento" — aviso genérico esperado

Aparece en TODAS las líneas de compra, texto condicional ("Si el pago al
exterior... corresponde a un gasto deducible y sobrepasa..."). Es el aviso
estándar que DIMM muestra siempre que el bloque `<pagoExterior>` está
presente, recordando la regla de retención del 22% — no es un error de
los datos. **No se quita** `pagoExterior`: el primer reporte de DIMM (antes
de cualquier fix) marcaba como ERROR real la AUSENCIA total de esta
información ("No se ha reportado la información de PAGO LOCAL O AL
EXTERIOR") — quitarlo resucitaría ese error.

## 3. Error real: falta `<ventasEstablecimiento>`

"LOS DETALLES DE LAS VENTAS DE ESTABLECIMIENTO, PRESENTAN LOS SIGUIENTES
ERRORES: Cuando existan detalles de Ventas debe exitir [sic] Ventas
Establecimiento." El elemento es opcional en el XSD (`minOccurs="0"`,
hermano de `<ventas>`) pero DIMM lo exige como regla de negocio en cuanto
hay al menos un `<detalleVentas>`.

**Fix** (`backend/routes/ats.js`): nueva función pura
`construirVentasEstablecimientoXML(items)` — un `<ventaEst>` por
establecimiento (`codEstab` + `ventasEstab` + `ivaComp`), agrupando
facturas + liquidaciones + notas de venta + notas de crédito por su
columna `establecimiento` (los 4 modelos ya la tienen como columna propia,
no hizo falta parsear el número de comprobante). Se omite el bloque
completo cuando no hay ventas en el período (igual que el XML de compras
del 09-09 que compartió el usuario, sin `<ventas>` real).

## Verificación

- 165/165 tests backend (2 nuevos en `ats.test.js`).
- **Validación completa contra el XSD oficial** (lxml, no solo
  bien-formado) con 2 escenarios reales vía HTTP+JWT: (a) 2 facturas
  autorizadas en 2 establecimientos distintos (001 y 003) → genera 2
  `<ventaEst>` correctos, XML válido; (b) período solo-compras sin ventas
  → `<ventasEstablecimiento>` se omite, también válido.

## Pendiente

- Falta que el usuario regenere el ATS de 2026-09 con este fix y confirme
  con DIMM mismo que el error de Ventas Establecimiento desaparece (no
  tengo el programa instalado, solo validación contra el XSD oficial).
- Las 2 advertencias (IVA 12%/15%, aviso de pago al exterior) seguirán
  apareciendo — es esperado, no bloquean el envío. Si DIMM las tratara
  alguna vez como bloqueantes, avisar para revisar de nuevo.

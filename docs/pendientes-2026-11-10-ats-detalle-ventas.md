# ATS: errores DIMM en el detalle de ventas — 2026-11-10

## Caso

Laboratorio San José (`labsanjose`), ATS de 2026-10. DIMM rechazó cada
`<detalleVentas>` con cédula (tpIdCliente 05) y tipoComprobante 01 con tres
errores:

1. "A partir del periodo junio-2016 debe indicar las formas de cobro".
2. "El CÓDIGO TIPO DE COMPROBANTE en Ventas [01] no es válido".
3. "No debe indicar el tipo de cliente cuando el tipo de identificación es 05".

No aparecieron en rondas anteriores porque en 2026-09 el tenant no tuvo
ventas en el detalle.

## Causa (verificada con Ficha Técnica ATS y XSD oficial)

- En ventas el tipo de comprobante sale de la Tabla 4 del ATS: factura y nota
  de venta son **18** ("Documentos autorizados utilizados en ventas excepto
  N/C N/D"). Se reportaba el código de comprobantes electrónicos (01/02).
- `tipoCliente` es condicional: solo con pasaporte (06), junto con `denoCli`.
  `parteRelVtas` solo con 04/05/06. Se emitían siempre.
- "Forma de cobro" (Tabla 13) es obligatoria en ventas, sin umbral de monto
  (el umbral de USD 500 es solo de compras). No se emitía.

## Corrección (`backend/routes/ats.js`)

- `tipoComprobanteVentaAts`: 01/02 → 18; NC sigue 04. Factura y nota de venta
  del mismo cliente se agrupan en una línea 18.
- `construirDetalleVentaXML`: `parteRelVtas` solo 04/05/06; `tipoCliente` y
  `denoCli` (limpio, alfanumérico) solo 06; `<formasDePago>` en tipo 18.
- `codigosFormaPagoVenta`: códigos de `pagos`/`formaPago` con el mismo
  `resolverFormaPago` del XML de la factura; 01 si no hay dato.

## Validación

- Backend: 204/204 pruebas (6 nuevas).
- XML de muestra con cédula, consumidor final, pasaporte y NC validado contra
  `ats.xsd` oficial con lxml: válido.
- Pendiente: que el cliente regenere el ATS 2026-10 y lo valide en DIMM.

## Observaciones abiertas

- Las liquidaciones de compra se agregan a ventas con tipo 03, que no es un
  código de ventas: son compras y deberían ir en `<detalleCompras>`. No
  afectó este caso; corregirlo requiere armar su bloque de compras.
- La ficha (resolución NAC-DGERCGC16-00000092) exime de registrar en el
  módulo de ventas los comprobantes electrónicos; AELA los reporta con
  `tipoEmision` E, que DIMM acepta. No se cambió ese criterio.

# Sesión 2026-10-17 — Factura rechazada por tarifa de IVA no vigente (SRI 52)

## Diagnóstico

La captura reporta recepción RECIBIDA y rechazo en autorización con identificador
52, ERROR EN DIFERENCIAS: código de porcentaje 2 del impuesto 2 no vigente para
la fecha 16/10/2026. Es un rechazo de contenido, no un fallo de conectividad:
el XML incluye IVA 12% (código 2).

El generador conoce correctamente la relación 12% → código 2 y 15% → código 4.
El problema es que Facturación y POS ofrecían 12% sin comprobar la fecha y podían
heredarlo del catálogo, proformas o carritos. El backend aceptaba esos detalles,
reservaba un secuencial, guardaba la venta y dejaba al SRI rechazarla después.
Reenviar utiliza el mismo XML, por lo que repetir el envío no corrige la tarifa.

La revisión del caso real confirmó que una de las 13 líneas heredó el 12% del
producto del catálogo. El cálculo del impuesto era automático: no era necesario
que el operador escogiera manualmente esa tarifa al facturar.

El 12% se conserva para documentos históricos anteriores al 01/04/2024.
Fuentes: [comunicado SRI sobre el cambio desde abril de 2024](https://www.sri.gob.ec/detalle-noticias?idnoticia=1028&marquesina=1)
y tabla 17 de la Ficha Técnica de comprobantes electrónicos del SRI.

## Plan e implementación

1. Validar la tarifa por fecha antes de reservar numeración o registrar efectos
   en inventario/caja: `backend/utils/ivaFactura.js`, invocado desde la ruta de
   creación y desde `generarXMLFactura` como protección adicional.
2. En Facturación y POS, compartir `SelectorIvaFactura` y las opciones por fecha:
   no ofrecer 12% desde el corte; si ya viene seleccionado, mostrarlo expresamente
   como no disponible y señalar el ítem. El usuario elige la tarifa correcta y
   revisa el nuevo total. No convertir tasas ni importes silenciosamente.
3. Rechazar también tarifas no soportadas, evitando que un código desconocido
   termine con IVA 0%. Eliminar el mapeo del formulario que convertía 14% a 12%.
4. En el detalle, explicar el problema de las facturas no autorizadas y ocultar
   Reenviar SRI cuando la tarifa es inválida. La API de reenvío también lo valida
   antes de consultar configuración, firmar, actualizar datos o llamar al SRI.
5. Mantener las importaciones históricas, las compras y las notas de crédito
   fuera de esta validación de facturas nuevas.

No requiere migraciones. La corrección operativa autorizada se detalla abajo.

## Verificación

- Backend: 172/172 tests aprobados (7 nuevos).
- Frontend: 31/31 tests aprobados (4 nuevos).
- Build de producción del frontend correcto.
- ESLint de todos los archivos frontend modificados/nuevos, sin incidencias.
- `git diff --check`, correcto.
- El lint general conserva los errores y advertencias previos de la revisión
  inicial, ajenos a este cambio (3 errores de hooks en Declaraciones y 20 warnings).

Las regresiones cubren la factura del 16/10/2026 con 12%, el límite
31/03/2024–01/04/2024, cabecera/detalle y totales de una factura actual al 15%,
tarifas desconocidas, preservación del impuesto histórico y el selector con un
12% antiguo seleccionado. Las pruebas de handlers usan una BD simulada y
verifican que la creación inválida no toca secuenciales ni movimientos y que el
reenvío inválido no avanza hacia el SRI (incluidos detalles JSON legados).

## Corrección operativa completada

- Se identificó la factura exacta de la captura en el tenant autorizado y se
  confirmó directamente en el SRI que seguía NO AUTORIZADA, con el error 52.
- Se guardaron respaldos locales antes y después, dentro de `backups/`, excluido
  de Git. No se incluyen credenciales, certificados ni datos de compradores en
  este documento o en el commit.
- Se corrigió únicamente el producto causante: tarifa de catálogo 12% → 15%,
  conservando su precio base, costo y stock.
- Se creó la factura de reemplazo con las mismas cantidades, precios base,
  comprador y fecha de la operación (16/10/2026). El SRI la AUTORIZÓ.
- Después de la autorización se anuló la factura rechazada mediante el endpoint
  normal de anulación local, sin emitir nota de crédito. Las escrituras usaron
  las APIs y transacciones existentes, con respaldo e idempotencia de la nueva
  factura; no se manipularon montos o inventario mediante SQL directo.
- Se verificaron 26 movimientos de inventario (13 de salida y 13 de reverso),
  con variación neta cero por producto respecto del inicio de la corrección.
  Caja conserva una sola venta neta con el importe corregido.
- El proceso local se limitó al tenant y documentos autorizados, sin iniciar el
  worker de otras facturas pendientes ni enviar correos adicionales.

## Despliegue

El código preventivo de backend/frontend se entrega con las pruebas en este
commit. Queda por comprobar el despliegue habitual del hosting después del push.
La corrección de los datos y la autorización de la nueva factura en producción
ya están completadas.

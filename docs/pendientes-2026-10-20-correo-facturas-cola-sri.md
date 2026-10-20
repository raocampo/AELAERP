# Correo de facturas por cola SRI — 2026-10-20

## Empresa y alcance

Caso confirmado por el usuario: RUC `1100646239001`, Ponce Calle Segundo
Genaro / El Rincón de la Catedral, empresa `7` del modo multiempresa de
`corpsimtelec` en la BD principal `railway`. La revisión preliminar de `sys`
documentada por separado no corresponde a esta empresa.

Se consultaron sus datos en una transacción de solo lectura y los logs del
servicio AELAERP en Railway. No se enviaron mensajes reales ni se modificaron
facturas, clientes, stock o importes de producción durante esta intervención.
Los respaldos y scripts de diagnóstico están en `backups/`, ignorado por Git;
las credenciales de correo consultadas se procesaron en memoria.

## Resultado de la revisión

En las facturas con fecha de emisión del 1 al 20 de octubre, al momento de la
consulta, se encontraron 477 autorizadas y de origen MANUAL:

- 13 tienen correo del comprador; coincide con el correo de su cliente vinculado.
- 464 no tienen correo: 463 de consumidor final y una con comprador identificado
  por RUC. Tampoco hay correo en los clientes vinculados de ese grupo.

La configuración SMTP/Resend es del servidor. El destinatario de cada factura
es `emailComprador`; `emailNotificaciones` de Configuración SRI no agrega una
copia automática para el emisor.

| Factura | Evidencia | Resultado comprobado |
| --- | --- | --- |
| 002-001-000000508 (ID 672) | `[ColaSRI] Factura #672 autorizada OK (reintento)` | La cola omitió el envío; el usuario confirma su ausencia en Resend. |
| 002-001-000000510 (ID 674) | `[ColaSRI] Factura #674 autorizada OK (reintento)` | La cola omitió el envío; el usuario confirma su ausencia en Resend. |
| 002-001-000000480 (ID 643) | `[ColaSRI] Factura #643 autorizada OK (reintento)` | Mismo camino sin llamada al correo en la versión desplegada. |
| 002-001-000000511 (ID 675) | Log `[email]` de éxito y captura Resend del usuario | Entregada según la captura. |
| 002-001-000000424 y 002-001-000000425 | Logs `[email]` de éxito del 15 de octubre | El transporte aceptó el envío; los logs no acreditan entrega al buzón. |
| Otras siete facturas con destinatario | No se recuperaron logs coincidentes en los despliegues consultados | Envío y entrega sin confirmar. |

Las variables de Resend y del respaldo SMTP están presentes en producción.
La consulta GET del historial de Resend respondió `401 restricted_api_key`:
la clave desplegada solo permite enviar. No se cambiaron sus permisos ni se
generaron nuevas claves. Esto limita la consulta del historial por API;
la captura del usuario sí acredita el estado mostrado para la 511.
Referencia: [List Sent Emails de Resend](https://resend.com/docs/api-reference/emails/list-emails).

## Causa y corrección

`utils/colaSRI.js` autorizaba facturas por dos caminos — consulta directa de un
XML ya firmado y reenvío con autorización posterior — sin llamar a
`enviarDocumentoFiscal`. Los logs de las tres facturas afectadas identifican
ese camino real; no se dedujo únicamente por el tiempo de autorización.

Además, la consulta de pendientes seleccionaba solo campos de control y XML.
El generador de RIDE usa los campos de la factura, no reconstruye comprador,
detalles e importes desde el XML, por lo que recibía información incompleta.

Cambios implementados:

- Ambos caminos de la cola envían el correo del comprador después de generar
  el PDF y guardar la autorización, con emisor y marca de su empresa.
- Se carga la factura completa para preparar el RIDE y el mensaje.
- El RIDE recibe el número y la fecha de autorización recién obtenidos, tanto
  en la cola como en el flujo normal.
- Las actualizaciones de esos flujos filtran por empresa, factura no anulada
  y estado distinto de AUTORIZADO. Solo el proceso que completa la transición
  ejecuta la notificación; un proceso atrasado no degrada una autorización.
- Un fallo de correo conserva el estado fiscal AUTORIZADO.

La corrección actúa cuando se autoriza una factura pendiente. No recorre ni
reenvía comprobantes que ya estaban autorizados antes de instalarla.

## Validación y pendientes

`npm test` en `backend`: **185/185 pruebas aprobadas**, incluidas 13 nuevas
para autorización directa, reenvío, firma pendiente, ausencia de destinatario,
error del proveedor, concurrencia, separación entre empresas y flujo normal.
SRI, correo y persistencia se simularon; las pruebas no contactan clientes reales.

Pendiente de recuperación: enviar los correos omitidos de las facturas 508,
510 y 480, usando los documentos ya autorizados y un RIDE completo. Esta
intervención no ejecuta ese envío a terceros. No hace falta volver a emitir
ni anular estos comprobantes para recuperar su correo.

Permanece pendiente registrar por factura el resultado del correo y el ID del
proveedor, junto con reintentos propios del correo. La protección por transición
fiscal evita duplicados de procesos concurrentes, pero no es una bandeja de
salida persistente ni acredita la entrega del mensaje.

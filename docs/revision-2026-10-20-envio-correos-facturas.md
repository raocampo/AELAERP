# Revisión 2026-10-20 — Correo de facturas

## Alcance y resultado

Consulta de solo lectura del tenant `sys` y revisión de los caminos de
autorización y envío. No se enviaron mensajes de prueba ni se reenviaron
comprobantes, ni se modificaron destinatarios o documentos de producción.

En el período del 1 al 20 de octubre hay 22 facturas autorizadas:

- 11 sin correo del comprador.
- 8 registradas con `no@mail.com`.
- 3 con otras direcciones de destinatario.

Tener una factura AUTORIZADA en el SRI no acredita que su correo se haya
enviado o entregado. Las tres facturas con otras direcciones requieren contrastar
los logs de producción y/o el historial del proveedor para confirmar el envío.
Los datos individuales de compradores se conservan solo en el respaldo local
ignorado por Git, no en este documento.

## Flujo de código comprobado

`routes/facturas.js`, después de la autorización normal, genera el RIDE y llama
`enviarDocumentoFiscal` únicamente si `factura.emailComprador` tiene contenido.

`utils/email.js` intenta Resend por HTTP y luego el respaldo SMTP. Un éxito o
error solo se escribe en consola; no se guarda el ID del proveedor ni un estado
de envío en la base de datos. La función captura sus errores y termina sin
propagarlos al llamador.

`utils/colaSRI.js`, en cambio, no llama a `enviarDocumentoFiscal` en ninguno de
los dos caminos de autorización de facturas: autorización directa del XML ya
firmado y reenvío con autorización posterior. Por ese camino el código deja la
factura autorizada sin intentar su envío por correo.

## Caso de la corrección anterior

La factura recreada el 17 de octubre durante la intervención autorizada fue
autorizada por el SRI, pero el proceso de corrección no envió correos adicionales.
Ese caso no sirve para acreditar el funcionamiento del envío automático normal.

## Verificación externa pendiente

La configuración local disponible no contiene la credencial de Resend ni el
respaldo SMTP; esto no demuestra que falten en Railway. No hay una sesión de
navegador conectada. Railway está disponible como integración, pero al cierre
de esta revisión no se confirmó su instalación/conexión.

Con acceso confirmado a Railway se pueden revisar los logs `[email]` y las
variables de producción sin enviar mensajes. Para acreditar entrega al servidor
destinatario, consultar también el historial y eventos de Resend.
Referencia: [API oficial para consultar correos enviados](https://resend.com/docs/api-reference/emails/list-emails).

## Siguientes acciones

1. Confirmar configuración y resultados reales del proveedor en producción.
2. Revisar los destinatarios vacíos o de relleno con el negocio.
3. Corregir y probar el envío en la cola SRI, contemplando deduplicación y
   registro de intentos/resultados; evitar un reenvío masivo de facturas antiguas.

Esta revisión no cambia el código de envío ni dispara nuevos mensajes.

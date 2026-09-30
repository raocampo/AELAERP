# Sesión 2026-09-29 — Buzón: reintento ante fallo transitorio del SRI + falso aviso "servicio caído"

## Reportado

Captura del usuario: importar compras desde un TXT del SRI (Buzón →
Importar TXT) mostraba 21 de 26 claves con "Error: Comprobante no
encontrado en el SRI" y el banner "⚠️ Servicio SRI no disponible", pese
a que "antes sí lo hacía".

## Diagnóstico (probado en vivo, no solo leído en código)

1. Probé directo contra el WS real de autorización del SRI (sin pasar
   por nuestro código), primero por error contra el host de **pruebas**
   (`celcer.sri.gob.ec` — confundí el host, no es el bug) y luego contra
   el de **producción** (`cel.sri.gob.ec`), con una clave real y
   autorizada (factura 001-001-000000023 del tenant `sys`, verificada
   como AUTORIZADA en la sesión del 09-07). Resultado: **HTTP 302 a una
   IP cruda** (`https://181.113.227.222`) — el mismo patrón de
   malfuncionamiento de infraestructura del SRI ya documentado y
   manejado en `soapRequest` desde `c5cc5a9`/`7d81ee3` (sesión 09-07).
   30 segundos después, la MISMA clave respondió bien. **Confirma que
   el problema es intermitente y externo (del SRI), no una regresión de
   nuestro código** — `sri.js` no fue tocado en los 25 commits que
   trajo el pull de hoy.
2. Pero el flujo de importación del Buzón (`obtenerXmlDesdeAutorizacion`
   en `utils/importacionProductos.js`) **no reintentaba**: ante un
   fallo transitorio en ambiente producción, caía directo a probar
   ambiente pruebas (que NUNCA va a encontrar un documento real) y
   reportaba "no encontrado" — perdiendo la clave aunque el SRI se
   hubiera recuperado segundos después. En un lote de 26-50 claves
   consultadas una por una, basta que el SRI tenga una racha de
   redirects para que la mayoría del lote falle así.
3. **Bug adicional encontrado en el camino**: el banner "Servicio SRI
   no disponible" en `GET /buzon/consultar` se decidía con una regex
   sobre el TEXTO del mensaje de error
   (`/sri|servicio|timeout|red|http|disponible/i`) — el mensaje
   genérico de "comprobante no encontrado" también contiene las
   palabras "SRI" y "disponible" de pura casualidad, así que el banner
   podía aparecer aunque el SRI hubiera respondido con total
   normalidad que el documento simplemente no existe (clave mal tipeada,
   factura de otro RUC, etc.) — confundiendo al usuario sobre si el
   problema es del SRI o de los datos que está importando.

## Fix (`utils/importacionProductos.js`, `routes/buzon.js`)

1. `_autorizarConReintento()`: ante un error clasificado como
   conectividad (`esErrorConectividad`, reusado de `colaSRI.js` — mismo
   criterio que ya usa la cola de envío de facturas), reintenta UNA vez
   el mismo ambiente tras 1.5s antes de darse por vencido con él. Solo
   agrega latencia cuando de verdad hay un fallo.
2. El error final que lanza `obtenerXmlDesdeAutorizacion` ahora lleva
   `esProblemaConectividadSri` (booleano explícito): `true` solo cuando
   NINGÚN ambiente devolvió jamás una respuesta real del SRI (ni
   encontrado, ni "no autorizado" — nada). `GET /buzon/consultar` usa
   esta marca (no una regex sobre texto) para decidir si muestra el
   banner de "servicio caído".

## Verificación

- 149/149 tests backend (3 nuevos: reintento exitoso, conectividad
  real agotada en ambos ambientes, y el caso que antes confundía al
  banner — producción cae por conectividad pero pruebas responde
  "NO_AUTORIZADO" real → ya no se marca como problema de conectividad).
- **Contra el SRI real** (no mocks): la clave real autorizada del
  09-07 resolvió correctamente 3 veces seguidas tras el fix.
- **HTTP end-to-end** con JWT real contra `POST /api/buzon/consultar`:
  clave real → `estado: 'nuevo'` con preview correcto (emisor, fecha,
  total); clave con forma válida pero secuencial inexistente →
  `estado: 'error'`, `conectividad: false`, `avisoSri: null` (ya no
  aparece el banner falso).

## Pendiente / salvedad

- El reintento es de 1 solo intento extra (no una cola con reintentos
  largos, a diferencia del envío de facturas que sí tiene cola). Si el
  SRI tiene una racha de caída más larga que unos segundos, seguirá
  fallando — mitiga el caso común (redirect puntual) observado hoy, no
  garantiza éxito ante una caída sostenida. Si el usuario sigue viendo
  fallos masivos después de este fix, revisar si conviene subir a 2
  reintentos o espaciar más el lote (`BATCH=50` en el frontend consulta
  secuencial, sin pausa entre lotes).
- No se tocó el mismo patrón de "reenviar" individual en
  `facturas.js`/`guiasRemision.js`/`liquidacionesCompra.js`/
  `notasDebito.js`/`retenciones.js` (llaman a
  `sri.autorizarComprobanteSRI` directo, sin el wrapper de reintento) —
  ahí el usuario ya tiene un botón "Reenviar" para reintentar a mano y
  el mensaje azul de "esto no es un rechazo real" (sesión 09-07), así
  que el impacto de no reintentar ahí es menor. Aplicar el mismo
  wrapper si se reporta como molesto.

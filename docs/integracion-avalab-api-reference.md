# API Integración AVALAB → AELA — Referencia técnica

Recepción de facturas, notas de crédito y cobros ya autorizados por el SRI.
Integración directa por HTTP: cada comprobante o cobro se envía por `POST`
en el momento en que AVALAB lo autoriza o registra.

> **Versión 1.1 (10/11/2026).** Novedades: `/pagos` acepta la clave de
> acceso o el número de factura y es idempotente con `idPagoExterno`;
> nuevos `GET /facturas`, `POST /facturas/verificar`, `POST /notas-credito`,
> `POST /facturas/anular`, `POST /pagos/anular`, `GET /bancos` y `GET /log`.
> Todo lo de la versión 1.0 sigue funcionando igual.

## Acciones requeridas a AVALAB

1. **Facturas que no llegan.** Al 10/11/2026 faltan en AELA 60 facturas
   del 20/10 al 06/11 ($5,477.22). Casi todas tienen algo en común: su
   fecha de "Actualización" en AVALAB es igual a la de emisión. De las
   facturas con actualización posterior llegaron 124 de 127; de las que no
   la tienen, faltan 28 de 30. Revisen el criterio con que el proceso de
   envío elige qué mandar: parece filtrar por fecha de actualización y se
   salta las que nunca se modifican. Recomendado: elegir por "autorizada por
   el SRI y no confirmada por AELA" (guardar el `id` que devuelve AELA, o
   usar `POST /facturas/verificar`).
2. **Reenviar las faltantes.** Reenviar todas las facturas desde el
   20/10/2026 con `POST /facturas` es seguro: AELA no duplica una
   `claveAcceso` ya registrada (responde `200` con la existente). Para
   reenviar solo lo necesario, consultar antes `POST /facturas/verificar`.
3. **Cobros.** AELA no ha recibido ningún cobro, por eso todas las facturas
   figuran pendientes de cobro. Enviar cada pago con `POST /pagos` usando
   `claveAcceso` y `idPagoExterno`, incluidos los ya cobrados desde el
   20/10/2026, con su fecha y forma de pago reales.
4. **Notas de crédito y anulaciones.** Enviar cada nota de crédito
   autorizada con `POST /notas-credito`. Si una factura se anula en el SRI,
   usar `POST /facturas/anular`. Las NC 001-002-000000094, 095 y 096
   modifican facturas que ya están en AELA o que deben reenviarse antes.

## Acceso

- **URL base**: `https://aelaerp-production.up.railway.app/api/ext/v1`
- **Autenticación**: header `X-API-Key: <key>` en cada request. No se
  necesita ningún otro header (usuario, contraseña, tenant, etc.).
- **Formato de la key**: `aela_` + 48 caracteres hexadecimales.
- **Cuerpo**: JSON (`Content-Type: application/json`).

## Flujo recomendado

1. `POST /clientes` (opcional) — crea o actualiza el cliente.
2. `POST /facturas` — al autorizarse la factura. **Idempotente por `claveAcceso`**.
3. `POST /pagos` — al registrarse cada cobro. **Idempotente por `idPagoExterno`**.
4. `POST /notas-credito` — al autorizarse una NC. **Idempotente por `claveAcceso`**.
5. Una vez al día: `POST /facturas/verificar` con las claves de acceso del
   día (o de los últimos días) y reenviar las que aparezcan en `faltantes`.

Ante un error de red o timeout, reintentar la misma llamada: los cuatro
envíos anteriores no duplican.

---

## `GET /status`

```json
{ "success": true, "tenant": "labsanjose", "empresa": "LABORATORIO SAN JOSÉ ...", "ruc": "0999999999001", "version": "1.1" }
```

## `POST /clientes`

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `identificacion` | string | ✅ | cédula, RUC o pasaporte |
| `razonSocial` | string | ✅ | |
| `tipoIdentificacion` | string | — | `04` RUC \| `05` Cédula \| `06` Pasaporte. Si se omite, se infiere por longitud (13→RUC, 10→Cédula, otro→Pasaporte) |
| `email` | string | — | |
| `telefono` | string | — | |
| `direccion` | string | — | |

`201`: `{ "success": true, "data": { "id": 123, "identificacion": "0102030405" } }`

Si el cliente ya existe, solo actualiza `razonSocial`/`email`/`telefono`/
`direccion` — **no** cambia `tipoIdentificacion` una vez creado.

## `POST /facturas`

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `claveAcceso` | string(49) | ✅ | clave de acceso SRI — **llave de idempotencia** |
| `numeroAutorizacion` | string | — | si difiere de `claveAcceso` |
| `numeroFactura` | string | ✅ | `"001-002-000011201"` |
| `fechaEmision` | string (ISO) | ✅ | `"2026-10-20"` o con hora |
| `clienteIdentificacion` | string | ✅ | |
| `clienteRazonSocial` | string | ✅ | |
| `clienteTipoIdentificacion` | string | — | igual que en `/clientes` |
| `clienteEmail` | string | — | |
| `items` | array | ✅ | no puede estar vacío |
| `observaciones` | string | — | |

Cada `items[]` (mismo formato en `/notas-credito`):

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `descripcion` | string | — | default `"Servicio"` |
| `cantidad` | number | — | default `1` |
| `precioUnitario` | number | — | sin IVA, default `0` |
| `descuento` | number | — | valor (no %), default `0` |
| `ivaPorcentaje` | number | — | **solo `0`, `5` o `15`** — otro valor cae a `15` |
| `codigoSri` | string | — | código principal del ítem |

```json
{
  "claveAcceso": "2010202601110000000000120010020000112011234567811",
  "numeroFactura": "001-002-000011201",
  "fechaEmision": "2026-10-20T07:21:16-05:00",
  "clienteIdentificacion": "0102030405",
  "clienteRazonSocial": "JUAN PEREZ",
  "items": [
    { "descripcion": "Biometría hemática", "cantidad": 1, "precioUnitario": 12.00, "ivaPorcentaje": 0 }
  ]
}
```
`201` (creada): `{ "success": true, "data": { "id": 456, "numeroFactura": "001-002-000011201", "importeTotal": 12.00, "estadoSri": "AUTORIZADO", "fechaEmision": "...", "asientoOk": true } }`

`200` (ya existía): misma forma, con `"mensaje": "Ya existía, se devuelve la factura registrada"`.

Guardar `data.id`: es el `facturaId` de AELA. También se puede seguir
usando la `claveAcceso` en las demás llamadas.

## `GET /facturas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`

Facturas registradas en AELA por fecha de emisión (máximo 92 días; `hasta`
por defecto es hoy).

```json
{ "success": true, "total": 2, "data": [
  { "id": 456, "claveAcceso": "...", "numeroFactura": "001-002-000011201", "fechaEmision": "...", "importeTotal": "12", "anulada": false, "origenRegistro": "WEBSERVICE" }
] }
```

## `POST /facturas/verificar`

Indica cuáles claves de acceso ya están en AELA y cuáles faltan (máximo
1000 por llamada).

```json
{ "clavesAcceso": ["2010202601...", "2010202601..."] }
```
```json
{ "success": true,
  "registradas": [ { "id": 456, "claveAcceso": "...", "numeroFactura": "001-002-000011201", "importeTotal": "12", "anulada": false } ],
  "faltantes": ["2010202601..."] }
```

## `GET /facturas/:id`

`:id` = el `id` de AELA **o** la clave de acceso de 49 dígitos.

```json
{ "success": true, "data": {
  "id": 456, "claveAcceso": "...", "numeroFactura": "001-002-000011201", "fechaEmision": "...",
  "importeTotal": "12", "estadoSri": "AUTORIZADO", "anulada": false, "origenRegistro": "WEBSERVICE",
  "totalCobrado": 12, "totalNotasCredito": 0, "saldo": 0,
  "cobros": [ { "id": 789, "numero": "REC-202610-0001", "fecha": "...", "monto": "12", "metodoPago": "efectivo", "referencia": null, "idExterno": "PAGO-5531", "anulado": false } ]
} }
```

## `POST /pagos`

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `claveAcceso` | string(49) | uno de los tres | clave de acceso de la factura (**recomendado**) |
| `facturaId` | number | uno de los tres | el `id` que devolvió `POST /facturas` |
| `numeroFactura` | string | uno de los tres | `"001-002-000011201"` |
| `monto` | number | ✅ | > 0, no puede exceder el saldo (total − cobros − NC) |
| `metodoPago` | string | ✅ | `"efectivo"` \| `"transferencia"` \| `"cheque"` \| `"tarjeta"` |
| `fecha` | string (ISO) | — | fecha real del cobro; default: ahora |
| `idPagoExterno` | string | — (**muy recomendado**) | id único del pago en AVALAB, máx. 100 caracteres. **Llave de idempotencia** |
| `referencia` | string | — | nº de comprobante/transferencia/voucher |
| `bancoId` | number | — | cuenta destino de transferencia/tarjeta/cheque (ver `GET /bancos`). Si se omite: la cuenta por defecto configurada en AELA o, si hay una sola, esa |

```json
{ "claveAcceso": "2010202601...", "monto": 12.00, "metodoPago": "transferencia",
  "fecha": "2026-10-20T07:30:00-05:00", "idPagoExterno": "PAGO-5531", "referencia": "TRF-00123" }
```
`201` (creado): `{ "success": true, "data": { "id": 789, "numero": "REC-202610-0001", "monto": "12", "facturaId": 456, "bancoId": 3 } }`

`200` (ya existía ese `idPagoExterno`): `{ "success": true, "data": { ... }, "mensaje": "Ya existía, se devuelve el cobro registrado" }`

Varios pagos sobre la misma factura = cobros parciales, cada uno con su
propio `idPagoExterno`. **Sin `idPagoExterno` la llamada no es
idempotente**: reintentar tras un timeout puede duplicar el cobro.

Errores propios: `404` si la factura aún no está en AELA (enviarla primero
con `POST /facturas`), `400` si el monto excede el saldo o la factura está
anulada.

## `POST /pagos/anular`

```json
{ "idPagoExterno": "PAGO-5531", "motivo": "Pago revertido" }
```
También acepta `{ "id": 789 }`. Reversa el asiento y el movimiento en
bancos. Repetirlo responde `200` con `"Ya estaba anulado"`.

## `GET /bancos`

```json
{ "success": true, "bancoPorDefecto": 3, "data": [
  { "id": 3, "nombre": "Pichincha Cta Cte", "banco": "Banco Pichincha", "tipoCuenta": "CORRIENTE", "numeroCuenta": "2100..." }
] }
```

## `POST /notas-credito`

Nota de crédito **ya autorizada por el SRI** que modifica una factura que
ya está en AELA. Reduce el saldo por cobrar de esa factura.

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `claveAcceso` | string(49) | ✅ | clave de acceso de la NC — **llave de idempotencia** |
| `numeroNotaCredito` | string | ✅ | `"001-002-000000094"` |
| `fechaEmision` | string (ISO) | ✅ | |
| `motivo` | string | ✅ | motivo de la modificación |
| `facturaClaveAcceso` / `facturaId` / `numeroFacturaAfectada` | | uno ✅ | factura modificada |
| `items` | array | ✅ | mismo formato que en `/facturas`; el total no puede superar lo no acreditado de la factura |
| `numeroAutorizacion` | string | — | si difiere de `claveAcceso` |

```json
{ "claveAcceso": "2110202604...", "numeroNotaCredito": "001-002-000000094",
  "fechaEmision": "2026-10-21T08:10:12-05:00", "motivo": "Corrección de datos del paciente",
  "facturaClaveAcceso": "2010202601...",
  "items": [ { "descripcion": "Perfil lipídico", "cantidad": 1, "precioUnitario": 124.00, "ivaPorcentaje": 0 } ] }
```
`201`: `{ "success": true, "data": { "id": 12, "numeroNC": "001-002-000000094", "importeTotal": "124", "facturaId": 456, "estadoSri": "AUTORIZADO", "asientoOk": true } }`

Si la factura modificada ya estaba cobrada, primero anular el cobro
(`POST /pagos/anular`) o la NC deja un saldo a favor del cliente. La
factura que reemplaza a la corregida se envía como cualquier otra, con
`POST /facturas`.

## `POST /facturas/anular`

Solo para facturas **anuladas en el SRI**. Una corrección con nota de
crédito va por `POST /notas-credito`.

```json
{ "claveAcceso": "2010202601...", "motivo": "Anulada en el portal del SRI" }
```
Acepta también `facturaId` o `numeroFactura`. Responde `409` con la lista
de `cobros` si la factura tiene cobros vigentes: anularlos antes con
`POST /pagos/anular`. Repetirlo responde `200` con `"Ya estaba anulada"`.

## `GET /log?soloErrores=1&referencia=<clave o idPagoExterno>&limite=100`

Bitácora de las llamadas `POST` recibidas por AELA (más recientes
primero): ruta, código de respuesta, clave/id del comprobante y mensaje de
error. Sirve para comprobar si un envío llegó y por qué falló.

```json
{ "success": true, "data": [
  { "id": 51, "createdAt": "...", "metodo": "POST", "ruta": "/api/ext/v1/pagos", "status": 404, "referencia": "2010202601...", "error": "Factura no encontrada (envíela primero con POST /facturas)", "duracionMs": 35 }
] }
```

---

## Errores

`{ "success": false, "error": "mensaje" }` en todos los casos.

| Código | Causa típica |
|---|---|
| `400` | falta un campo requerido, número con formato inválido, monto excede el saldo, `metodoPago` no reconocido, factura anulada |
| `401` | falta `X-API-Key` o la key es inválida/revocada |
| `404` | la factura, NC o cobro no existe en AELA |
| `409` | dos requests simultáneos con la misma llave (reintentar: devuelve el existente), o factura con cobros al anular |
| `500` | error interno — reportar con la `claveAcceso` o `idPagoExterno` involucrado |

## Prueba rápida

```bash
curl https://aelaerp-production.up.railway.app/api/ext/v1/status \
  -H "X-API-Key: aela_<clave>"
```

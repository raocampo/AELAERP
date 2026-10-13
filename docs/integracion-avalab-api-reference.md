# API Integración AVALAB → AELA — Referencia técnica

Recepción de facturas y pagos ya autorizados por el SRI. Integración
directa por HTTP, sin archivos intermedios: cada factura/pago se envía
por `POST` en el momento en que AVALAB lo autoriza/registra.

## Acceso

- **URL base**: `https://aelaerp-production.up.railway.app/api/ext/v1`
- **Autenticación**: header `X-API-Key: <key>` en cada request. No se
  necesita ningún otro header (usuario, contraseña, tenant, etc.).
- **Formato de la key**: `aela_` + 48 caracteres hexadecimales.

## Flujo por factura

1. `POST /clientes` (opcional, recomendado) — crea/actualiza el cliente.
2. `POST /facturas` — registra la factura. **Idempotente por `claveAcceso`**.
3. `POST /pagos` — registra el cobro contra esa factura, cuando ocurra.

`GET /status` para probar la key. `GET /facturas/:id` para confirmar estado.

---

## `GET /status`

```
GET /api/ext/v1/status
X-API-Key: aela_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
```json
{ "success": true, "tenant": "labsanjose", "empresa": "LABORATORIO SAN JOSÉ ...", "ruc": "0999999999001", "version": "1.0" }
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

```json
{ "identificacion": "0102030405", "razonSocial": "JUAN PEREZ", "email": "juan@correo.com" }
```
`201`: `{ "success": true, "data": { "id": 123, "identificacion": "0102030405" } }`

Si el cliente ya existe, solo actualiza `razonSocial`/`email`/`telefono`/
`direccion` — **no** cambia `tipoIdentificacion` una vez creado.

## `POST /facturas`

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `claveAcceso` | string(49) | ✅ | clave de acceso SRI — **llave de idempotencia** |
| `numeroAutorizacion` | string | — | si difiere de `claveAcceso` |
| `numeroFactura` | string | ✅ | `"001-001-000012345"` |
| `fechaEmision` | string (ISO) | ✅ | `"2026-07-27"` o con hora |
| `clienteIdentificacion` | string | ✅ | |
| `clienteRazonSocial` | string | ✅ | |
| `clienteTipoIdentificacion` | string | — | igual que en `/clientes` |
| `clienteEmail` | string | — | |
| `items` | array | ✅ | no puede estar vacío |
| `observaciones` | string | — | |

Cada `items[]`:

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `descripcion` | string | — | default `"Servicio"` |
| `cantidad` | number | — | default `1` |
| `precioUnitario` | number | — | default `0` |
| `descuento` | number | — | default `0` |
| `ivaPorcentaje` | number | — | **solo `0`, `5` o `15`** — otro valor cae a `15` |
| `codigoSri` | string | — | código principal del ítem |

```json
{
  "claveAcceso": "2707202601099999999000110010010000000011234567891",
  "numeroFactura": "001-001-000012345",
  "fechaEmision": "2026-07-27",
  "clienteIdentificacion": "0102030405",
  "clienteRazonSocial": "JUAN PEREZ",
  "clienteEmail": "juan@correo.com",
  "items": [
    { "descripcion": "Examen de sangre", "cantidad": 1, "precioUnitario": 25.00, "ivaPorcentaje": 15 }
  ]
}
```
`201`: `{ "success": true, "data": { "id": 456, "numeroFactura": "001-001-000012345", "importeTotal": 28.75, "estadoSri": "AUTORIZADO", "fechaEmision": "...", "asientoOk": true } }`

`asientoOk: false` = factura guardada pero el asiento contable falló al
generarse (no bloquea el registro, se puede regenerar desde AELA).

Reintento con el mismo `claveAcceso` → responde `200` (no `201`) con la
factura ya existente, sin duplicar.

## `GET /facturas/:id`

```json
{ "success": true, "data": { "id": 456, "numeroFactura": "001-001-000012345", "fechaEmision": "...", "importeTotal": 28.75, "estadoSri": "AUTORIZADO", "anulada": false, "origenRegistro": "WEBSERVICE" } }
```

## `POST /pagos`

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `facturaId` | number | ✅ | el `id` que devolvió `POST /facturas`, no `numeroFactura` |
| `monto` | number | ✅ | > 0, no puede exceder el saldo pendiente |
| `metodoPago` | string | ✅ | `"efectivo"` \| `"transferencia"` \| `"cheque"` \| `"tarjeta"` |
| `referencia` | string | — | nº de comprobante/transferencia |
| `fecha` | string (ISO) | — | default: ahora |

```json
{ "facturaId": 456, "monto": 28.75, "metodoPago": "transferencia", "referencia": "TRF-00123" }
```
`201`: `{ "success": true, "data": { "id": 789, "numero": "REC-202607-0001", "monto": 28.75 } }`

Se puede llamar varias veces sobre la misma factura (cobros parciales) —
rechaza (`400`) si la suma excede el total.

⚠️ **`/pagos` NO es idempotente** (a diferencia de `/facturas`) — no tiene
llave de deduplicación. Si reintentan tras un timeout sin confirmar si el
primer intento llegó, el cobro puede quedar duplicado (mientras la suma no
exceda el total, AELA no puede detectarlo). Antes de reintentar: llamar
`GET /facturas/:id` para revisar el saldo, o llevar su propio control de
qué cobros ya se enviaron con éxito.

---

## Errores

`{ "success": false, "error": "mensaje" }` en todos los casos.

| Código | Causa típica |
|---|---|
| `400` | falta un campo requerido, `numeroFactura` con formato inválido, `monto` excede el saldo, `metodoPago` no reconocido |
| `401` | falta `X-API-Key` o la key es inválida/revocada |
| `404` | `facturaId`/`id` no existe |
| `409` | dos requests simultáneos con el mismo `claveAcceso` (reintentar: el segundo intento normal ya devuelve `200`) |
| `500` | error interno — reportar con el `claveAcceso` o `facturaId` involucrado |

## Prueba rápida

```bash
curl https://aelaerp-production.up.railway.app/api/ext/v1/status \
  -H "X-API-Key: aela_<clave>"
```

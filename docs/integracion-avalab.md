# Integración AELA ↔ AVALAB — Laboratorio San José

## Contexto

AVALAB es el sistema propio del **Laboratorio San José** para facturación
electrónica — AVALAB ya genera, firma y autoriza sus facturas ante el SRI de
punta a punta. **AELA no va a facturar nada de este cliente.** El único rol
de AELA es llevar la contabilidad, declaraciones y bancos del laboratorio
usando la información de las facturas que AVALAB ya emitió y autorizó.

Por eso el flujo es "importar", no "emitir": AVALAB manda a AELA los datos
de cada factura ya autorizada y de cada cobro, y AELA solo los registra
(genera el asiento contable automáticamente) — nunca los reenvía al SRI.

Esta integración ya existe en el código (`backend/routes/external.js`,
`/api/ext/v1/*`) desde julio, pero **nunca se ha probado con una llamada
real desde un sistema externo** — este documento es lo que hay que compartir
con el equipo de AVALAB para hacer esa primera prueba.

---

## 0. Cómo llega la información (mecánica, no un archivo)

No hay una bandeja donde AVALAB deja un archivo, ni un JSON que le manda por
correo a alguien en AELA para que lo cargue a mano. La integración es
directa entre los dos sistemas: **el software de AVALAB hace la llamada.**
Cada vez que autorizan una factura (o registran un cobro), su propio sistema
envía esos datos, en el momento, directo al servidor de AELA por HTTP —
sin que nadie de ningún lado intervenga a mano:

1. El sistema de AVALAB arma el JSON con los datos de la factura recién
   autorizada.
2. Lo envía por `POST` HTTP directo al servidor de AELA (`X-API-Key` en el
   header, JSON en el body — una petición normal, no distinta de la que
   hace cualquier app al usar internet).
3. AELA responde al instante: si los datos están correctos, la factura ya
   quedó guardada y contabilizada antes de que termine esa misma petición.

En la práctica esto requiere que alguien del equipo de desarrollo de AVALAB
agregue una llamada HTTP más en el punto donde ya autorizan la factura ante
el SRI — no hace falta ninguna herramienta especial, cualquier lenguaje
moderno (PHP, Java, .NET, Python, Node, etc.) hace peticiones HTTP con
cuerpo JSON de forma nativa o con una librería estándar. Ejemplo mínimo
(solo para ilustrar la forma de la llamada — en el sistema real esto lo
hace su código, no una terminal):

```bash
curl -X POST https://aelaerp-production.up.railway.app/api/ext/v1/facturas \
  -H "X-API-Key: aela_<clave>" \
  -H "Content-Type: application/json" \
  -d '{
    "claveAcceso": "2707202601099999999000110010010000000011234567891",
    "numeroFactura": "001-001-000012345",
    "fechaEmision": "2026-07-27",
    "clienteIdentificacion": "0102030405",
    "clienteRazonSocial": "JUAN PEREZ",
    "items": [{ "descripcion": "Examen de sangre", "cantidad": 1, "precioUnitario": 25.00, "ivaPorcentaje": 15 }]
  }'
```

Una vez conectada esa llamada al flujo de facturación de AVALAB, cada
factura nueva llega sola, en tiempo real, el mismo momento en que se
autoriza — no hay paso manual de ningún lado.

---

## 1. Acceso

- **URL base**: `https://aelaerp-production.up.railway.app/api/ext/v1`
- **Autenticación**: header `X-API-Key: <key>` en cada request. No hace
  falta ningún otro header (la key ya identifica al tenant — el laboratorio
  San José — no hace falta mandar usuario/contraseña ni `X-Tenant-Slug`).
- **Cómo se obtiene la key**: la genera AELA desde el Panel SuperAdmin
  (busca el tenant del Laboratorio San José → botón "Generar API key para
  WebService"). Se ve **una sola vez** al generarla — hay que guardarla en
  ese momento. Compártela con AVALAB por un canal privado (no por email
  plano ni chat público).
- Formato de la key: `aela_` + 48 caracteres hexadecimales.
- **Alcance de la key**: la key identifica al tenant (Laboratorio San José)
  completo, no a una empresa específica dentro de él. Como el tenant del
  laboratorio está configurado como **monoempresa** (una sola razón
  social/RUC), esto no representa ningún problema hoy — toda la
  integración opera siempre sobre esa única empresa. Si en el futuro este
  tenant pasara a manejar más de una empresa (multiempresa), la API
  tendría que actualizarse primero para poder elegir con cuál trabajar;
  avisar a AELA antes de hacer ese cambio de configuración.

## 2. Flujo recomendado

Por cada factura que AVALAB autoriza:

1. `POST /clientes` (opcional pero recomendado) — crea o actualiza el
   cliente antes de la factura, así el nombre/email quedan siempre
   sincronizados aunque la factura no cambie.
2. `POST /facturas` — registra la factura ya autorizada. Es **idempotente**
   por `claveAcceso`: si AVALAB reintenta el mismo POST (ej. por timeout de
   red), AELA no la duplica, devuelve la que ya existe.
3. Cuando el cliente paga (puede ser el mismo día o después): `POST /pagos`
   — registra el cobro contra esa factura.

`GET /status` sirve para probar la key sin efectos secundarios, y
`GET /facturas/:id` para confirmar el estado de una factura ya registrada.

---

## 3. Endpoints

### `GET /status`
Health check — confirma que la key es válida.

```
GET /api/ext/v1/status
X-API-Key: aela_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
```json
{ "success": true, "tenant": "labsanjose", "empresa": "LABORATORIO SAN JOSÉ ...", "ruc": "0999999999001", "version": "1.0" }
```

### `POST /clientes`
Crea o actualiza un cliente (paciente/empresa) por identificación.

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `identificacion` | string | ✅ | cédula, RUC o pasaporte |
| `razonSocial` | string | ✅ | nombre completo o razón social |
| `tipoIdentificacion` | string | — | código SRI `04` RUC \| `05` Cédula \| `06` Pasaporte. Si se omite, se infiere por la longitud (13→RUC, 10→Cédula, otro→Pasaporte) |
| `email` | string | — | |
| `telefono` | string | — | |
| `direccion` | string | — | |

```json
{ "identificacion": "0102030405", "razonSocial": "JUAN PEREZ", "email": "juan@correo.com" }
```
Respuesta `201`: `{ "success": true, "data": { "id": 123, "identificacion": "0102030405" } }`

⚠️ Si el cliente ya existe, este endpoint solo actualiza
`razonSocial`/`email`/`telefono`/`direccion` — **no** actualiza
`tipoIdentificacion` una vez creado (correcciones ahí se hacen desde AELA).

### `POST /facturas`
Registra una factura ya autorizada por el SRI.

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `claveAcceso` | string(49) | ✅ | clave de acceso SRI — **llave de idempotencia** |
| `numeroAutorizacion` | string | — | si difiere de `claveAcceso` (normalmente son iguales) |
| `numeroFactura` | string | ✅ | formato `"001-001-000012345"` — establecimiento-puntoEmisión-secuencial |
| `fechaEmision` | string (ISO) | ✅ | `"2026-07-27"` o `"2026-07-27T10:30:00"` |
| `clienteIdentificacion` | string | ✅ | |
| `clienteRazonSocial` | string | ✅ | |
| `clienteTipoIdentificacion` | string | — | igual que en `/clientes` |
| `clienteEmail` | string | — | |
| `items` | array | ✅ | ver abajo, no puede estar vacío |
| `observaciones` | string | — | |

Cada elemento de `items`:

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `descripcion` | string | — | default `"Servicio"` |
| `cantidad` | number | — | default `1` |
| `precioUnitario` | number | — | default `0` |
| `descuento` | number | — | default `0` |
| `ivaPorcentaje` | number | — | **solo `0`, `5` o `15`** — cualquier otro valor cae a `15` por default |
| `codigoSri` | string | — | código principal del ítem, opcional |

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
Respuesta `201`: `{ "success": true, "data": { "id": 456, "numeroFactura": "001-001-000012345", "importeTotal": 28.75, "estadoSri": "AUTORIZADO", "fechaEmision": "...", "asientoOk": true } }`

`asientoOk: false` significa que la factura se guardó pero el asiento
contable falló al generarse automáticamente (caso raro — se puede regenerar
después desde AELA, no bloquea el registro).

Si se reintenta el mismo `claveAcceso`: responde `200` (no `201`) con la
factura ya existente, sin duplicar.

### `GET /facturas/:id`
```json
{ "success": true, "data": { "id": 456, "numeroFactura": "001-001-000012345", "fechaEmision": "...", "importeTotal": 28.75, "estadoSri": "AUTORIZADO", "anulada": false, "origenRegistro": "WEBSERVICE" } }
```

### `POST /pagos`
Registra un cobro sobre una factura ya registrada.

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `facturaId` | number | ✅ | el `id` que devolvió `POST /facturas` (no el `numeroFactura`) |
| `monto` | number | ✅ | debe ser > 0 y no puede exceder el saldo pendiente de la factura |
| `metodoPago` | string | ✅ | `"efectivo"` \| `"transferencia"` \| `"cheque"` \| `"tarjeta"` |
| `referencia` | string | — | nº de comprobante/transferencia |
| `fecha` | string (ISO) | — | default: ahora |

```json
{ "facturaId": 456, "monto": 28.75, "metodoPago": "transferencia", "referencia": "TRF-00123" }
```
Respuesta `201`: `{ "success": true, "data": { "id": 789, "numero": "REC-202607-0001", "monto": 28.75 } }`

Se puede llamar varias veces sobre la misma factura para cobros parciales —
rechaza (`400`) si la suma excede el total de la factura.

⚠️ A diferencia de `/facturas`, **este endpoint no es idempotente** — no
tiene una llave de deduplicación. Si AVALAB reintenta un `POST /pagos` tras
un timeout de red sin haber confirmado si el primer intento sí llegó,
puede registrarse el cobro dos veces (mientras la suma no exceda el total
de la factura, AELA no tiene forma de saber que es un duplicado). Antes de
reintentar, conviene que AVALAB llame `GET /facturas/:id` para revisar el
saldo, o que lleve su propio control de qué cobros ya envió con éxito.

---

## 4. Errores

Todas las respuestas de error tienen la forma `{ "success": false, "error": "mensaje" }`.

| Código | Causa típica |
|---|---|
| `400` | falta un campo requerido, `numeroFactura` con formato inválido, `monto` excede el saldo, `metodoPago` no reconocido |
| `401` | falta `X-API-Key` o la key es inválida/revocada |
| `404` | `facturaId`/`id` no existe |
| `409` | caso raro: dos requests simultáneos con el mismo `claveAcceso` (el reintento normal ya se maneja arriba devolviendo `200`) |
| `500` | error interno — reportar a AELA con el `claveAcceso` o `facturaId` involucrado |

---

## 5. Plan de pruebas sugerido

1. AELA genera la API key de prueba desde SuperAdmin y se la comparte a AVALAB.
2. AVALAB llama `GET /status` — confirma que la key es válida.
3. AVALAB llama `POST /clientes` con un cliente de prueba.
4. AVALAB llama `POST /facturas` con una factura real ya autorizada (puede
   ser una ya emitida, no hace falta que sea nueva) — confirmar que
   `asientoOk: true`.
5. Desde AELA (navegador): confirmar que la factura aparece en
   Facturación → Facturas, y el asiento en Contabilidad → Libro Diario.
6. AVALAB llama `POST /pagos` sobre esa factura — confirmar en AELA que
   aparece en Cuentas por Cobrar → Canceladas (o con el saldo correcto si
   fue parcial).
7. Repetir el mismo `POST /facturas` del paso 4 (mismo `claveAcceso`) —
   confirmar que responde `200` sin duplicar.

No hace falta un ambiente de pruebas separado — se puede usar el tenant real
del Laboratorio San José con datos reales desde el día 1, gracias a la
idempotencia por `claveAcceso`.

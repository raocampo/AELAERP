# AELA ERP — Sesión 2026-08-24 (parte 4) — Correcciones en producción real

## Contexto

A diferencia de las partes 1-3 de hoy (features nuevas en el repo), esta
parte cubre 3 pedidos del usuario que requirieron tocar **datos y
comprobantes reales en producción** (Railway), en 2 tenants distintos.

## 1. Deportivo Cat (RUC 1103590533001) — facturas emitidas por error

**Pedido**: empresa dentro del modo multiempresa de `corpsimtelec`
(empresaId=4, `railway`/BD principal) que solo debe facturar por nota de
venta (RIMPE Negocio Popular) — 9 facturas se emitieron por error en vez
de nota de venta.

**Diagnóstico**: las 9 facturas (ids 27-35, 21-24 ago) estaban todas en
`PENDIENTE_FIRMA` — la empresa no tiene certificado digital cargado, así
que ninguna llegó a transmitirse al SRI. Esto simplificó la corrección:
sin autorización SRI de por medio, no hace falta Nota de Crédito.

**Corrección**:
1. Las 9 facturas se anularon con el endpoint existente
   `POST /facturas/:id/anular` (reversa automática de inventario/caja/
   contabilidad, sin contactar al SRI).
2. Se crearon 9 notas de venta equivalentes (mismo cliente, productos,
   fecha). **Hallazgo en el camino**: `notas_venta` no separa IVA — el
   patrón ya usado por este negocio (notas 3/4/5 preexistentes) es que
   `precioUnitario` sea el precio final que paga el cliente, no el precio
   antes de impuesto. El primer intento de recreación copió el
   `precioUnitario` de las facturas (sin IVA) y generó notas con el
   total equivocado (~13% menos de lo cobrado real) — se detectó
   comparando contra el patrón de las notas ya existentes, se anularon
   esas 3 primeras notas mal calculadas y se recrearon con el precio
   ajustado (`precioUnitario × 1.15`), quedando el total dentro de 1-2
   centavos del original (redondeo esperado).
3. `configuracion_sri.contribuyenteRimpe`/`negocioPopular` marcados
   `true` (confirmado por el usuario que sí es Negocio Popular real).
4. `configuracion_sistema.documentoPosDefault` cambiado a `nota_venta`.

**Nota técnica**: la conexión desde este entorno de desarrollo hacia la
BD de Railway (proxy público, no interno) tiene latencia suficiente para
que las transacciones con muchos ítems (`$transaction` de Prisma, límite
por defecto 5000ms) fallen con "Transaction not found". Se aumentó el
timeout temporalmente (`{ timeout: 20000-60000 }`) solo en la copia local
usada para ejecutar las correcciones, y se revirtió a la versión original
del repo al terminar — no es un problema real de producción (el propio
backend en Railway corre en la misma red que la BD, sin esta latencia).

## 2. "Consultar SRI" no marcaba los checkboxes + automatización Negocio Popular

**Pedido del usuario** (con captura de pantalla): al dar clic en
"Consultar SRI" en la configuración de Deportivo Cat, el toast decía
"Datos actualizados" pero ningún checkbox (RIMPE, Negocio Popular, etc.)
se marcaba en pantalla. Además: al marcar "Negocio Popular" a mano, el
POS debería cambiar automáticamente su documento predeterminado a nota
de venta.

**Causa raíz encontrada**: el catastro local (`contribuyentes_sri`,
importado de CSVs abiertos del SRI) codifica el "tipo de contribuyente"
con abreviaturas — el valor real para Deportivo Cat es `"RMP"`, no la
palabra `"rimpe"`. El código comparaba
`claseContribuyente.toLowerCase().includes('rimpe')`, que nunca
coincidía contra `"rmp"`. Además, "Negocio Popular" específicamente NO
tiene ninguna señal propia en este catálogo (valores distintos
observados en toda la tabla: `ACTIVO, GEN, PASIVO, PICHINCHA, RMP, SIM,
SUSPENDIDO` — una mezcla de estado/provincia/clase que sugiere un
problema de calidad de datos más amplio en el importador del CSV, no
investigado a fondo hoy — posible seguimiento futuro).

**Corrección**:
- `backend/utils/sriContribuyente.js` (`consultarCatastroLocal`):
  reconoce `"RMP"` como RIMPE. `negocioPopular` ya no se fuerza a
  `false` — se omite del resultado cuando no es determinable.
- `frontend/.../ConfiguracionSRI.jsx` (`consultarSri`): solo sobreescribe
  un checkbox si el campo viene presente en la respuesta (antes,
  `Boolean(undefined)` desmarcaba por error cualquier campo no
  determinado, incluso si el usuario ya lo había marcado a mano).
- `backend/routes/facturas.js` (`PUT /configuracion`): al guardar con
  `negocioPopular: true`, actualiza automáticamente
  `configuracion_sistema.documentoPosDefault` a `'nota_venta'` para esa
  empresa — conecta exactamente el flujo que causó el problema original
  de Deportivo Cat.

## 3. Factura rechazada por SRI — tenant "sys" (RUC 1105863839001)

**Pedido del usuario** (con captura de pantalla): factura
001-001-000000013 rechazada por el SRI con error 35 "ARCHIVO NO CUMPLE
ESTRUCTURA XML" — `codigoPrincipal` con un valor inválido.

**Diagnóstico**: el mismo bug que ya se había corregido para
`<descripcion>` en una sesión anterior (código de barras con un `\r\n`
embebido, típico de una celda de Excel envuelta con Alt+Enter) — pero
nunca se aplicó a `codigoPrincipal`. El código real en la BD:
`"899900269\r\n6514"` (13 dígitos válidos de EAN-13 partidos por el
salto de línea). Se encontraron 3 productos con el mismo problema en el
catálogo de este tenant (todos baterías EVEREADY, mismo lote de
importación) — 2 de ellos (910, 912) aún no se habían vendido en ninguna
factura, así que no causaron ningún otro rechazo todavía.

**Corrección**:
- `backend/utils/sri.js`: `codigoPrincipal` ahora pasa por el mismo
  saneador `t()` que ya usa `descripcion` en `generarXMLFactura` y
  `generarXMLLiquidacionCompra` (los 2 únicos generadores de XML con
  código de producto en el detalle — NC/ND/Retención no lo usan).
- `backend/test/sri.test.js`: 2 tests nuevos, mismo patrón que los ya
  existentes para descripción.
- Los 3 productos del catálogo (910/911/912) corregidos directamente en
  la BD (código rejuntado sin el salto de línea).
- La factura rechazada se anuló (nunca llegó a `AUTORIZADO`, no requirió
  Nota de Crédito) y se recreó con el código corregido.
  **Hallazgo regulatorio en el camino**: la fecha original (19 de
  agosto) ya no cumplía la ventana de transmisión inmediata del SRI
  (Res. NAC-DGERCGC25-00000014, máximo 3 días de atraso — ya habían
  pasado 5). Se consultó al usuario, quien decidió emitir la factura de
  reemplazo con fecha de hoy (24 de agosto) en vez de usar el flujo de
  "facturas históricas". **Resultado: factura 001-001-000000015,
  AUTORIZADO por el SRI real** (ambiente de producción, no pruebas —
  verificado con número de autorización real).

## Verificación

- `node --test`: 62/62 (2 tests nuevos de codigoPrincipal).
- `npx vite build`: sin errores.
- Los 3 casos verificados contra el pipeline real de producción
  (Railway), no solo localmente.

## Pendiente para retomar

1. **Calidad de datos del catastro `contribuyentes_sri`**: los valores
   distintos observados en `claseContribuyente`
   (`ACTIVO/GEN/PASIVO/PICHINCHA/RMP/SIM/SUSPENDIDO`) sugieren un
   problema más amplio en el script/proceso que importa el CSV del SRI
   — mezcla de estado, provincia y clase de contribuyente en un mismo
   campo. No investigado a fondo (fuera de alcance de hoy); si se vuelve
   a reportar un checkbox que no se marca solo, revisar aquí primero.
2. **Auditoría de otros productos con códigos sucios** en otros tenants
   — se revisaron los 6 tenants conocidos (`railway`, `aela_sys`,
   `aela_mprq`, `aela_lsac`, `aela_labsanjose`, `aela_tania_herrera`) y
   solo `aela_sys` tenía el problema (3 productos). El fix de
   `utils/sri.js` ya previene que esto vuelva a romper una factura, así
   que no es urgente, pero limpiar los códigos de origen sigue siendo
   buena práctica si se encuentran más casos.
3. **Seguridad — `.env.local`**: se encontró que este archivo (correcto,
   ya está en `.gitignore`, nunca se subió a GitHub) contiene la cadena
   de conexión real de la BD de Railway y credenciales del portal SRI en
   texto plano. Recomendado moverlas a un gestor de contraseñas y no
   dejarlas así por mucho tiempo, aunque el riesgo inmediato es bajo
   (nunca salió del repo local).

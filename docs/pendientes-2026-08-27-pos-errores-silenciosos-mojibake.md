# AELA ERP — Sesión 2026-08-27 (parte 2) — POS: errores silenciosos + catálogo en Notas de Venta + mojibake en nombres

## Pedido del usuario

Compartió 6 capturas de pantalla (tenant "CAT DISEÑO DEP..." / Jorge
Mauricio Vallejo Barba) mostrando un error "esporádico" al crear notas
de venta desde POS, y reportó que el formulario de Notas de Venta no
consulta la tabla de productos (hay que digitar todo a mano).

## Hallazgo 1 (crítico) — POS mostraba "éxito" en errores reales

Las capturas muestran la consola del navegador:
`Failed to load resource: ... /api/notas-venta:1 — status of 400`, pero
la UI igual mostraba el modal "✅ Nota de Venta emitida" con "N° —" y el
total calculado localmente (no el que devolvería el servidor). Al hacer
clic en "Ver nota de venta" navegaba a `/notas-venta/undefined` → 500.

**Causa raíz**: `emitirDocumento()` en `PuntoVenta.jsx` usa
`apiOffline()`, que SÍ distingue error de red (offline real, encola) de
error HTTP (`resp.ok:false` con el body de error) — pero el código que
llama a `apiOffline` nunca revisaba `resp.ok`. Si el backend rechazaba
la petición (400/500) estando ONLINE, el código igual entraba al branch
de éxito (`else` de `resp.offline`), leía `resp.data?.data` (que en un
error es `undefined`), y armaba un "documento emitido" falso con
`numero: '—'` e `id: undefined` — exactamente lo que se ve en las
capturas. Por eso es "esporádico": solo se nota cuando una venta en
particular falla una validación real del backend, no en el flujo normal.

**Corregido** en `PuntoVenta.jsx` (ambas ramas, nota de venta y
factura): si `!resp.offline && !resp.ok`, se muestra el error real
(`resp.data?.mensaje` / `resp.data?.error`) y se corta el flujo sin
tocar el carrito ni mostrar el modal de éxito. También se agregó una
guarda en el backend (`GET /notas-venta/:id`) para responder 404 en vez
de 500 si el id no es numérico (ya no debería alcanzarse tras el fix de
arriba, pero es una defensa razonable).

**No se identificó con certeza qué validación específica rechazó ESA
venta en particular** (podría ser el límite anual del plan, un desajuste
de pagos, u otra cosa) — con el fix, la próxima vez que ocurra el
cajero verá el motivo real en pantalla, en vez de un falso "emitida".

## Hallazgo 2 — Notas de Venta sin buscador de catálogo

Confirmado: `FormNotaVenta.jsx` (`/notas-venta/nueva`) nunca tuvo
integración con el catálogo de productos — a diferencia de
`FormFactura.jsx` y `PuntoVenta.jsx`, todo detalle se digitaba a mano
(descripción, precio, cantidad). Se agregó el mismo patrón de
autocompletar que ya existe en Factura: barra de búsqueda por código o
nombre, dropdown de resultados, y clic para agregar la línea con
`codigoPrincipal`/`codigoAuxiliar`/precio ya completados. El código y
auxiliar del producto se guardan en el detalle (sin columna visible,
igual que se hizo para permitir la edición sin perder el vínculo de
inventario — ver doc de la parte 1 de hoy) para que el descuento de
stock siga funcionando igual que si viniera de POS.

## Hallazgo 3 (grave, sin resolver aún) — Mojibake recurrente en nombres con "Ñ"

Las capturas muestran MÚLTIPLES clientes distintos con "Ñ" en su nombre
guardados como "IÃIGUEZ..." (con un byte de control invisible) — tanto
en el campo de la BD (visible en la lista de notas de venta ids
29/35/36, todas de esta semana) como en el propio formulario del POS
ANTES de guardar (el campo "Nombre o razón social" ya llegaba corrupto
desde la consulta de identificación).

Esto contradice lo que se había concluido en la sesión del 24-25 de
agosto ("caso aislado, dato que ya llegó corrupto") — en realidad es un
patrón que sigue ocurriendo con datos frescos, para distintas personas
con "Ñ" en el apellido.

**Causa raíz identificada**: `GET /clientes/sri/:identificacion` puede
resolver el nombre desde `contribuyentes_sri` (catastro SRI cargado por
`scripts/importarCatastroSRI.js`, que lee los CSV con
`{ encoding: 'latin1' }`). El patrón de corrupción observado
("Ñ" → "Ã" + byte invisible U+0080-U+009F) es EXACTAMENTE lo que
produce leer un archivo UTF-8 como si fuera Latin-1 — es decir, en
algún momento se importó un CSV que en realidad estaba en UTF-8 (no
Latin-1 como asume el script), corrompiendo cualquier tilde/Ñ de esa
importación en la tabla `contribuyentes_sri` (catálogo compartido), y
de ahí se propagó a `clientes`/`notas_venta` cada vez que alguien
consultó a uno de esos contribuyentes.

**No se tocó el script de importación** (`importarCatastroSRI.js`) —
no hay forma de confirmar desde aquí si el `latin1` declarado es
correcto para los CSV oficiales del SRI en general (podría serlo, y el
problema haber sido un archivo puntual mal guardado) sin poder inspeccionar
el CSV original, que no está en el repo. Cambiarlo a ciegas podría
arreglar este caso y romper una importación futura genuinamente Latin-1,
o no cambiar nada si el problema fue solo ese archivo. Antes de
reimportar el catastro, verificar la codificación real del CSV oficial
(ej. con un editor hexadecimal o revisando el BOM) en vez de asumir.

**Sí se creó** `backend/scripts/repararMojibakeContribuyentes.js` —
detecta y revierte el patrón exacto (verificado con casos sintéticos:
repara "IÃIGUEZ..." → "IÑIGUEZ..." exacto, y NO marca como falso
positivo un nombre con Ñ correcta como "MUÑOZ PEREZ JUAN" ni texto sin
tildes). Revisa `contribuyentes_sri`, `directorio_global`, `clientes`,
`notas_venta` y `facturas`. Corre en modo dry-run por defecto (solo
lista qué cambiaría); con `--aplicar` corrige de verdad.

**Pendiente, requiere que el usuario decida cómo seguir**: esta sesión
no tiene acceso a la base de datos de producción (no hay
`backend/.env.local` con las credenciales de Railway como en sesiones
anteriores) — no se pudo correr el script contra los datos reales para
confirmar el alcance total ni aplicar la corrección. Hace falta que el
usuario indique cómo prefiere proceder (ver pregunta al final de la
sesión).

## Verificación

- `node --test` (backend): 68/68.
- `npx vitest run` (frontend): 16/17 (el 1 que falla sigue siendo el
  preexistente de `construirSistemaFallback`, no relacionado).
- `npx eslint` / `npx vite build`: sin errores.
- Lógica de detección/reparación de mojibake verificada con casos
  sintéticos en Node directamente (no contra datos reales, por falta de
  acceso a la BD de producción esta sesión).

## Actualización — corrección aplicada en producción (mismo día)

El usuario compartió el `.env.local` de la raíz del proyecto (tenía la
cadena de conexión externa de Railway que no estaba en
`backend/.env.local`). Con eso se pudo:

- Confirmar el alcance real: **645,966 filas** de `contribuyentes_sri`
  (catastro nacional, tabla compartida por toda la plataforma) tienen
  el mismo patrón de corrupción — no solo "Ñ", cualquier vocal
  acentuada. El daño real a datos de tenants fue mucho menor: 2
  `clientes`, 3 `notas_venta`, 0 `facturas` — los mismos 2 RUCs
  ("IÑIGUEZ TORRES PABLO VINICIO" y "IÑIGUEZ CHALAN IRMA RAQUEL",
  empresaId=4) de las capturas.
- Se corrigieron esos 7 registros (2 en `contribuyentes_sri`, la fuente
  raíz, + 2 en `clientes` + 3 en `notas_venta`) más 3 más encontrados en
  `directorio_global` (incluyendo "IÑIGUEZ GONZALEZ CLAUDIA DIANA", el
  caso que se había dado por "resuelto/aislado" el 25 de agosto — nunca
  se corrigió realmente ahí). Total: 10 registros, verificados a nivel
  de bytes (`codepoint 209 = Ñ` en la posición correcta) antes y después
  de escribir, no solo visualmente en la terminal.

**Incidente durante la corrección (transparencia total)**: en el primer
intento de reparar los 7 registros, escribí el texto corrupto
"IÃIGUEZ..." como literal directamente en el comando de terminal en vez
de leerlo de la base de datos — la herramienta/terminal no transmitió
ese carácter acentuado tal cual, y el resultado real que se guardó fue
un carácter de reemplazo inválido (◆ U+FFFD) en esos 7 registros por
unos segundos, ANTES de la verificación posterior. Se detectó de
inmediato al releer los bytes crudos de la BD (nunca confiando en cómo
se ve el texto en la terminal), y se corrigió reconstruyendo el string
exacto por código numérico de carácter (`String.fromCharCode`) en vez
de tipearlo — confirmado exacto contra los ejemplos ya vistos del mismo
patrón de corrupción en otras 8 filas del catastro. Se re-verificó
2 veces más (incluida una búsqueda específica de U+FFFD en las 4 tablas
afectadas) que no quedó ningún rastro del error. **Lección**: nunca
volver a escribir un carácter acentuado literal en un comando para
reparar datos — siempre leer el valor de la BD y operar sobre ESE valor
exacto, o construirlo por código numérico si hace falta un valor de
referencia.

**No se tocó** la tabla `contribuyentes_sri` en su totalidad (645,966
filas) — parchear fila por fila a esa escala sobre una conexión remota
es lento y arriesgado; la recomendación es re-importar el catastro
completo desde un CSV oficial del SRI con la codificación verificada
(no asumida), usando `importarCatastroSRI.js --replace` — mucho más
rápido y confiable que parchear 645K filas una por una. Mientras tanto,
el impacto real a tenants existentes es mínimo (ya corregido); el
patrón solo se repetiría para un cliente NUEVO con tilde/Ñ que aún no
se haya consultado en ningún tenant.

## Pendiente para retomar

- Decidir cuándo re-importar el catastro SRI completo con la
  codificación correcta (evita que sigan apareciendo casos nuevos).
- No se identificó la validación exacta que causó el 400 en la venta de
  las capturas — con el fix de errores silenciosos, la próxima vez que
  pase se verá el mensaje real en pantalla.

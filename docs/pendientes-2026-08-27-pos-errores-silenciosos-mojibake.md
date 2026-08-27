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

## Pendiente para retomar

- Correr `repararMojibakeContribuyentes.js` contra la BD de producción
  real (dry-run primero) para ver el alcance total y decidir si aplicar.
- Decidir si hace falta re-verificar/re-importar el catastro SRI con la
  codificación correcta para evitar que seres nuevos con "Ñ"/tildes
  sigan corrompiéndose al consultarlos por primera vez.
- No se identificó la validación exacta que causó el 400 en la venta de
  las capturas — con el fix de errores silenciosos, la próxima vez que
  pase se verá el mensaje real en pantalla.

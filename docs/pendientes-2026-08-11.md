# AELA ERP — Sesión 2026-08-11 — Bug real: creación de usuario en modo multiempresa

Continuación directa de `docs/pendientes-2026-08-10.md` (mismo hilo de
conversación, cruzó medianoche) — ver ese archivo para todo lo de
Comercial S&S (inventario, precios, exportar Excel, notación científica).

## Bug real encontrado y corregido: crear usuario con username repetido en otra empresa siempre daba error genérico

El usuario reportó (con 3 capturas) que en modo multiempresa (Admin Macro,
varias empresas bajo el mismo login — ej. "CAT DISEÑO DEPORTI..." y
"Jackeline Ocampo") intentó crear un usuario nuevo en una empresa sin
ningún usuario registrado ("No hay usuarios registrados aún"), y el
sistema respondió `El usuario ya está registrado` — un mensaje genérico e
inexplicable dado que esa empresa estaba vacía. El username en conflicto
resultó pertenecer a un usuario ya existente en **otra** empresa
("Jackeline Ocampo").

**El código ya tenía un flujo pensado exactamente para este caso**:
detectar que el conflicto es con OTRA empresa (no con la actual) y
devolver `codigo: 'USERNAME_OTRA_EMPRESA'` con los datos del usuario
existente — el frontend (`GestionUsuarios.jsx`) ya sabe mostrar un modal
"¿Deseas reasignarlo a la empresa actual?" para ese código. Pero ese flujo
nunca se ejecutaba.

**Causa raíz**: bug de scoping en JavaScript en
`backend/routes/usuarios.js`, `POST /usuarios`. `empresaId` se declaraba
con `const` **dentro** del bloque `try`, pero se usaba también dentro del
`catch(error)` — en JS, `try {}` y `catch {}` son bloques **hermanos**, no
anidados, así que una variable declarada con `const`/`let` en uno no es
visible en el otro. La comparación `existente.empresaId !== empresaId`
tiraba un `ReferenceError` silencioso, atrapado por un `catch` interno con
el comentario "si falla la consulta extra, caer al mensaje genérico" —
dejando ese flujo completo muerto en código desde que se escribió, sin que
ningún test lo detectara (no hay tests de esta ruta).

**Fix**: mover la declaración de `empresaId` (y su dependencia
`empresaIdBody`) fuera del `try`, antes de que empiece, para que quede
accesible en el `catch`.

**Verificado** reproduciendo el escenario real en local (usuario existente
en `empresaId=2`, intento de crear el mismo username apuntando a
`empresaId=1`): antes de este fix hubiera dado el mensaje genérico; ahora
responde `409` con `codigo: USERNAME_OTRA_EMPRESA` y los datos del usuario
existente — el frontend ya renderiza el modal de reasignación con esa
respuesta, sin cambios de frontend necesarios. `node --test`: 38/38 (sin
test automatizado nuevo — esta ruta necesita servidor+BD reales para
probarse, no hay infraestructura de test de integración en el repo; cubierto
con la verificación manual end-to-end).

## 🔴 Para el usuario

Con el fix desplegado, vuelve a intentar crear el usuario en "CAT DISEÑO
DEPORTI...". Si el username pertenece a la misma persona que ya tiene
cuenta en "Jackeline Ocampo" (Liliana Herrera o Alejandro Ocampo), el
sistema va a ofrecer **reasignarlo** a la nueva empresa en vez de crear un
duplicado — eso es lo correcto si es la misma persona con una sola cuenta.
Si en cambio son dos personas distintas que casualmente eligieron el mismo
nombre de usuario, hay que ponerle un username distinto a la nueva
persona (los usuarios son globales al sistema, no por empresa).

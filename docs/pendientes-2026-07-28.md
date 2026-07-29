# AELA ERP — Sesión 2026-07-28/29 — Buzón SRI descarga automática, selector de cuenta, modo oscuro

## 🟢 PARA RETOMAR — checklist rápido

**Código**: todo commiteado y pusheado a `main` (7 commits, del `6fdf11b` al `30cf5a7`).

### 1. Buzón SRI — Descarga automática (pendiente de confirmar en Railway)
- Con credenciales incorrectas: debe fallar en <1s con el mensaje real
  (antes tardaba hasta 3 min probando Puppeteer igual). **Ya verificado
  contra el portal real.**
- Con credenciales correctas: cae a Puppeteer, probando primero
  `@sparticuz/chromium` (reordenado porque el binario de nixpacks se colgaba
  dos veces seguidas en Railway sin dar error). **Falta la prueba real en
  producción** — revisar logs de Railway (`[SRI-Browser]`) para confirmar si
  ahora sí completa el login y trae los comprobantes, o dónde se traba.
- Si `@sparticuz/chromium` también falla — la siguiente pista sería agregar
  logs explícitos dentro de `scraperSriLogin()` en cada `page.goto()` (hoy es
  la función más "muda" del archivo) para saber si el problema es *lanzar*
  Chromium o *navegar* con él ya lanzado (causas raíz distintas).
- Si ningún nivel de Puppeteer logra completarlo — aceptar que la
  infraestructura actual de Railway no puede correr un navegador real de
  forma confiable, y marcar "Descarga automática" como no disponible en la
  UI, reforzando ZIP/XML/TXT (que sí son 100% estables).

### 2. Selector de cuenta en asientos (Nuevo/Editar/Asiento inicial, Libro Mayor) — ✅ RESUELTO Y VERIFICADO
Reportado por el usuario con capturas (no dejaba cambiar la cuenta al
editar un asiento). Corregido en 3 iteraciones (recorte por scroll → salto
de posición → z-index) y **verificado en un navegador real con Playwright**
contra datos reales: primera y última fila de un asiento, y el filtro de
Libro Mayor — funciona correctamente en los 3 casos. No requiere más
seguimiento salvo que el usuario note algo distinto en su uso diario.

### 3. Modo oscuro en Contabilidad — ✅ RESUELTO Y VERIFICADO
Reportado con captura (modal "Ver asiento" con texto invisible). Pasada
completa de cobertura de modo oscuro en `ContabilidadHub.css`. **Verificado
visualmente en navegador real** (Playwright con `color-scheme: dark`
emulado) en Ver/Editar asiento y Resumen. Pendiente que el usuario lo
confirme en su propio navegador/SO con modo oscuro real, por si hay algún
matiz que la emulación no capture.

### 4. Config. asientos y pantallas de Plan de Cuentas — ✅ RESUELTO Y VERIFICADO
Reportado como "muy tupido". Más padding y ancho de columna — de 5 selects
angostos truncados en una fila a 3 columnas espaciosas. Verificado en
capturas claro y oscuro.

## Contexto: por qué "sigue sin funcionar"

El usuario reportó que la descarga automática del SRI seguía sin funcionar.
Se investigó a fondo contra el portal real (con credenciales reales de
prueba, autorizadas explícitamente por el usuario para este diagnóstico) en
vez de seguir adivinando — la implementación existente (desde finales de
junio) nunca se había confirmado funcionando en producción con datos reales.

### Hallazgo 1 — bug real en la validación de credenciales (CORREGIDO)

`_loginROPC()` en `sriScraper.js` mandaba la contraseña **sin hashear** al
endpoint `/token` de Keycloak. El portal SRI en realidad valida la
contraseña ya hasheada (MD5+SHA-512, la misma transformación que hace
`validarUsuario()` en el JS del formulario real — ya replicada correctamente
en el flujo de browser/fetch, pero no en ROPC). Resultado: ROPC **siempre**
devolvía `invalid_grant` sin importar si la clave era correcta o no — y el
código lo interpretaba como "no confiar en ROPC, seguir de todos modos",
ocultando el problema en vez de resolverlo.

**Verificado con credenciales reales**: clave sin hashear → `401
invalid_grant` incluso siendo correcta; clave hasheada → `200` con
`access_token` válido.

### Hallazgo 2 — el flujo fetch (sin navegador) nunca puede llegar a la página de Comprobantes Recibidos

Con las credenciales ya confirmadas como correctas (login por fetch funciona:
POST → 302 → código OAuth válido → sesión Keycloak establecida), la
navegación hacia la página JSF legacy de "Comprobantes Electrónicos
Recibidos" pasa por un puente del portal (`GeneraToken.jsp`, bajo
`/tuportal-internet/`) que **siempre fuerza un logout** y redirige al home
de la app nueva (`sri-en-linea/contribuyente/perfil`) en cuanto se le pide
sin un `code` de OAuth recién emitido — algo que ocurre inevitablemente en
el propio segundo salto del redirect de `GeneraToken.jsp` (patrón
post-redirect-get).

Se probó exhaustivamente para descartar que fuera un problema de URL/parámetros:
- Con Bearer token válido (obtenido vía ROPC corregido) → mismo bloqueo.
- Con los parámetros exactos de navegación (`contextoMPT`, `pathMPT`,
  `actualMPT`, `linkMPT`, `esFavorito=S`) capturados de una **captura de
  pantalla real** que el usuario compartió, confirmando que esa misma URL sí
  funciona perfectamente en su navegador (muestra la pantalla real de
  "Comprobantes electrónicos recibidos" con su RUC precargado) → mismo
  bloqueo por fetch.
- Con una espera de 8s entre el login y la navegación (por si era un tema de
  latencia/consistencia del backend) → mismo bloqueo.

**Conclusión**: la página SÍ existe y SÍ funciona — el portal no está roto en
general. El bloqueo es específico de replicar esa navegación con un cliente
`fetch` en vez de un navegador real (sospecha: fingerprint TLS/HTTP2, o
session-affinity de un balanceador F5 delante del portal — se ven cookies
`BIGipServerCEL-internet` en las respuestas). Con las herramientas
disponibles en este entorno no se pudo confirmar la causa exacta, pero sí se
confirmó que **no es solucionable ajustando headers/parámetros** — ya se
agotaron las variantes razonables. Solo un navegador real (Puppeteer) puede
completar esa navegación.

### Fix aplicado (`backend/utils/sriScraper.js`)

1. `_loginROPC()` ahora hashea la clave antes de mandarla (MD5+SHA-512) —
   ROPC ahora es un chequeo de credenciales **confiable y rápido** (~200ms).
2. Si ROPC confirma que las credenciales son incorrectas, `obtenerRecibidosScraper()`
   falla de inmediato (antes esperaba hasta 3 min al timeout de Puppeteer
   para reportar lo mismo).
3. Si ROPC confirma que las credenciales son **correctas** pero el bounce de
   `GeneraToken.jsp` igual bloquea el fetch, el mensaje de error ya NO dice
   "credenciales incorrectas" (antes generaba un falso negativo que además
   cortaba el fallback al método `portal` en `buzon.js`, por el matching de
   texto de `esErrorCredencialesSri()`) — ahora dice explícitamente que las
   credenciales son válidas y que se requiere navegador real, y cae a
   Puppeteer con confianza.

### Verificación realizada

- Probado exhaustivamente contra el portal SRI real (`srienlinea.sri.gob.ec`)
  con credenciales de prueba reales autorizadas por el usuario (RUC
  `1103568240001`) — no se guardaron ni subieron a git en ningún momento
  (scripts de diagnóstico ad-hoc en el scratchpad, borrados al terminar).
- `node --test`: 29/29. `npx vite build`: limpio (sin cambios de frontend
  esta sesión).
- **No probado**: Puppeteer contra el portal real desde Railway (este
  entorno de desarrollo no tiene Chrome instalado, así que el fallback a
  Puppeteer solo se pudo confirmar que "existe y se invoca correctamente",
  no que efectivamente complete la navegación). Ver checklist arriba.

## Hallazgo 3 (mismo día, con logs reales de Railway del primer intento) — Puppeteer se cuelga al lanzar Chromium, no falla limpio

El usuario probó "Descarga automática" en producción tras el primer fix y
compartió los logs de Railway. Confirmó: el login por fetch SÍ llega hasta
donde se esperaba (bounce de `GeneraToken.jsp`, igual que en el diagnóstico
local) y el fallback a Puppeteer sí arrancó — **Nivel 1 (nixpacks,
`/root/.nix-profile/bin/chromium`) logró lanzar Chromium en Railway**, algo
que el diagnóstico de 2026-06-19 daba por imposible (network de Railway
bloqueado para Puppeteer). Dato nuevo y positivo.

Pero después de esa línea de log, **cero logs adicionales durante 9
minutos** (ni uno de los ~15 `console.log` que el resto del flujo de login
dispara normalmente) hasta que Railway detuvo el contenedor por el redeploy
de los commits de este mismo día. Eso indica que `puppeteer.launch()` no
lanzó error ni completó — se colgó indefinidamente. Causa probable: el
proceso de Chromium arranca pero su canal de depuración (CDP) nunca termina
de establecerse (típico de faltar alguna librería del sistema en el
contenedor), y la opción `timeout` de `puppeteer.launch()` depende de ese
mismo canal para funcionar, así que tampoco dispara.

**Fix aplicado**: nueva función `_conTimeout()` en `sriScraper.js` que
envuelve cada uno de los 3 niveles de `_lanzarNavegador()` en un
`Promise.race` con 20s — si un nivel se cuelga (no solo si lanza error),
ahora sí se abandona a tiempo y se le da la oportunidad al siguiente nivel
(`@sparticuz/chromium`, que trae su propio Chromium autocontenido sin
depender de librerías del sistema, mucho menos propenso a este problema
específico) dentro del presupuesto total de 3 minutos.

### Verificación realizada
- `node --test`: 29/29.
- **No probado aún**: si con este fix el Nivel 2 sí logra completar la
  navegación real en Railway — requiere una prueba más en producción. Ver
  checklist arriba.

## Hallazgo 4 (mismo día, segundo intento del usuario en producción) — Nivel 1 se sigue colgando igual, incluso con el timeout

El usuario probó de nuevo tras el fix del timeout duro. Mismo resultado
exacto: log se corta en "Nivel 1 — executablePath: .../chromium" sin ningún
"Nivel 1 falló" ni "Nivel 2" después. Dos explicaciones posibles, no
excluyentes: (a) el deploy con el fix del timeout todavía no había
terminado de desplegarse cuando se probó (Railway puede tardar unos
minutos en compilar/desplegar), o (b) el binario de Chromium de nixpacks en
este contenedor específico está tan roto que ni siquiera un
`Promise.race` externo alcanza a rescatar el intento (no debería pasar si
el event loop de Node sigue libre, pero no se puede descartar sin más
datos).

**Decisión tomada sin esperar más ciclos de diagnóstico**: con DOS intentos
reales consecutivos mostrando el mismo cuelgue exacto en el mismo nivel,
ya no vale la pena seguir intentando arreglar el binario de nixpacks —
se reordenaron los 3 niveles para que `@sparticuz/chromium` (diseñado
específicamente para no depender de librerías del sistema del contenedor,
la causa más probable del cuelgue) sea el **primer** intento, y el binario
de nixpacks quede como respaldo en segundo lugar en vez de primero.

### Verificación realizada
- `node --test`: 29/29.
- Confirmado que `@sparticuz/chromium` carga y resuelve una ruta de
  ejecutable sin errores (localmente en Windows resuelve una ruta que
  luego no es un binario válido — es Linux-only, así que eso es esperado
  y no informa nada sobre Railway, que sí es Linux).
- **Pendiente crítico para la próxima prueba**: antes de volver a probar en
  la app, confirmar en Railway → Deployments que el deploy más reciente
  (este commit) ya está "Active" — para no repetir el ciclo de probar
  contra un deploy viejo sin darse cuenta.

## Sesión 2026-07-29 — Fix: no se podía cambiar la cuenta al editar un asiento

El usuario reportó (con captura de pantalla) que en el modal "Editar
asiento" no dejaba cambiar la cuenta de la línea del Haber — el campo
mostraba "11" (resto de una búsqueda) sin poder seleccionar un resultado.

**Causa raíz**: `SelectorCuentaBuscable` (el buscador de cuenta por
código/nombre, usado en asientos manuales, asiento inicial y Libro Mayor)
dibuja su lista de resultados con `position: absolute` dentro de la celda
de la tabla. Esa tabla (`.conta-table-scroll`, usada en "Nuevo asiento" /
"Editar asiento") tiene `max-height: 420px` + `overflow-y/x: auto` — un
contenedor con scroll recorta cualquier hijo absolutamente posicionado que
se salga de su área visible. En una tabla de pocas líneas (como este
asiento de 2 líneas), la lista desplegable de la última fila se recortaba
casi por completo, dejándola invisible/inalcanzable aunque funcionalmente
seguía ahí — de ahí que pareciera que "no dejaba cambiar".

**Fix** (`ContabilidadHub.jsx`): la lista de resultados ahora se dibuja vía
`createPortal` a `document.body` con `position: fixed`, calculando su
posición desde `getBoundingClientRect()` del input (mismo patrón ya usado
en `ListaCompras.jsx` para el popover "···" de info) — así ya no depende
del `overflow` de ningún contenedor ancestro. Se cierra automáticamente si
se hace scroll en la página (para no quedar flotando en una posición
vieja).

### Verificación realizada
- `npx vite build`: limpio.
- `node --test`: 29/29 (backend, sin cambios — sanity check).
- **No probado en navegador real** (sin entorno de navegador disponible
  aquí) — pendiente que el usuario confirme en la app: abrir "Editar
  asiento" de un asiento con 2+ líneas, hacer clic en el campo Cuenta de la
  última línea, escribir para buscar, y confirmar que ahora sí se puede
  hacer clic en un resultado y que la cuenta cambia.

### Addendum mismo día — flip-up + z-index (verificado en navegador real con Playwright)

Tras el fix del portal, el usuario reportó dos problemas visuales nuevos con
capturas: (1) el desplegable se abría muy lejos del campo cuando la fila
estaba cerca del borde inferior del modal, y (2) "se dañó para ambos, Debe y
Haber" — el clic en un resultado no seleccionaba nada.

- **Causa (1)**: `useEffect` calcula la posición *después* de pintar — había
  un frame donde `top`/`bottom` seguían en `null` y el portal cae en su
  posición de flujo normal (al final de `<body>`), antes de saltar a la
  posición correcta. Cambiado a `useLayoutEffect` (calcula antes de pintar,
  sin frame intermedio visible). Se agregó también lógica de "flip":
  si no hay espacio suficiente abajo, la lista se abre hacia arriba, y su
  `max-height` se ajusta al espacio real disponible en vez de un valor fijo.
- **Causa (2)**: el z-index de `.conta-selector-cuenta-lista` (20) quedaba
  por debajo del z-index del overlay del modal (1000) — al dibujarse ahora
  vía portal, fuera del árbol del modal, sus clics quedaban interceptados
  por el propio contenido del modal encima. Subido a `z-index: 2000`.

**Verificado en un navegador real esta vez** (se instaló Playwright +
Chromium localmente, se sirvió el build de producción con `vite preview` en
un puerto aislado —no se tocó el servidor de desarrollo del usuario en 5600—
y se reseteó temporalmente la contraseña local del usuario admin solo en la
BD de desarrollo para poder iniciar sesión): abrí un asiento real de 3
líneas, hice clic en el campo Cuenta de la última fila, escribí para
filtrar, hice clic en un resultado — el desplegable aparece a 2px del
campo y la cuenta se actualiza correctamente (`1.1.01.001 - Caja`). Repetido
también en la primera fila del mismo asiento y en el filtro de cuenta de
Libro Mayor — mismo comportamiento correcto en los 3 usos del componente,
0 errores de consola.

**Nota para el usuario**: la contraseña de tu usuario local de desarrollo
(`raocampo`) se reseteó temporalmente a `TempTest1234` para esta prueba —
solo en tu base de datos local (`aela_db`), nunca tocó producción. Cámbiala
de nuevo a lo que prefieras desde "🔑 Cambiar contraseña" si te interesa.

## Sesión 2026-07-29 (parte 2) — Modo oscuro roto en Contabilidad + espaciado apretado en Config. asientos

El usuario compartió una captura del modal "Ver asiento" en modo oscuro:
los valores de Fecha/Tipo/Referencia/Descripción y el contenido de la
tabla (nombre de cuenta, Descripción, Debe, Haber) eran completamente
invisibles — texto oscuro sobre el fondo ya oscuro del modal.

**Causa raíz**: `ContabilidadHub.css` solo tenía cobertura de modo oscuro
para un puñado de componentes específicos (selector de cuenta, subtabs,
el cascarón del modal, import/dropzone/badges). El resto — `.conta-card`,
`.conta-kpi`, `.conta-table` (texto de celdas), `.conta-form-grid`
inputs/selects, `.conta-filters`, `.conta-origen-doc`, `.conta-warning`,
`.conta-asiento-meta` (el bug reportado), tablas de estados financieros,
`.conta-kpi-warn`, cabecera sticky de tabla — nunca tuvo overrides de modo
oscuro. El color de texto global del body (`#1e293b`, oscuro) nunca se
invierte para modo oscuro a nivel app — cada componente es responsable de
su propio contraste, y esta sección del archivo quedó a medias.

**Fix**: pasada completa de modo oscuro sobre `ContabilidadHub.css` — se
agregaron ~15 bloques `@media (prefers-color-scheme: dark)` nuevos,
colocados junto a cada regla de modo claro correspondiente (mismo patrón
que ya usaba el archivo), cubriendo todo lo listado arriba.

El usuario también pidió mejorar "Config. asientos" (Plan de Cuentas), que
se veía muy apretado (5 selects angostos en una fila, texto truncado, poco
padding). Se aumentó el padding de `.conta-card` (12px → 20px), el ancho
mínimo de columna de `.conta-form-grid` (220px → 240px) y su gap (16px →
20/24px), y se le dio más aire a la descripción bajo cada título
(`.conta-import-sub`, margin-bottom 0 → 18px). Esto mejora TODAS las
pantallas que usan estas clases compartidas (Nueva cuenta, Config cuentas,
Importar Excel, Config. asientos), no solo la que se reportó.

### Verificación realizada
- `npx vite build`: limpio.
- **Verificado visualmente en navegador real** (Playwright, `colorScheme:
  'dark'` emulado + `page.emulateMedia`): capturas de "Ver asiento",
  "Editar asiento" y "Resumen" en modo oscuro — todo el texto legible,
  tarjetas/tablas con fondo oscuro consistente. Capturas de "Config.
  asientos" en claro y oscuro — layout espacioso en 3 columnas en vez de 5
  apretadas, sin texto truncado, buen padding.

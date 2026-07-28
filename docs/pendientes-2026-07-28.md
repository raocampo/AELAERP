# AELA ERP — Sesión 2026-07-28 — Diagnóstico a fondo: Buzón SRI "Descarga automática"

## 🟢 PARA RETOMAR — checklist rápido

**Código**: commiteado y pusheado a `main` (3 commits esta sesión).

1. **Probar de nuevo en producción con credenciales reales** — Buzón SRI →
   "Descarga automática SRI". Con los fixes de esta sesión debería: si la
   clave es incorrecta, fallar en <1s con el mensaje real (antes tardaba
   hasta 3 min). Si la clave es correcta, cae a Puppeteer — revisar logs de
   Railway (`[SRI-Browser]`) para ver si el Nivel 1 (nixpacks) sigue
   colgándose (ahora debería fallar/pasar al Nivel 2 en ~20s en vez de
   colgarse indefinidamente) y si el Nivel 2 (`@sparticuz/chromium`) logra
   completar el login y navegar a la página real.
2. **Si el Nivel 2 también se cuelga o falla** — la próxima pista a seguir
   sería añadir logs explícitos dentro de `scraperSriLogin()` justo antes y
   después de cada `page.goto()` (ahora mismo esa función es la más "muda"
   del archivo, solo loguea cuando intercepta el POST de credenciales) para
   saber si el cuelgue es al *lanzar* Chromium o al *navegar* con él ya
   lanzado — son causas raíz distintas (librerías del sistema faltantes vs.
   el proceso de Chromium sin salida a internet, este último ya sospechado
   desde 2026-06-19).
3. **Si ningún nivel de Puppeteer logra completar la navegación real** —
   aceptar que la infraestructura actual de Railway no puede correr un
   navegador real de forma confiable, y marcar "Descarga automática" como no
   disponible en la UI, reforzando ZIP/XML/TXT (que sí son 100% estables).

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

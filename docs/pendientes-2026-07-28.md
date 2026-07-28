# AELA ERP — Sesión 2026-07-28 — Diagnóstico a fondo: Buzón SRI "Descarga automática"

## 🟢 PARA RETOMAR — checklist rápido

**Código**: commiteado y pusheado a `main`.

1. **Probar en producción con credenciales reales** — Buzón SRI → "Descarga
   automática SRI", con un tenant que tenga credenciales del portal SRI
   correctas. Con el fix de esta sesión debería: si la clave es incorrecta,
   fallar en <1s con el mensaje real (antes tardaba hasta 3 min probando
   Puppeteer igual). Si la clave es correcta, debe caer a Puppeteer (revisar
   logs de Railway: buscar `[SRI-Browser]` para ver qué nivel de Chromium
   usó y si consiguió llegar a la página real).
2. **Confirmar si Puppeteer puede salir a internet desde Railway hoy** — la
   última vez que se diagnosticó esto (2026-06-19) la respuesta fue "no", pero
   es anterior a varios cambios de infraestructura y nunca se volvió a probar.
   Si Railway logs muestran que Puppeteer sí llega a `srienlinea.sri.gob.ec`
   y logra ver la tabla de comprobantes, la función quedaría resuelta de
   fondo. Si sigue sin poder salir a internet, la "Descarga automática" no es
   viable en la infraestructura actual y debería marcarse así en la UI
   (reforzando ZIP/XML/TXT, que sí son estables).

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

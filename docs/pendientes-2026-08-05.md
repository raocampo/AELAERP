# AELA ERP — Sesión 2026-08-05 — Rediseño del login

## Contexto

El usuario compartió una captura de otro sistema propio (SUJAM — Sistema
Sumak Jambi, historias clínicas electrónicas) como referencia de diseño y
pidió replicar ese estilo en el login de AELA: layout de dos paneles
(marca a la izquierda, formulario a la derecha) en vez de la tarjeta
centrada de un solo panel que tenía AELA hasta ahora.

## Cambio implementado (commit `9be0f84`)

`frontend/src/components/Auth/Login.jsx` + `Login.css` — nueva estructura
`.login-page` → `.login-shell` → `.login-panel-left` + `.login-panel-right`:

- **Panel izquierdo**: logo del tenant si lo subió (o el ícono genérico de
  AELA si no) + nombre de la empresa en grande + "AELA ERP Ecuador" +
  tagline con los módulos principales ("Facturación Electrónica ·
  Contabilidad · Nómina"), sobre un degradado morado→cian con textura
  diagonal. **Se mantuvieron los colores de marca ya usados en el resto de
  AELA** (morado `#7C3AED`/`#6D28D9`, no el verde/azul de la referencia) —
  la petición era sobre el layout, no sobre cambiar la paleta.
- **Panel derecho**: "Bienvenido de vuelta", checkbox "Recordarme" (nuevo,
  guarda el usuario/correo en `localStorage` bajo la key
  `aela_login_recordado`, sin tocar el backend — es solo conveniencia de
  UI) junto a "¿Olvidó su contraseña?", y un enlace de contacto nuevo
  ("¿No tienes una cuenta? Contáctanos" → mailto, mismo correo que ya se
  usaba en el mensaje de tenant en aprovisionamiento).
- Los 3 estados existentes (verificando setup, tenant en aprovisionamiento,
  wizard de configuración inicial) se movieron al panel derecho sin
  cambiar su lógica — solo el wizard de 2 columnas recibió un panel más
  ancho (`login-shell-setup`, hasta 1180px) para no verse apretado.
- Responsive: por debajo de 900px los paneles se apilan verticalmente
  (marca arriba, compacta; formulario abajo); por debajo de 480px el
  shell ocupa todo el viewport sin bordes redondeados.

## Verificación

`vite build` sin errores. Verificado visualmente con Playwright (ya estaba
instalado localmente de una sesión anterior, más el binario de Chromium en
caché) contra el build de producción servido con `vite preview` en un
puerto aislado (4899), en 3 anchos: desktop (1400px), tablet (820px) y
mobile (390px). La página de login llama a endpoints públicos
(`/auth/branding`, `/auth/bootstrap-status`) que en este entorno resolvieron
contra el backend real de producción (Corp Simtelec) — son lecturas sin
autenticación, no se envió ningún formulario ni se modificó nada; sirvió
además para confirmar que el layout se ve bien con datos reales (nombre
"Corp Simtelec", intento de cargar su logo real).

**No verificado visualmente**: el estado de "Configuración inicial" (wizard
de primera empresa) — no se pudo forzar sin un backend con una base de
datos vacía a mano; se confía en que reutiliza exactamente las mismas
clases CSS (`.login-titulo`, `.login-form`, `.login-grid`, `.login-field`)
ya verificadas en el estado de login normal, más el ensanchado del panel
que es un cambio CSS simple y de bajo riesgo. Si el usuario tiene ocasión
de ver una cuenta nueva sin usuario administrador, vale la pena confirmarlo
visualmente.

## Pendientes que siguen abiertos
Sin cambios — ver la lista consolidada en `docs/pendientes-2026-08-04.md`.

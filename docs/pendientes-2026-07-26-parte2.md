# AELA ERP — Sesión 2026-07-26 (parte 2) — Impresión térmica por USB (WebUSB)

## 🟢 PARA RETOMAR — checklist rápido

**Código**: commiteado y pusheado a `main`. Nada sin commitear.

1. **Probar contra hardware real** (todo lo de abajo se verificó a nivel de
   bytes/estructura con Node, nunca contra un navegador Chromium real ni una
   impresora física — no hay entorno de navegador disponible aquí):
   - Ir a **Configuración del Sistema → Impresión y kiosko**, elegir modo
     "USB", click en "🔌 Conectar impresora USB" con una impresora térmica
     real conectada, y confirmar que el diálogo nativo de Chrome/Edge la
     lista y que "Probar impresión" saca un ticket real.
   - **Riesgo conocido de Windows**: si `claimInterface()` falla, es porque
     Windows ya le asignó el driver genérico de impresora a esa interfaz USB
     — hay que reasignarlo a WinUSB (ej. con Zadig) para que el navegador
     pueda tomarla. Es una limitación conocida de WebUSB en Windows, no un
     bug de esta implementación — documentarlo para soporte al cliente.
   - Confirmar que "Etiquetas de Productos" imprime bien en modo USB (ya
     funcionaba en modo Red desde la sesión 07-23, nunca contra impresora
     real tampoco).
   - Confirmar en el POS que "🧾 Imprimir ticket térmico" y "💵 Abrir cajón"
     aparecen solo cuando corresponde y funcionan en ambos modos (red/usb).
   - Confirmar `[schema-fix]` en logs de Railway para la columna
     `configuracion_sistema.impresoraModo` en cada tenant.
2. **Pregunta pendiente para el cliente con la 3nstar**: confirmar el modelo
   exacto — si es un modelo de recibos (línea RPT) debería funcionar por
   USB vía WebUSB; si es una impresora de etiquetas dedicada de otra línea,
   podría usar un protocolo distinto (TSPL) no cubierto por este cambio.

---

## Contexto

El usuario preguntó si una impresora térmica 3nstar (no-Epson) imprimiría
bien. Investigando salió a la luz que el módulo de impresión térmica
ESC/POS (`impresoraEscPos.js` + `routes/impresora.js`) **solo habla por TCP
a una IP** — arquitectónicamente imposible que llegue a una impresora
conectada por **USB**, porque el backend corre en la nube (Railway) y nunca
tiene acceso al puerto USB del equipo del cliente. Se encontraron además 2
hechos no reportados: (1) no existía ninguna pantalla para configurar
`impresoraIp` en el frontend — el módulo de red era, en la práctica,
inutilizable en producción; (2) el recibo principal del POS ya imprime bien
hoy con cualquier impresora (PDF + diálogo de impresión del navegador, sin
depender del backend).

Se plantearon 3 opciones (navegador/PDF ya existente, WebUSB, agente local
instalado) y, tras pedir explícitamente "todas las opciones para no perder
clientes", el usuario eligió implementar ahora **PDF (ya existente) + WebUSB**
— cubre Chrome/Edge/Opera de escritorio y Android (la inmensa mayoría de
negocios pequeños) sin instalar nada. El agente local (cubriría también
Safari/Firefox, y de paso arreglaría la impresión por red real) queda
documentado como trabajo futuro, no implementado.

---

## Implementado

### Modelo
- `configuracion_sistema.impresoraModo` (`'ninguna' | 'red' | 'usb'`, default
  `'ninguna'`) — determina si el frontend manda los bytes ESC/POS por TCP
  (modo `red`, ya existente) o si solo pide el buffer y lo manda por WebUSB
  (modo `usb`, nuevo). Migración `20260726020000_impresora_modo_usb` +
  reflejada en `applySchemaFixes.js`.

### Backend
- `impresoraEscPos.js`: extraído `generarComandoCajon()` (antes inline en
  `abrirCajon()`) y agregado `generarTicketPrueba()` — ambos reutilizados por
  el camino TCP y el nuevo camino de bytes crudos.
- `routes/impresora.js`: 4 endpoints nuevos que devuelven
  `application/octet-stream` en vez de mandar por TCP —
  `POST /etiquetas/generar`, `POST /recibo/:tipo/:id/generar`,
  `POST /cajon/generar`, `GET /prueba/generar`. Ninguno exige `impresoraIp`
  (irrelevante en modo USB), solo `impresoraHabilitada`.
- `GET/PUT /impresora/config` ahora incluye `impresoraModo`.

### Frontend
- **`utils/impresoraUsb.js`** (nuevo): helper WebUSB —
  `usbDisponible()` (feature-detect, oculta la opción si el navegador no
  soporta WebUSB), `conectarImpresoraUSB()` (pide el dispositivo la primera
  vez), `reconectarImpresoraUSB()` (reconecta sin volver a preguntar — el
  permiso de WebUSB persiste por origen en el navegador), `enviarBufferUSB()`
  (`transferOut` al endpoint de salida).
- **`ConfiguracionSistema.jsx`**: completada la pantalla de impresora que
  nunca existió — selector de modo (Ninguna/Red/USB), campos IP/puerto para
  Red, botón "Conectar impresora USB" + estado para USB, ancho de papel,
  cajón de dinero, y "Probar impresión" (funciona en ambos modos).
- **`EtiquetasProductos.jsx`** y **`PuntoVenta.jsx`**: ambos ramifican entre
  TCP (modo red) y buffer+WebUSB (modo usb) según
  `configuracion_sistema.impresoraModo`. En el POS, el botón "🧾 Imprimir
  ticket térmico" y "💵 Abrir cajón" solo aparecen si el módulo está
  habilitado — el botón de recibo PDF existente no cambia.

### Fuera de alcance (documentado, no implementado)
- **Agente local instalado** (Opción C) — única forma de cubrir Safari/
  Firefox y de arreglar la impresión por red real (mismo problema de fondo:
  Railway no alcanza una IP LAN del cliente). Deuda técnica documentada,
  se retoma si un cliente concreto lo necesita.

---

## Verificación realizada

- `node --test`: 29/29.
- Migración aplicada limpiamente contra `scfi_dev` local.
- **Bytes verificados con Node** (sin navegador ni impresora física):
  `generarComandoCajon()` coincide byte a byte con lo esperado
  (`ESC@ + ESC p 0 25 250 + ESC d 1`), `generarTicketPrueba()` empieza con
  init y termina con el corte, `generarEtiquetaProducto()` con 2 copias
  genera 2 cortes, `generarRecibo()` incluye el tipo de documento y el total
  correctos.
- Servidor levantado localmente: los 4 endpoints nuevos responden 401
  (montados y protegidos, no 404).
- `npx vite build`: limpio.
- **No probado**: WebUSB de punta a punta contra una impresora física real —
  requiere un navegador Chromium real y hardware conectado, no disponible en
  este entorno. Ver checklist al inicio de este documento.

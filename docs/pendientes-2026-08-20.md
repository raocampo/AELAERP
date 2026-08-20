# AELA ERP — Sesión 2026-08-20 — Vista en pantalla del F104 + fix Exento en ATS

## Pedido del usuario

Dos pedidos:

1. Además del resumen actual y el PDF descargable, el usuario pidió una
   **vista en pantalla tipo formulario** para el F104 (como el mockup de
   "SOFIA WEB 2" que compartió ayer) — mejor experiencia de usuario que
   tener que descargar el PDF para ver los casilleros.
2. En medio de esa tarea, reportó que en el talón resumen PDF y en el
   XML del ATS **no aparece la columna de "Exentos de IVA"**, solo "No
   Obj." — pidió revisarlo y arreglarlo después de terminar lo del F104.

## 1. Vista "Formulario" en pantalla — F104

### Refactor: `casillerosF104()`

Antes, la lógica que arma los casilleros (tarifa general 12%/15%
combinada, factor de proporcionalidad, resumen impositivo 601-620,
agente de retención 721-731) vivía SOLO dentro del handler de
`GET /f104/pdf`, calculada inline con PDFKit ya dibujando encima. Se
extrajo a una función pura `casillerosF104(f104)` (sin acceso a BD, solo
transforma el objeto ya calculado por `calcularF104()`), que ahora usan
**ambos** endpoints:

- `GET /f104` (JSON) agrega `f104.casilleros` a la respuesta.
- `GET /f104/pdf` la reutiliza para las tablas del PDF (mismo cálculo,
  una sola vez — antes se recalculaba todo inline en el handler del PDF).

Esto garantiza que la vista en pantalla y el PDF descargado **siempre
muestren los mismos números** — no hay dos lugares que puedan
desincronizarse.

### Frontend: `F104FormularioView`

Nuevo componente en `Declaraciones.jsx`, activado con un toggle
"Resumen | Formulario" en el header de F104 (junto al botón de PDF).
Renderiza 5 tablas (Ventas, Compras, Factor de proporcionalidad, Resumen
impositivo, Agente de retención) con el mismo layout Casillero +
Descripción + valores que ya tiene el PDF, usando `data.casilleros` tal
cual llega del backend. CSS nuevo en `Declaraciones.css`
(`.decl-vista-toggle`, `.decl-formvista*`) — barra de sección violeta,
badge de casillero en fuente monoespaciada, mismo lenguaje visual que el
resto del módulo.

### Bug encontrado durante la propia verificación

Había una fila con `creditoPorRetenciones=1487.68` guardada por error en
el período **mayo 2026 real** (empresaId=1, no un tenant de prueba) — un
residuo de una prueba de la sesión anterior donde primero apunté mal el
período (mes 5 en vez de 6) antes de corregirlo. No era dato de un
usuario real, solo mi propio artefacto de prueba olvidado. Se eliminó
esa fila (`declaraciones_credito_iva` id=1) al notarlo en el PDF
regenerado para verificar el refactor.

### Verificado

`GET /f104` ahora expone `casilleros` con las 5 secciones esperadas.
PDF re-renderizado a PNG tras el refactor — idéntico al de ayer, mismos
números. `node --test`: 49/49. `vite build`: sin errores. No probado en
navegador real (sin herramienta de automatización en este entorno).

## 2. ATS — columna "Exento" separada de "No Obj."

### Causa raíz

En `routes/ats.js`, el talón resumen PDF (`/exportar/pdf`) combinaba
intencionalmente `subtotalNoObjeto` + `subtotalExento` en una sola
columna "No Obj." **por espacio** (comentario explícito de una sesión
anterior lo documentaba) — el XML real (`/exportar`) sí las reportaba
separadas en `baseNoGraIva`/`baseImpExe` desde antes, sin bug ahí.
Confirmado con datos de prueba: el XML ya traía `<baseImpExe>25.00</baseImpExe>`
correctamente antes de tocar nada.

**Bug adicional encontrado de paso**: en la sección VENTAS del mismo
talón PDF, la columna "No Obj." salía **siempre en 0.00**, sin importar
los datos reales — `facturas.subtotalNoObjetoIva` nunca se sumaba en el
acumulador `vFact`/`vLiq` de esa tabla (sí se usa correctamente en todos
los demás lugares del sistema: F104, XML del ATS, etc. — era un hueco
aislado de este resumen en particular).

### Fix

- Ensanchado el PDF (márgenes 40→28pt, `PW` 515→539pt) para hacer
  espacio a una columna "Exento" nueva sin apretar las demás.
- `sumarCompras()` y el reductor de NC recibidas ahora acumulan
  `noObj` y `exento` por separado (antes: `noObj += subtotalNoObjeto +
  subtotalExento`).
- Conectado `facturas.subtotalNoObjetoIva` a la columna "No Obj." de
  VENTAS (antes hardcodeada en `'0.00'`).
- La columna "Exento" de VENTAS queda siempre en 0.00 a propósito — el
  SRI no separa exenta de no-objeto para ventas (solo para compras), ya
  documentado desde la investigación del F104; no es un hueco, es el
  diseño real del formulario.

### Verificado

Datos QATEST con una compra (No Obj.=15, Exento=25, ambos distintos de
cero a propósito) y una factura de venta (No Obj.=30) — PDF renderizado
a PNG: compras muestra 15.00/25.00 en columnas separadas, ventas muestra
30.00/0.00 como se espera. XML re-verificado: `<baseImpExe>25.00</baseImpExe>`
correcto (ya lo era antes). `node --test`: 49/49. Datos de prueba
eliminados al terminar.

## 3. Continuación — misma vista "Formulario" para el F103

El usuario dijo "sigue con lo planificado" tras cerrar los puntos 1 y 2
— se interpretó como continuar el mismo patrón recién implementado para
F104, aplicándolo a F103 (que hasta ahora solo tenía resumen + PDF, sin
vista en pantalla tipo formulario, la misma brecha que tenía F104 antes
de esta sesión).

Mismo refactor que F104: se extrajo `casillerosF103(f103)` (función
pura) del handler de `GET /f103/pdf` — ahora la usan tanto `GET /f103`
(expone `data.casilleros`) como el PDF. Nuevo componente
`F103FormularioView` en `Declaraciones.jsx`, mismo toggle
"Resumen | Formulario" que ya tiene F104.

**Bug encontrado y corregido en el propio refactor, antes de que
llegara a producción**: al extraer la lógica, la distinción entre "código
sin casillero confirmado" (marcar `(!)`) y "código con casillero pero sin
casillero de valor retenido, por ser tarifa 0%" (marcar `—`, ej. código
331 dividendos en acciones) se perdía — ambos casos colapsaban al mismo
`null` y salían marcados `(!)` por igual, lo cual habría sido engañoso
(marcar como "sin verificar" un casillero que en realidad SÍ está bien
mapeado, solo que no tiene contraparte de retención). Se agregó un flag
`mapeado: boolean` explícito para distinguir los 2 casos. Detectado
comparando el JSON de prueba contra el PDF antes de dar el cambio por
bueno — no llegó a commitearse la versión con el bug.

### Verificado

3 casos de prueba (303 con casillero completo, 331 mapeado sin casillero
de retenido, 346C sin mapeo) — JSON y PDF confirmados coincidentes:
303→303/353, 331→331/"—", 346C→"(!)"/"(!)". `node --test`: 49/49. `vite
build`: sin errores. Datos de prueba eliminados al terminar.

## Pendiente para retomar

Nada de esto se probó en navegador real. Sugerir al usuario:
Declaraciones → F104 y F103 → toggle "Formulario" (vista nueva en ambos),
y ATS → generar talón PDF de cualquier período con compras No Obj./Exento
para confirmar visualmente las 2 columnas separadas.

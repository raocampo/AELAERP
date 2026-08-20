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

## 4. Continuación — F101 (con investigación previa a implementar)

Tercer "sigue con lo planificado". Dado que F101 es un salto de escala
real frente a F103/F104 (869 casilleros vs ~30-90), se le preguntó al
usuario cómo avanzar antes de escribir código — eligió "investigar la
guía oficial primero" en vez de implementar directo con la propuesta
acotada o pausar del todo.

### Investigación

Se descargó la guía oficial de 177 páginas
(`sri.gob.ec/formularios-e-instructivos`, "Guía Sociedades.pdf") y se
confirmó contra el Excel de diseño (869 filas, ya descargado el
2026-08-19) que el F101 real es un balance completo estilo NIIF
(activos/pasivos/patrimonio desglosados a un nivel que AELA no maneja —
ej. "deterioro acumulado de cuentas por cobrar comerciales
relacionadas", "plantas productoras agricultura") más una sección de
conciliación tributaria (participación a trabajadores 15%, gastos no
deducibles, amortización de pérdidas de años anteriores, ajustes por
precios de transferencia, ISD) que AELA no calcula en ningún lugar hoy.

Se extrajeron los casilleros de los **totales grandes** (los únicos con
una fuente de datos real y verificable en el sistema):
`499` Total Activo, `599` Total Pasivo, `698` Total Patrimonio, `699`
Pasivo+Patrimonio, `6999` Total Ingresos, `7999` Total Costos y Gastos,
`801`/`802` Utilidad/Pérdida del ejercicio, `857` Retenciones de renta
recibidas, `902` Total impuesto a pagar, `999` Total pagado.

### Implementación (alcance acotado, igual honestidad que F103/F104)

`calcularF101()` extraída (antes vivía inline en el handler) — ahora
calcula ingresos/costos **netos de IVA** (antes el resumen viejo
mezclaba `importeTotal` con IVA incluido, lo cual no es el dato correcto
para un casillero de ingresos/gastos), utilidad contable, y retenciones
de renta recibidas (`retenciones_recibidas.totalRetencionRenta`, dato
que ya existía en el sistema pero nunca se usaba para F101).

**Activo/Pasivo/Patrimonio (499/599/698) reutilizan `obtenerBalanceGeneral()`
de Contabilidad** — cruce entre módulos: se colgó la función como
propiedad del router exportado en `contabilidad.js` (`router.obtenerBalanceGeneral = ...`,
antes de `module.exports = router`) en vez de moverla a
`utils/contabilidad.js`, para no tocar el resto de ese archivo. Si el
tenant no tiene Contabilidad activa (plan de cuentas vacío/sin
asientos), `balance` sale `null` y esos 3 casilleros no se muestran —
no se inventa un cero falso.

`GET /f101/pdf` nuevo (mismo patrón que F103/F104), `F101FormularioView`
en el frontend con el mismo toggle. Al final del PDF se listan
explícitamente las categorías completas que quedan fuera (balance
detallado NIIF, conciliación tributaria, IR único de sectores
especializados, partes relacionadas/APS).

### Verificado

Contra el tenant local real (empresaId=1, que sí tiene Contabilidad
activa con asientos): `499/599/698` = $276.54/$66.54/$210.00, cuadrado
(`balanceado: true`) — coincide exacto con lo que ya mostraba
Contabilidad → Balance General. `6999` = $210.00 (neto de IVA, factura
real de julio con subtotal15=$210). Probado también con un año sin
datos (2020): `balance: null`, solo 4 casilleros base, sin error.
`node --test`: 49/49. `vite build`: sin errores. No se tocó ni insertó
ningún dato — todo verificado contra datos reales ya existentes.

## 5. "Camino a AELA PRO" — auditoría de completitud + apertura de ejercicio

El usuario preguntó qué le falta a AELA para cubrir todo lo comercial/
administrativo/financiero/contable/tributario de una PYME. Se armó un
roadmap actualizado (verificado contra el código de hoy, no contra la
auditoría de hace 3 semanas — algunos ítems que esa memoria daba por
pendientes ya estaban hechos) y se publicó como artifact. Recomendación:
empezar por Anticipo de Impuesto a la Renta y Apertura automática de
ejercicio — ambos son cálculo sobre datos que el sistema ya tiene.

### Anticipo de Impuesto a la Renta — bloqueado, hallazgo importante

Antes de escribir código se investigó el Art. 41 de la LRTI (bajado
directo de `sri.gob.ec`, texto oficial codificado). **La fórmula clásica
que se recordaba (0.2% patrimonio + 0.2% costos/gastos + 0.4% activos +
0.4% ingresos) YA NO EXISTE en el texto vigente** — el artículo fue
reformado varias veces (2016 dos veces, 2017) y hoy dice literalmente:
*"El pago del impuesto podrá anticiparse de forma VOLUNTARIA, y será
equivalente al 50% del impuesto a la renta causado del ejercicio fiscal
anterior, menos las retenciones en la fuente efectuadas en dicho
ejercicio"*. Confirmado además con el propio Excel del F101 (casilleros
891/892 "Anticipo de Impuesto a la Renta pagado VOLUNTARIAMENTE").

**Por qué sigue sin implementarse**: aunque la fórmula nueva es más
simple, requiere "impuesto a la renta causado" (casillero 850) como
insumo — y ese valor depende de la conciliación tributaria completa
(participación trabajadores, gastos no deducibles, etc.) que el propio
F101 de esta sesión dejó explícitamente fuera de alcance. Implementar el
anticipo ahora significaría o inventar el impuesto causado (riesgo real)
o bloquearse en la misma conciliación tributaria que ya se decidió no
construir. Se pausa aquí — mismo criterio que la tabla de retenciones
del 2026-07-29 (no adivinar, esperar a tener el dato de entrada
confiable). Se le reportó el hallazgo al usuario en vez de implementar
algo basado en una fórmula que ya no es la ley vigente.

### Apertura de ejercicio siguiente — implementado

Pura mecánica contable de partida doble, sin ninguna ambigüedad legal —
continuación natural de `cerrarEjercicioAnual()` que ya existía. Nueva
`abrirEjercicioSiguiente()` en `contabilidad.js`: encuentra la línea de
resultado del asiento de CIERRE real (leyendo su descripción, no
re-derivando con la misma regex del cierre — evita una posible
inconsistencia si el plan de cuentas cambió entre cierre y apertura), y
traspasa el monto a la cuenta de patrimonio "Resultados/Ganancias
Acumuladas" (busca por `/acumulad/i` entre las cuentas de patrimonio con
movimiento — funciona tanto con el plan base como con el NIIF/Supercías,
que separa "GANACIAS ACUMULADAS" de "(-) PÉRDIDAS ACUMULADAS" en cuentas
distintas). Nuevo `POST /contabilidad/apertura-ejercicio`, botón "📂
Abrir ejercicio" en Contabilidad → Cierre y Estados, junto al de cierre.

**Hallazgo de paso**: la búsqueda de la cuenta de resultado en
`cerrarEjercicioAnual()` (regex `/utilidad|resultado/i`) NO encontraría
ninguna cuenta en el plan NIIF/Supercías — sus cuentas de resultado se
llaman "GANANCIA NETA DEL PERIODO" / "(-) PÉRDIDA NETA DEL PERIODO", sin
las palabras "utilidad" ni "resultado". El cierre de ejercicio podría
estar roto hoy para tenants con el plan Supercías (no confirmado con un
tenant real que lo use — se documenta como sospecha, no como bug
verificado). `abrirEjercicioSiguiente()` no depende de esa regex (usa la
línea real del asiento de cierre), así que no hereda el problema.

### Verificado

Contra el tenant local, en un año 2019 aislado sin datos reales (0
asientos previos) para no arriesgar los libros reales de empresaId=1:
asiento de ingreso QATEST de $500 → cierre 2019 (utilidad $500 →
"Utilidad del Ejercicio") → apertura 2020 (traspasa $500 de "Utilidad
del Ejercicio" a "Resultados Acumulados", ambas cuentas correctas,
partida cuadrada). Verificados también los 2 guardarraíles: apertura
duplicada rechazada, apertura sin cierre previo rechazada con mensaje
claro. Datos de prueba eliminados (cascade delete confirmado). `node
--test`: 49/49. `vite build`: sin errores.

## Pendiente para retomar

Nada de esto se probó en navegador real. Sugerir al usuario:
Declaraciones → F104, F103 y F101 → toggle "Formulario" (vista nueva en
los 3); ATS → generar talón PDF de cualquier período con compras No
Obj./Exento; Contabilidad → Cierre y Estados → probar "Abrir ejercicio"
después de un cierre real. El Anticipo de Impuesto a la Renta queda
pendiente de una decisión: ¿implementar solo la fórmula voluntaria
simple (50% del impuesto causado del año anterior, usando la utilidad
CONTABLE como aproximación del impuesto causado, con la advertencia
explícita de que no incluye conciliación tributaria) o esperar a tener
el impuesto causado real?

## 6. Investigación Anexo RDEP + hallazgo urgente: tabla LORTI de nómina desactualizada

Siguiendo el roadmap "Camino a AELA PRO" (Anexo RDEP como siguiente
candidato, ya que la nómina está completa), se leyeron dos fuentes
oficiales del SRI: el instructivo de generación desde Excel (mecanismo:
plantilla de 2 hojas → exportar XML con Programador/XML Tools de Excel →
subir con DIMM Multiplataforma) y, más importante, la **Ficha Técnica
RDEP 2023** (26 páginas, catálogo completo de campos, descargada de
sri.gob.ec).

### RDEP es más grande de lo que asumía el roadmap

El catálogo real de RDEP pide datos que AELA hoy **no captura en
absoluto** en el modelo `empleados`: discapacidad (tipo/condición/%,
dependiente a quien sustituye), beneficio provincia de Galápagos,
enfermedad catastrófica/rara/huérfana, código de establecimiento SRI,
residencia/país (si es extranjero) y convenio de doble imposición — y,
el más importante, la **proyección de gastos personales por categoría**
(vivienda/salud/educación/alimentación/vestimenta/turismo) que cada
empleado debe declarar y que alimenta una fórmula legal de "rebaja"
(tabla basada en canasta familiar básica × cargas familiares, tope
18%). Ninguno de estos campos existe hoy en el módulo de Empleados.

Una v1 acotada (defaults seguros: residente local, sin discapacidad,
sin Galápagos, gastos personales = 0) es técnicamente construible y
razonable para la PYME típica de AELA — pero es un anexo real que se
presenta al SRI, no un reporte interno: si un empleado real tiene una
discapacidad y el sistema lo reporta como "no aplica" por default, eso
es un error de fondo, no solo una cifra optimista. Se dejó sin
implementar, pendiente de que el usuario decida si vale la pena
capturar esos campos nuevos en Empleados primero.

### Hallazgo no buscado, más urgente: tabla LORTI 2024 desactualizada en producción

Al revisar cómo AELA calcula hoy el Impuesto a la Renta de nómina (para
comparar contra la metodología exacta que pide RDEP), se encontró que
`calcularImpuestoRentaMensual()` en
[backend/routes/talentoHumano.js](../backend/routes/talentoHumano.js)
usaba una tabla LORTI **fechada 2024** (`TABLA_LORTI_2024`), con 8
tramos y tarifa máxima 35%. Esta función corre en cada cálculo de
retención de nómina real — no es un cálculo hipotético para RDEP, es
lo que ya se está usando para pagar sueldos.

Se descargó y leyó la **Resolución NAC-DGERCGC25-00000043** del SRI
(vigente desde 01/01/2026, que actualiza los rangos del Art. 36 LRTI
por la variación del IPC a noviembre 2025). La tabla oficial 2026 tiene
**9 tramos** — todos los umbrales corridos hacia arriba por la
inflación acumulada de 2 años, y agrega un **tramo nuevo del 37%**
(sobre USD 109,956) que no existía en el código.

**Corregido**: se reemplazó `TABLA_LORTI_2024` por `TABLA_LORTI_2026`
con los 9 tramos oficiales, y se corrigió el campo de respuesta
`tablaAnio: 2024` (hardcodeado, quedaba desincronizado del comentario)
a `2026`. Verificado end-to-end: empleado QATEST temporal (salario
$3000, empresaId=1, eliminado después de la prueba) vía
`GET /api/talento-humano/nomina/calcular-ir/:id` — base imponible
$36,078 cae en el tramo 20% (35,136–46,575), IR anual calculado
$2,866.40 = $2,678 + ($36,078−$35,136)×0.20, verificado a mano y
también con un script standalone que compara los 5 límites exactos de
tramo contra los valores oficiales de la resolución — todos coinciden.

No se tocó la metodología de `gastosPersonalesAnuales` (deducción
directa de la base, en vez de la rebaja post-tabla que exige la ley
desde 2022) porque hoy nadie le pasa un valor distinto de 0 — es un
hallazgo dormido, no un bug activo. Si se retoma RDEP, esa fórmula sí
hay que implementarla correcta (tabla CFB × cargas), porque el propio
casillero "Rebaja por gastos personales" del anexo la exige.

### Pendiente

- Anexo RDEP: sin implementar, bloqueado por decisión del usuario sobre
  capturar campos nuevos en Empleados (ver arriba).
- `gastosPersonalesAnuales`: metodología pre-2022, dormida pero
  incorrecta si algún día se activa — documentado, no arreglado hoy.
- La tabla LORTI debe actualizarse cada diciembre con la resolución
  anual del SRI (mismo patrón que `SBU_ECUADOR`, ya documentado en el
  comentario del código).

# AELA ERP — Sesión 2026-08-24 (parte 3) — Anexo RDEP, Fase 1

## Contexto

Tercer pendiente de la sesión, aprobado por el usuario ("Sí, agregar los
campos e implementar") tras el fix de PDFKit y el Anticipo de IR Fase 1.
Bloqueado desde 2026-08-20 porque el modelo `empleados` no capturaba
ninguno de los campos que exige el catálogo real del Anexo RDEP.

## Investigación (fuentes oficiales, leídas directamente hoy)

1. **Esquema XSD oficial del RDEP** (`Esquema RDEP 2023.xsd`,
   sri.gob.ec) — catálogo exacto de campos, tipos y obligatoriedad.
   Confirma los campos nuevos necesarios: `benGalpg` (Galápagos),
   `enfcatastro` (enfermedad catastrófica), `tipoTrabajDiscap`/
   `porcentajeDiscap`/`tipIdDiscap`/`idDiscap` (discapacidad, incluye al
   dependiente a quien el trabajador sustituye), `residenciaTrab`/
   `paisResidencia`/`aplicaConvenio` (residencia fiscal y convenio de
   doble imposición), y 8 campos `deducXxx` de gastos personales por
   categoría (vivienda, salud, educación, alimentación, vestimenta, arte
   y cultura, turismo).
2. **Ficha Técnica RDEP 2024** (PDF, 26 páginas, sri.gob.ec) — prosa
   explicativa de cada campo. Aporta el detalle que el XSD no da:
   - `residenciaTrab`: solo 2 opciones, "01 Residente local" / "02
     Residente en el exterior" (no un rango 00-02 como sugería el XSD).
   - `tipoTrabajDiscap`: solo 3 opciones vigentes desde 2024 —
     "trabajador con discapacidad" / "sustituto" / "no aplica".
   - `aplicaConvenio`: solo obligatorio si es residente en el exterior;
     "con convenio" / "sin convenio", si no aplica ninguno de los dos
     se pone NA.
3. **Boletín SRI NAC-COM-26-006** (6 de febrero de 2026, PDF, fuente
   primaria) — tabla EXACTA y vigente de topes de rebaja de gastos
   personales para el ejercicio 2026 (ver tabla abajo). Confirma que la
   categoría "arte y cultura" es distinta de "educación" (7 categorías
   totales, no 6 como se asumió en la investigación de 2026-08-20), y
   que Galápagos tiene un ajuste especial vía IPCEG (Índice de Precios
   al Consumidor Especial) = 1.803 — no implementado en Fase 1.

## Decisión de alcance (consultada con el usuario)

Dado que el catálogo completo (campos + generador del XML del anexo
real, agregando toda la nómina del año por empleado) es una feature del
tamaño del módulo de restaurante, se consultó al usuario: ¿Fase 1
(campos + UI + fórmula de rebaja correcta) o todo de una vez? Eligió
**Fase 1**.

## Implementación (Fase 1)

### Schema (`backend/prisma/schema.prisma`, modelo `empleados`)

10 campos nuevos: `beneficiarioGalapagos`, `enfermedadCatastrofica`,
`condicionDiscapacidad` (NO_APLICA | TRABAJADOR_CON_DISCAPACIDAD |
SUSTITUTO), `porcentajeDiscapacidad`, `tipoIdDependienteDiscap`,
`idDependienteDiscap`, `residenciaFiscal` (LOCAL | EXTERIOR),
`paisResidencia`, `aplicaConvenioDobleImposicion`,
`gastosPersonalesProyectados` (un solo total agregado en Fase 1 — el
desglose por las 7 categorías del XML real queda para una fase
posterior). Agregado también a `applySchemaFixes.js` (10 `ALTER TABLE`)
y verificado contra BD_principal real: **223 sentencias, 0 errores**.

### Rebaja de gastos personales — fórmula corregida (crédito, no deducción)

`backend/utils/rebajaGastosPersonales.js` — nuevo. La metodología
vigente desde 2022 es un CRÉDITO TRIBUTARIO: se resta del IR anual YA
CALCULADO con la tabla progresiva, no de la base imponible antes de
aplicar la tabla (esa era la metodología pre-2022, que es la que tenía
`talentoHumano.js` — dormida porque nadie le pasaba nunca un valor a
`gastosPersonalesAnuales`, pero la fórmula en sí estaba mal).

Tabla oficial (Boletín NAC-COM-26-006, CFB enero 2026 = $821.80):

| Cargas familiares | Canastas | Tope gastos | Tope rebaja (18%) |
|---|---|---|---|
| 0 | 7 | $5,752.60 | $1,035.47 |
| 1 | 9 | $7,396.20 | $1,331.32 |
| 2 | 11 | $9,039.80 | $1,627.16 |
| 3 | 14 | $11,505.20 | $2,070.94 |
| 4 | 17 | $13,970.60 | $2,514.71 |
| 5 o más | 20 | $16,436.00 | $2,958.48 |
| Discapacidad/enf. catastrófica | 100 | $82,180.00 | $14,792.40 |

`backend/routes/talentoHumano.js` — `calcularImpuestoRentaMensual` ya
NO resta `gastosPersonalesAnuales` de la base; ahora calcula el IR anual
bruto con la tabla, calcula la rebaja con
`calcularRebajaGastosPersonales()`, y la resta del IR ya calculado. Los
3 puntos donde se llama (generación masiva de nómina, edición individual,
calculadora de previsualización) ahora pasan
`gastosPersonalesProyectados`, `cargasFamiliares` y
`tieneDiscapacidadOEnfermedadCatastrofica` (helper `_tieneDiscapacidadOEnfermedad`)
desde el registro real del empleado.

### Rutas de empleados

`POST /empleados` y `PUT /empleados/:id` aceptan y normalizan los 10
campos nuevos vía el helper `_camposRdep(body)` — valida
interdependencias (ej. `porcentajeDiscapacidad` solo se guarda si
`condicionDiscapacidad != NO_APLICA`; `paisResidencia`/
`aplicaConvenioDobleImposicion` solo si `residenciaFiscal = EXTERIOR`).
El PUT solo toca estos campos si el request trae al menos uno (evita
resetear a los valores por defecto en una edición parcial que no toca
discapacidad/residencia).

### Frontend

`frontend/src/components/TalentoHumano/FormEmpleado.jsx` — nuevo
fieldset "ANEXO RDEP — RELACIÓN DE DEPENDENCIA" con los 10 campos,
mostrando/ocultando los condicionales (discapacidad → porcentaje +
tipo/ID del dependiente si es SUSTITUTO; residencia EXTERIOR → país +
convenio) igual que el resto del formulario.

## Verificación

- `node --test`: **60/60** (55 previos + 5 nuevos de
  `rebajaGastosPersonales.test.js`, verificados exacto contra la tabla
  oficial del boletín SRI).
- `npx vite build`: sin errores.
- `applySchemaFixes.js` contra BD_principal real: 223 sentencias, 0
  errores.
- **Contra el pipeline real**: se creó un empleado de prueba
  (QATEST/RDEP, salario $4000, 2 cargas familiares,
  `gastosPersonalesProyectados: 5000`, `beneficiarioGalapagos: true`) y
  se llamó al endpoint real de previsualización de IR
  (`GET /nomina/calcular-ir/:id`). Resultado verificado a mano:
  base imponible $47,944 → IR bruto tabla LORTI $5,307.25 → rebaja 18%
  de $5,000 (dentro del tope de $9,039.80 para 2 cargas) = $900 → IR
  anual neto $4,407.25 → mensual $367.27. Coincide exacto. Empleado de
  prueba eliminado al terminar.
- UI verificada visualmente con Playwright (navegador real): los campos
  condicionales aparecen/desaparecen correctamente, acentos correctos,
  sin desbordes de layout.

## Pendiente para retomar

1. **Fase 2** (no implementada, fuera del alcance acordado hoy):
   desglose de `gastosPersonalesProyectados` en las 7 categorías reales
   del SRI (vivienda/salud/educación/alimentación/vestimenta/arte y
   cultura/turismo) — necesario para el XML real del anexo.
2. **Fase 3**: el generador real del XML del Anexo RDEP contra el XSD
   oficial, agregando toda la nómina del año por empleado.
3. **Ajuste Galápagos** (IPCEG = 1.803) en la fórmula de rebaja — no
   implementado, solo se capturó el checkbox informativo
   `beneficiarioGalapagos` en el empleado.
4. Verificación móvil real del módulo restaurante — sigue siendo el
   último pendiente de la cola, a pedido explícito del usuario.

# AELA ERP — Sesión 2026-07-29 (parte 3) — Auditoría "más PRO": normativa Ecuador + IA

## Contexto

El usuario pidió una revisión amplia: contrastar AELA contra toda la normativa
tributaria/contable/societaria de Ecuador para ver qué falta ("que no falte
nada, que esté funcional para los clientes, más PRO"), y explorar qué se
puede sumar con IA. Se investigó en paralelo (2 agentes en background):
normativa completa (SRI, RIMPE, Supercías, IESS/nómina) y un inventario
exhaustivo del código actual de AELA.

## 🔴 BLOQUEADO — Tabla de retenciones en la fuente (crítico, esperando a la contadora)

**Hallazgo**: la Resolución NAC-DGERCGC26-00000009 (vigente desde
01-mar-2026, texto oficial leído completo desde sri.gob.ec) **derogó** la
tabla de porcentajes de retención de renta que usa AELA hoy en
`backend/utils/sri.js` (`CODIGOS_RETENCION_RENTA`, líneas ~1855-1870:
honorarios 8%, arrendamiento inmuebles 8%, "otras retenciones" 1.75%, etc.
— ese esquema de porcentajes ya no es válido desde hace 5 meses).

**Por qué no se corrigió todavía**: la resolución legal describe los
porcentajes por *categoría de pago* (ej. "servicios donde predomina el
intelecto, personas naturales" = 10%; "servicios profesionales de
sociedades" = 5%), no por el código numérico SRI (303, 304, 307, 310...)
que usa el XML de AELA. Se consultaron 2 fuentes contables que compilan
esa tabla código→porcentaje y **se contradicen entre sí** (ej. código 304:
una dice 10%, otra dice 2%; código 307: una dice 3%, otra dice 8%) —
confirma lo que ya se sospechaba: la ficha técnica oficial del SRI con el
catálogo actualizado aún no está publicada, y cada fuente secundaria está
interpretando la resolución a su manera.

**Decisión**: no se adivinó la tabla — el riesgo de retener el monto
incorrecto a proveedores reales en producción es peor que dejar la tabla
actual (desactualizada pero al menos consistente). El usuario va a
preguntarle a su contadora qué tabla código→porcentaje está usando ella en
la práctica (los contadores ya tuvieron que resolver esto desde marzo, con
o sin ficha técnica oficial — es la fuente más confiable disponible hoy).

**Para retomar**: en cuanto el usuario tenga la tabla confirmada por su
contadora (o el SRI publique la ficha técnica oficial), actualizar
`CODIGOS_RETENCION_RENTA` en `backend/utils/sri.js` — es un cambio simple
y rápido una vez que el dato de entrada sea confiable. Verificar también
si cambiaron los CÓDIGOS en sí (no solo los porcentajes) — algunas fuentes
mencionan códigos nuevos que no existen hoy en AELA (303A, 304A/C/D, 308,
311, 343, 343A/B/C, 344A/B, 3482) — confirmar con la contadora si esos
códigos nuevos aplican o son variantes de fuentes poco confiables.

## Resto de la auditoría (para retomar después, sin prioridad definida aún)

### 🔴 Crítico / riesgo legal
- Sin validación de topes de ingresos por régimen RIMPE (Emprendedor
  $20k–$300k / Negocio Popular ≤$20k) — con la recategorización masiva de
  julio 2026 (~14,000 pasaron a Emprendedor, ~56,000 a régimen general),
  un cliente de AELA puede haber cambiado de régimen sin que el sistema lo
  detecte ni avise.

### 🟡 Alto valor "PRO" (completa el producto, no urgente legalmente)
- **Anticipo de Impuesto a la Renta** (régimen general) — los datos ya
  existen en los estados financieros de AELA (patrimonio, costos/gastos,
  activos, ingresos gravables), es automatizable con lo que ya hay.
- **Anexo RDEP** (relación de dependencia) — depende de completar nómina.
- **Nómina incompleta**: décimo 3°/4° solo se calcula como devengo mensual
  informativo (`talentoHumano.js` — `decimoTerceroProp`,
  `decimoCuartoProp`, `fondosReservaProp`), no hay pago real acumulado ni
  liquidación en la fecha legal; sin acumulación/pago de vacaciones (solo
  se registra como tipo de ausencia); sin utilidades 15% trabajadores; sin
  avisos de entrada/salida IESS; sin liquidación de haberes al terminar
  relación laboral.
- **F101 es solo un resumen orientativo** (el propio código ya lo aclara
  explícitamente, `declaraciones.js:478`), no el formulario oficial
  completo — no calcula conciliación tributaria detallada ni gastos
  deducibles/no deducibles desglosados.
- Sin **Estado de Flujo de Efectivo**, **Estado de Cambios en el
  Patrimonio**, ni **notas a los EEFF**.
- Sin **cierre de ejercicio anual formal** (traspaso automático de utilidad
  del ejercicio a patrimonio + apertura del año siguiente) — solo existe
  cierre/apertura de períodos mensuales y de asientos individuales.

### ⚪ Correctamente fuera de alcance de un ERP (no construir)
Anexo de Dividendos, Anexo ICE, IVA en importaciones (dominio SENAE/aduana),
Impuesto a Activos en el Exterior (solo sector financiero regulado),
trámites 100% legales de Supercías (nombramientos, actas de junta).

### Confirmado que SÍ está bien implementado (sin acción necesaria)
- Los 6 tipos de comprobante electrónico SRI (incluye retención como
  emisor, no solo receptor).
- ATS con manejo diferenciado RIMPE Negocio Popular vs régimen general.
- Distinción RIMPE/Negocio Popular en leyendas obligatorias del XML (Anexo
  22 SRI v2.26) en los 6 tipos de comprobante.
- Balance de Comprobación, Estado de Resultados, Balance General, Libro
  Diario, Libro Mayor, períodos contables, plan de cuentas con semilla
  NIIF/Supercías.

## Ideas de IA propuestas (sin implementar aún, para cuando se priorice)

- Copiloto conversacional sobre los datos propios del tenant ("¿cuánto IVA
  debo declarar este mes y por qué?", "¿por qué no cuadra mi balance?").
- Detección de anomalías contables (facturas duplicadas, montos atípicos,
  proveedores nuevos, compras a cédula sin aprobar hace tiempo).
- Conciliación bancaria asistida (match automático movimientos vs
  asientos, con sugerencias cuando no hay coincidencia exacta).
- Resumen ejecutivo mensual en lenguaje simple para dueños de PYME sin
  formación contable.
- Reforzar con LLM la heurística de clasificación inventariable/gasto en
  compras (ya existe por palabras clave) para los casos ambiguos.
- Predicción de flujo de caja basada en CxC/CxP históricas.

## Confirmado: no existe ninguna integración de IA/LLM hoy en AELA
Búsqueda exhaustiva de "openai", "anthropic", "claude", "gpt-",
"@anthropic-ai" en todo el repo (backend y frontend) — sin resultados en
ningún archivo. Cualquier feature de IA empezaría desde cero.

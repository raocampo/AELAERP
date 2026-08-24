# AELA ERP — Sesión 2026-08-24 (parte 2) — Anticipo de Impuesto a la Renta (Fase 1)

## Contexto

Segundo pendiente bloqueado que el usuario pidió retomar hoy (después del
fix de PDFKit, ver `docs/pendientes-2026-08-24.md`), con instrucción
explícita: **"investigar totalmente para armar ese módulo al 100% bien
realizado y estructurado"**.

## Investigación (antes de tocar código)

1. Se descargó y leyó directamente el texto oficial vigente de la LRTI
   (PDF codificado del SRI, sri.gob.ec, actualizado 2026-04-01) — Art. 41:

   > "El pago del impuesto podrá anticiparse de forma voluntaria, y será
   > equivalente al cincuenta por ciento (50%) del impuesto a la renta
   > causado del ejercicio fiscal anterior, menos las retenciones en la
   > fuente efectuadas en dicho ejercicio fiscal. El valor anticipado
   > constituirá crédito tributario para el pago del impuesto a la
   > renta."

   Confirma lo sospechado: la fórmula clásica 0.2%/0.4% sobre activos/
   patrimonio YA NO EXISTE — es una fórmula única (no varía por tipo de
   contribuyente), 100% voluntaria, sobre el "impuesto a la renta
   causado" del año anterior.

2. También se leyó el Art. 37 (tarifa del IR para sociedades): 25%
   general, con incrementos/reducciones especiales (paraísos fiscales no
   informados +3pp; micro/pequeña empresa, exportador habitual, nueva
   inversión, inversión con contrato -3pp a -8pp) — todas condicionales a
   datos que AELA no registra hoy.

3. Un agente Explore mapeó el código existente: `calcularF101`
   (`backend/routes/declaraciones.js`) solo calcula "utilidad contable"
   (ingresos netos - gastos netos), explícitamente documentado como
   "antes de conciliación tributaria" — nunca calculó "impuesto causado".
   No existe ninguna tabla de gastos no deducibles, participación
   trabajadores, ni pérdidas de años anteriores en el schema.

4. Investigación adicional (web) sobre RIMPE: confirmó que RIMPE tiene su
   propio mecanismo de declaración y anticipo (calendario por noveno
   dígito del RUC, mayo para la declaración anual, julio-septiembre para
   anticipos) — **no usa el Formulario 101** ni el Art. 41 de la misma
   forma. Esto es relevante porque el tenant de prueba real (empresaId=1)
   **es RIMPE**.

## Decisión de alcance (consultada con el usuario)

Para llegar al "impuesto causado" real hacen falta 3 piezas que no
existen hoy: participación trabajadores 15%, gastos no deducibles
marcados, y pérdidas tributarias de años anteriores. Se consultó al
usuario: ¿Fase 1 simple primero, o todo de una vez? Eligió **Fase 1**.

## Implementación (Fase 1)

**Alcance**: participación trabajadores 15% (con datos reales) + tarifa
según régimen, asumiendo $0 en gastos no deducibles y pérdidas de años
anteriores (con advertencia explícita en todos los lugares donde se
muestra el resultado). Solo aplica a régimen general — RIMPE se detecta
y se marca explícitamente "no aplicable" con la razón, en vez de
calcular un número incorrecto silenciosamente.

### Archivos nuevos

- `backend/utils/tablaRentaPN.js` — la tabla progresiva LORTI 2026 y
  `aplicarTablaProgresivaRenta(base)`, extraída de `talentoHumano.js`
  (que la tenía duplicada solo para nómina) a un lugar único — evita que
  quede una copia desactualizada cuando el SRI publique la tabla del año
  siguiente (ya pasó una vez con `TABLA_LORTI_2024` desactualizada hasta
  2026-08-21, ver memoria del proyecto).
- `backend/utils/anticipoIR.js` — `calcularAnticipoIR(f101, empresa,
  config)`, función pura: recibe el resultado ya calculado de
  `calcularF101`, la fila de `empresas` (`tipoContribuyente`) y la fila
  de `configuracion_sri` (`obligadoContabilidad`, `contribuyenteRimpe`).
  Devuelve `{ aplicable: false, motivo }` o `{ aplicable: true,
  participacionTrabajadores, baseImponibleSimplificada, impuestoCausado,
  anticipoSugerido, advertencias: [...] }`.
- `backend/test/anticipoIR.test.js` — 6 tests unitarios: RIMPE no
  aplicable, persona natural no obligada no aplicable, pérdida contable
  no aplicable, sociedad (verificado a mano: utilidad 10000 → 25%
  tarifa → causado 2125 → anticipo 962.50), persona natural con tabla
  progresiva (verificado a mano contra la tabla LORTI 2026), anticipo
  nunca negativo cuando las retenciones superan al causado.

### Archivos modificados

- `backend/routes/talentoHumano.js` — usa
  `aplicarTablaProgresivaRenta` importada en vez de la tabla+loop local
  (mismo resultado, verificado: base $36,078 → $2,866.40, igual que
  antes).
- `backend/routes/declaraciones.js` — `calcularF101` ahora también
  consulta `empresas.tipoContribuyente` y `configuracion_sri`
  (`obligadoContabilidad`/`contribuyenteRimpe`) y agrega
  `f101.anticipoIR = calcularAnticipoIR(...)` al resultado.
  `casillerosF101` agrega 4 filas nuevas (855 participación
  trabajadores, 839 base imponible, 839+ impuesto causado, ANTICIPO)
  **solo cuando `aplicable === true`**. El PDF (`GET /f101/pdf`) muestra
  el motivo en naranja cuando no aplica, o las advertencias cuando sí
  aplica; se actualizó también la lista de "casilleros no incluidos"
  para reflejar que la participación trabajadores ya no está 100% fuera
  de alcance.
- `frontend/src/components/Declaraciones/Declaraciones.jsx` —
  `F101FormularioView` recibe `anticipoIR` y replica en la vista web el
  mismo mensaje/advertencias que el PDF (antes solo existían en el PDF).
  La tabla de casilleros ya renderizaba genéricamente
  (`casilleros.map`), así que las 4 filas nuevas aparecen sin más
  cambios.

## Verificación

- `node --test`: **55/55** (49 previos + 6 nuevos de `anticipoIR.test.js`).
- `npx vite build`: sin errores.
- Cálculo verificado a mano en los tests unitarios (ver arriba).
- **Contra el pipeline real** (empresaId=1, RIMPE en producción local):
  - Estado real (RIMPE): `GET /f101` y `GET /f101/pdf` muestran
    correctamente "no calculado: Contribuyente RIMPE..." — confirmado
    por JSON, por PDF renderizado (pymupdf → PNG) y por la UI web real
    (Playwright, tab "Declaraciones" → F101 → "Formulario").
  - Alternando temporalmente la configuración a `JURIDICA` +
    `obligadoContabilidad=true` + `contribuyenteRimpe=false` (revertido
    exacto al terminar, mismo patrón que la limpieza de datos QATEST de
    la sesión anterior): el PDF calculó correctamente participación
    $33.07, base $187.43, causado $46.86, anticipo sugerido $23.43 —
    verificado a mano, layout sin desbordes, acentos correctos.
  - Alternando a `NATURAL` + `obligadoContabilidad=false`: mensaje "no
    calculado: persona natural no obligada..." correcto.
  - Estado revertido y confirmado idéntico al original antes de cerrar.

## Pendiente para retomar

1. **Fase 2** (no implementada, fuera del alcance acordado hoy): marcar
   gastos no deducibles en compras, y arrastre de pérdidas tributarias
   de años anteriores — ambos necesarios para un "impuesto causado" más
   preciso que el simplificado de Fase 1.
2. Anexo RDEP — aprobado por el usuario para implementar (agregar campos
   a `empleados`: discapacidad, Galápagos, enfermedad catastrófica,
   proyección de gastos personales), **no iniciado aún** — es el
   siguiente pendiente de la cola.
3. Verificación móvil real del módulo restaurante — sigue dejada
   explícitamente para el final.

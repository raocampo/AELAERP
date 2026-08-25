# AELA ERP — Sesión 2026-08-25 — Negocio Popular: bloqueo de facturas + precios con IVA incluido

## Contexto

Continuación directa del caso Deportivo Cat (2026-08-24). El usuario
reportó, con capturas de pantalla:
1. Una nota de venta mostrando "IÃIGUEZ" en vez de "IÑIGUEZ" (nombre de
   cliente corrupto).
2. 3 facturas más emitidas el 24 de agosto (después del fix de ayer)
   que debieron ser nota de venta.
3. Que el catálogo de productos se cargó con IVA desglosado, pero para
   Negocio Popular el precio debe incluir el IVA.

Y pidió, además de corregir lo anterior:
- Bloquear la emisión de facturas automáticamente cuando la empresa es
  Negocio Popular (no solo cambiar el default, ocultarla del todo).
- Que el formulario de producto, para Negocio Popular, solo permita
  ingresar el precio final (con IVA incluido).
- Que si el régimen cambia más adelante (Negocio Popular → régimen que
  sí desglosa IVA, o viceversa), el sistema convierta los precios del
  catálogo automáticamente.

## Investigación previa a implementar

**Encoding roto ("IÃIGUEZ")**: se verificó a nivel de bytes — es una
doble codificación real (UTF-8 de "Ñ" reinterpretado como 2 caracteres
Latin-1 y vuelto a guardar). Se confirmó que es un caso AISLADO (se
escaneó toda la tabla `notas_venta` y `clientes` de la empresa, solo
este registro estaba afectado) — no es un bug del sistema, sino un dato
que ya llegó corrupto (típicamente de copiar/pegar desde otra fuente
con codificación distinta). Corregido revirtiendo la doble codificación
con `Buffer.from(str, 'latin1').toString('utf8')`.

**Hallazgo clave, no reportado por el usuario pero descubierto al
investigar**: `PuntoVenta.jsx` línea 238 calculaba
`total = tipoDocumento === 'factura' ? totalConIva : subtotal` — es
decir, al elegir "Nota de venta" en el POS, el total cobrado real es el
subtotal SIN IVA. Se comparó contra notas de venta reales ya emitidas
antes de esta sesión (ids 3/4/5) y coinciden exacto con el precio del
catálogo tal cual, sin sumar IVA — confirma que el modelo de datos
correcto es: **para Negocio Popular, `productos_servicios.precioUnitario`
debe SER el precio final (con IVA incluido)**, no que el POS deba sumar
IVA al mostrar el total. Esto hace coherentes todos los pedidos del
usuario en un solo modelo consistente, sin necesidad de tocar la lógica
de cálculo del POS.

## Implementación

### 1. Bloqueo real de facturas para Negocio Popular

- `backend/utils/configuracionSistema.js` (`obtenerConfiguracionSistemaOperativa`):
  ahora también consulta `configuracion_sri` y expone `negocioPopular`/
  `contribuyenteRimpe` en el mismo objeto "sistema" que ya usa todo el
  frontend (antes solo vivían en `configuracion_sri`, invisibles fuera
  de la pantalla de Configuración SRI).
- `backend/routes/facturas.js` (`POST /`): rechaza con 400 explícito si
  `config.negocioPopular` es verdadero — **esta es la protección real**,
  no se puede sortear llamando la API directamente aunque la UI la
  oculte.
- Frontend — oculta la opción/entrada a "Nueva Factura" en los 4 lugares
  donde existía: `PuntoVenta.jsx` (selector del POS, y fuerza
  `nota_venta` aunque `documentoPosDefault` quedara mal configurado),
  `ListaFacturas.jsx` (botón "+ Nueva Factura"), `FinanzasHub.jsx`
  (tarjeta del hub financiero), `QuickBar.jsx` (accesos rápidos de
  Dashboard/Facturas/Clientes).

### 2. Producto — precio con IVA incluido para Negocio Popular

- `GestionProductos.jsx`: la etiqueta del campo de precio cambia a
  "Precio de venta (incluye IVA)" con una nota aclaratoria cuando la
  empresa es Negocio Popular; el selector de IVA se mantiene pero se
  marca "(referencial)" — no se elimina porque sigue siendo necesario
  para la fórmula de conversión automática si el régimen cambia después
  (punto 3) y para reportes de costos.

### 3. Conversión automática de precios al cambiar de régimen

- `backend/routes/facturas.js` (`PUT /configuracion`): detecta si
  `negocioPopular` cambió de valor al guardar (antes vs. después). Si
  cambió, recalcula TODO el catálogo de esa empresa en un solo
  `UPDATE`:
  - Pasa a Negocio Popular: `precioUnitario = ROUND(precioUnitario × (1 + tarifaIva/100), 2)`
    (de base sin IVA a precio final).
  - Sale de Negocio Popular: `precioUnitario = ROUND(precioUnitario / (1 + tarifaIva/100), 2)`
    (de precio final a base sin IVA).

### 4. Correcciones de datos en producción (Deportivo Cat, empresaId=4)

- Corregido el registro con doble codificación (nota de venta id 26 y
  el cliente que se creó automáticamente desde ella).
- Las 3 facturas del 24 de agosto (ids 36/37/38, `PENDIENTE_FIRMA`, sin
  autorizar) se anularon y se recrearon como notas de venta (mismo
  patrón que las 9 de ayer — precio unitario con IVA incluido para que
  el total coincida con lo cobrado real).
- Los 205 productos del catálogo se convirtieron de precio sin IVA a
  precio con IVA incluido con el mismo `UPDATE` de la conversión
  automática (ejecutado directo porque el régimen ya estaba marcado
  como Negocio Popular desde ayer, así que no hubo una "transición" que
  disparara la lógica nueva — este fue el ajuste puntual pedido
  explícitamente "directo en la BD").

## Verificación

- `node --test`: 62/62 (sin tests nuevos — la lógica nueva es a nivel
  de ruta, no de función pura extraída; se verificó contra el pipeline
  real de producción, ver abajo).
- `npx vite build`: sin errores, 2 veces (antes y después del ajuste de
  producto).
- Contra producción real (Deportivo Cat): las 3 facturas corregidas
  (diferencia de 1-2 centavos por redondeo, igual que el caso de ayer),
  205 productos con precio verificado a mano (ej. $19.13 → $22.00,
  $20.87 → $24.00 con 15% IVA), encoding corregido.
- Pendiente verificar visualmente en el navegador tras el deploy de
  Railway (el fix de datos ya está en producción real desde que se
  ejecutó; el fix de código —bloqueo de facturas, UI oculta, conversión
  automática— recién queda activo cuando Railway despliegue este commit).

## Pendiente para retomar

1. Verificar en el navegador, después del deploy, que el POS de
   Deportivo Cat ya no muestra "Factura" como opción.
2. Si se reporta otro cliente con nombre corrupto tipo "IÃ...", revisar
   si es un patrón recurrente (ej. un dispositivo/navegador específico
   del negocio) en vez de asumir que siempre es un caso aislado como
   este.
3. La conversión automática de precios (punto 3) no se ha probado
   todavía con una transición real (RIMPE→Negocio Popular o viceversa)
   en producción — se verificó la fórmula directamente, pero no el
   flujo completo end-to-end disparado por el checkbox.

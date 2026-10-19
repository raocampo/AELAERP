# Sesión 2026-10-19 — Lavatodo Limón sin entrada de inventario

## Causa confirmada

La línea de jabón Lavatodo Limón estaba vinculada al producto correcto del
catálogo, pero ese producto tenía `inventariable: false`. El pendiente de compra
se había resuelto asignando el producto, con `movimientoInventarioId: null`.
La línea conservaba `inventariable: false` y `movimientoAplicado: false`.

En Detalle de Compra, “Sin integrar” indica que falta `productoId`; “No” indica
que el producto está vinculado, pero no tiene activado el control de inventario.
El helper de movimientos omite los productos no inventariables y, en este caso,
la consulta confirmó stock cero y ningún movimiento previo para el producto.

## Corrección autorizada y completada

Se autorizó activar el control de inventario y registrar únicamente las ocho
unidades de la compra señalada. Se realizó en una transacción, con bloqueo de
las filas afectadas, validación del estado actual y respaldo local previo:

- Producto marcado como inventariable.
- Una entrada de ocho unidades usando `aplicarMovimientoInventario`.
- Costo tomado de la línea de compra; precio de venta conservado.
- Línea de compra actualizada a `inventariable: true` y
  `movimientoAplicado: true`, manteniendo el producto asignado.
- Contador de movimientos de la compra incrementado una vez.
- Pendiente resuelto vinculado al movimiento creado.
- Auditoría registrada para el producto y la compra.

## Verificación

Lectura posterior de producción: stock de 0 a 8, exactamente un movimiento de
entrada, ocho unidades y referencia a la compra correcta. Se comprobó que las
demás líneas de la compra no cambiaron. La bandera de movimiento aplicado y el
vínculo del pendiente permiten reconocer la entrada al reprocesar la compra.

Los respaldos y el script puntual permanecen en `backups/`, excluido de Git.
La corrección afecta configuración y datos; el control de stock sigue dependiendo
de la configuración de cada producto. No requiere despliegue de código.

# Factura: teléfono del comprador demasiado largo — 2026-10-21

## Causa confirmada

La captura del formulario de Corp Simtelec muestra el error de Prisma al
ejecutar `facturas.create`: un valor supera el tamaño de su columna.
El teléfono tiene dos números separados por punto y coma y espacio, con
21 caracteres en total. El formulario permite 50, pero la BD principal de
`corpsimtelec` (`railway`) tenía `facturas.telefonoComprador` como VARCHAR(20).
La consulta de `information_schema`, de solo lectura, confirmó el límite.

También tenían límite 20 `clientes.telefono` y `directorio_global.telefono`.
Ampliar solo la factura dejaría fallos al conservar o reutilizar ese contacto.
El error sucede al guardar, antes de la transmisión al SRI.

## Implementación

- Los tres campos se definen como VARCHAR(50) en el esquema Prisma.
- La migración `20261021000000_ampliar_telefonos_contacto` amplía únicamente
  campos VARCHAR de menor tamaño dentro del esquema activo. Conserva los datos,
  los valores NULL y las instalaciones que ya tengan VARCHAR mayor o TEXT.
- `applySchemaFixes.js` ejecuta el mismo archivo SQL al arrancar, después de
  crear las tablas, para cubrir también los tenants creados con `db push`.
- Facturación y alta/edición de clientes normalizan únicamente los espacios
  exteriores. Se conservan números, separadores, prefijos y extensiones.
- Los valores que superen 50 caracteres o no sean texto reciben HTTP 400 con
  un mensaje claro. En facturación se comprueba antes de reservar secuencial
  o registrar venta, caja e inventario.
- Un P2000 restante se comunica sin mostrar la invocación interna de Prisma.
- El formulario de clientes usa el mismo máximo de 50 que el de facturación.

En el flujo anterior, el secuencial se reserva antes del INSERT de la factura;
un intento fallido podía dejar un salto. Esta corrección valida antes de esa
reserva. No requiere renumerar ni emitir automáticamente comprobantes.

## Validación

- Backend: **195/195 pruebas aprobadas**, incluidas diez nuevas para teléfonos
  múltiples, límites, tipos inválidos, conservación en XML/factura/cliente/
  directorio, validación sin escrituras y mensajes de error.
- PostgreSQL local: error 22001 reproducido con un campo VARCHAR(20); después
  de ejecutar el SQL real se guardan los dos números íntegros en las tres
  tablas. Verificados repetición de la migración, conservación de NULL y
  ausencia de reducción de VARCHAR(100)/TEXT con datos más largos.
- La prueba SQL usó un esquema aislado dentro de una transacción revertida;
  se comprobó que ese esquema no queda creado al finalizar.
- `prisma validate`, compilación del frontend y ESLint del componente cambiado:
  correctos.

La aplicación del esquema en producción corresponde al despliegue automático
del commit. La comprobación posterior consiste en consultar los tres límites
de columna y la salud del backend, sin emitir una factura real de prueba.

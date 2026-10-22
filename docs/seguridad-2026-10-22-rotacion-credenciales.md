# Rotación de credenciales de AELA — 2026-10-22

## Alcance y resultado

Continuación de la [contención del día anterior](seguridad-2026-10-21-incidente-railway.md).
El usuario autorizó renovar las credenciales, guardar las nuevas en `.env.local`
y preservar la disponibilidad. Ese archivo está excluido de Git; su
`DATABASE_URL` sigue apuntando a desarrollo local. Las conexiones de producción
se guardan con el prefijo `RAILWAY_`.

Se comprobó acceso real a la BD principal, al catálogo y a los cuatro tenants
activos con credenciales nuevas. PostgreSQL no se reinició:
`pg_postmaster_start_time()` sigue siendo el 22 de agosto de 2026. El proxy TCP
público continúa eliminado. No se emitieron facturas ni se enviaron correos de prueba.

| Credencial | Estado comprobado |
| --- | --- |
| `JWT_SECRET` | Nueva y activa. Invalida las sesiones anteriores; requiere iniciar sesión nuevamente. |
| `SUPER_ADMIN_KEY` | Nueva: HTTP 200 con consulta real. Anterior: HTTP 401. |
| `DB_ENCRYPT_KEY` | Nueva y activa; cinco registros legibles exclusivamente con ella. `DB_ENCRYPT_KEY_PREVIOUS` tiene valor vacío. |
| Usuario de BD de AELA | `aela_app_20261022`, activo en las tres conexiones principales y los cinco registros del catálogo. |
| Contraseña administrativa `postgres` | Renovada en el motor y en Railway. Nueva válida; anterior rechazada con `28P01`. Cero sesiones del administrador al comprobar. |
| Gmail de respaldo | Contraseña nueva autenticada desde el equipo y configurada en el contenedor. El transporte SMTP del contenedor no funciona; ver limitación de red. |
| Resend principal | Clave nueva activa y autenticada desde el contenedor; guardada también en `.env.local`. No se enviaron correos de prueba. |

El usuario confirmó la revocación de las claves anteriores de Resend y Gmail.
Se verificó después: Resend rechaza la anterior como inválida y Gmail con
error SMTP 535; las dos nuevas siguen autenticando. Sustituir variables en
Railway por sí solo no las habría revocado en origen.

## Despliegues y continuidad

El proyecto permite desplegar: `247f0f77-6ea3-4681-aa45-a64ba9ca56c5`, commit
`b77cc3b`, terminó en `SUCCESS`. Incluye la corrección de teléfonos de
facturación que había quedado bloqueada por la pausa del día anterior.

El código compatible con la transición de cifrado se publicó en `eed70a2`.
Después se cambiaron secretos y conexiones mediante despliegues coordinados.
`fcd08260-8276-4dc8-8f58-85ecef3f6f37` quedó en `SUCCESS` con el usuario nuevo
para las tres conexiones y sin la clave AES anterior. El despliegue precedente
ya estaba retirado antes de renovar la contraseña administrativa.

Para aplicar variables sin reconstruir código se usó `deploymentRedeploy` con
`usePreviousImageTag: true`. Se comprobó el entorno resultante: recibió las
variables nuevas. La CLI `redeploy` observada inició una reconstrucción; aceptar
la solicitud no demuestra que una credencial esté activa.

El despliegue de Resend `8122e4f8-2b2c-41e8-b607-d59dd9707ac0` terminó en
`SUCCESS`. A las 22:46 UTC se verificaron las cinco claves nuevas en el
contenedor, la autenticación de Resend por HTTPS y las conexiones reales a
los cuatro tenants. La versión anterior quedó retirada.
Las verificaciones son puntuales; no acreditan todas las operaciones de todos
los clientes ni sustituyen monitoreo continuo.

## PostgreSQL: cambio coordinado con dos usuarios

Se siguió el método de la
[guía oficial de rotación sin interrupción](https://docs.railway.com/guides/rotate-credentials-zero-downtime):
crear un segundo usuario, trasladar consumidores, comprobarlos y retirar la
credencial anterior. Esto permitió evitar el reinicio que provoca Regenerate.

1. Crear `aela_app_20261022` con contraseña aleatoria nueva. Conserva los
   privilegios de superusuario que ya tenía la conexión de la aplicación.
   Hay dos usuarios con login y superusuario, administrador y aplicación,
   ambos esperados. Esta intervención no reduce permisos.
2. Verificar conexiones nuevas a la BD principal y las cuatro BDs de tenants.
3. Actualizar en una transacción los cinco registros de `aela_master.tenants`
   —cuatro activos y uno inactivo del mismo servidor— con usuario y contraseña
   nuevos, cifrada con la clave AES nueva. Respaldar antes los valores originales.
4. Configurar `APP_DATABASE_URL` con el usuario nuevo. `DATABASE_URL`,
   `DATABASE_MASTER_URL` y `DATABASE_ADMIN_URL` la referencian conservando sus
   parámetros. Desplegar y verificar conexiones reales.
5. Una vez retirada la versión anterior, renovar la contraseña del rol
   `postgres` en SQL y sincronizar `Postgres.POSTGRES_PASSWORD` en Railway con
   `skipDeploys: true`. No reiniciar PostgreSQL. `PGPASSWORD` y las URLs
   derivadas conservan sus referencias a esa variable.
6. Abrir una conexión nueva con la contraseña nueva y rechazar la anterior
   específicamente con `28P01`. Cerrar únicamente sesiones del rol anterior;
   en ese momento había cero. La aplicación usa el otro rol.

La renovación administrativa se completó entre las 22:41 y 22:42 UTC
(17:41–17:42 de Ecuador). Se usaron verificadores SCRAM para que las sentencias
SQL no incluyeran contraseñas en texto claro. El procedimiento tenía recuperación
coordinada de motor y variable si fallaba la actualización de Railway.
No se eliminó el rol `postgres`, propietario de objetos del sistema.

No ejecutar un `ALTER USER` aislado ni cambiar solo una variable en una futura
rotación: motor y consumidores deben quedar sincronizados. La URL pública
derivada no permite conexión externa porque el proxy fue eliminado.

## Transición del cifrado del catálogo

`DB_ENCRYPT_KEY` protege `aela_master.tenants.dbPass`. Cambiarla sin migrar esas
filas impediría abrir las BDs de los tenants.

`utils/cifrado.js` admite temporalmente `DB_ENCRYPT_KEY_PREVIOUS` para lectura;
las escrituras usan la actual. La autenticación AES-GCM sigue rechazando
alteraciones. `descifrar(valor, { permitirClaveAnterior: false })` comprueba
que un registro ya no depende de la clave anterior.

`node scripts/rotarCifradoTenants.js` revisa sin escribir; `--apply` migra en una
transacción con bloqueo de filas y límites de espera; `--check` exige lectura
con la actual. Un registro inválido revierte toda la migración. Este script
cambia cifrado, no contraseñas del motor.

Aquí el cambio de usuario y el cifrado de las cinco entradas se realizaron
juntos en una transacción. Después, `--check` confirmó cinco actuales y cero
pendientes. Se retiró el valor anterior del entorno y se repitió la lectura
estricta desde el contenedor resultante.

## Correo y revocaciones

La clave nueva de Resend tiene permiso de envío. La API la autentica y rechaza
listar claves con `restricted_api_key`, lo esperado para ese permiso. Difiere
de la anterior y está guardada como `SMTP_PASS_NUEVA` y `SMTP_PASS` en
`.env.local`, y como `SMTP_PASS` en Railway. Tras el despliegue se verificaron
su valor en el contenedor y su autenticación desde allí. Sin enviar un correo,
no se acredita entrega a un destinatario.

La contraseña nueva de Gmail autentica con Nodemailer desde el equipo local;
se guardó como `SMTP_PASS_BACKUP_NUEVA` y `SMTP_PASS_BACKUP`. Desde el backend
no llegó al servidor: falló la conexión IPv6 con `ENETUNREACH` al puerto 587.
Además, el workspace es Hobby y la
[documentación de Railway](https://docs.railway.com/networking/outbound-networking)
restringe SMTP a planes Pro o superiores. No se cambió el plan ni la red.
El envío principal usa Resend por HTTPS.

Con la nueva de Resend activa, el usuario revocó las anteriores de Resend y
Gmail desde sus cuentas. A las 22:48 UTC se verificó que Resend rechaza la
anterior con HTTP 400, `validation_error` y mensaje de clave inválida; la nueva
autentica con su permiso de envío. Gmail acepta la nueva y rechaza la anterior
con SMTP 535. Estas comprobaciones solo autentican: no envían mensajes.

La revisión de actividad de las cuentas de correo queda pendiente de acceso
al proveedor: la clave de Resend disponible solo permite envío y no hay
navegador conectado. No se confundió esa limitación con un fallo de la clave.

## Evidencia y validación

- Backend: 198 pruebas correctas, incluidas transición entre claves, retirada
  de la anterior y rechazo de datos alterados.
- PostgreSQL local aislado: revisión sin escritura, migración de valores
  anteriores y heredados, comprobación estricta, idempotencia y rollback real
  ante registro inválido o fallo intermedio. También cambio de rol, login SCRAM,
  rechazo de contraseña anterior y recuperación. Objetos temporales eliminados.
- Producción: web y health HTTP 200; consulta real a BD principal y catálogo
  correcta; clave administrativa anterior HTTP 401. Health solo no consulta BD.
- Cuatro tenants: consultas de solo lectura correctas. Conteos de
  usuarios/empresas conservados: `mprq` 1/1, `lsac` 2/15, `sys` 3/1 y
  `labsanjose` 3/1. Cinco entradas del catálogo con usuario y cifrado nuevos.
- Administrador: contraseña nueva válida; anterior rechazada con `28P01`;
  variable del motor y `PGPASSWORD` coinciden con el reemplazo local.
  Proxy público ausente y PostgreSQL sin reinicios durante la intervención.

Los respaldos de configuración y catálogo se cifraron con DPAPI para el usuario
actual de Windows en `backups/`, excluido de Git. Las comprobaciones registran
fechas, estados y metadatos sin publicar secretos. La revisión inicial de logs
del día anterior tuvo cobertura limitada. Estas pruebas funcionales no
demuestran ausencia de accesos no autorizados.

La revisión final, a las 22:47 UTC, consultó las fuentes disponibles:

- Auditoría Railway desde el 21 de octubre: 23 eventos y ninguna página
  adicional; 17 autenticaciones SSH, cuatro redespliegues y dos despliegues
  creados. Son categorías usadas durante esta intervención; esos metadatos
  solos no permiten atribuir toda actividad ni descartar acceso externo.
- Logs PostgreSQL del 22 de octubre, filtro `authentication failed`, máximo
  500: un rechazo del usuario `postgres` al comprobar deliberadamente la
  contraseña antigua. Ningún rechazo de otro usuario en esa consulta.
- Logs HTTP desde las 22:41 UTC hasta la consulta final, máximo 100 errores:
  cero respuestas 5xx. Esto no cubre toda la jornada ni todas las operaciones.
- La revisión de actividad en los proveedores de correo sigue pendiente de
  acceso a sus cuentas. La revocación de las dos credenciales anteriores sí
  fue confirmada por el titular y comprobada técnicamente después.

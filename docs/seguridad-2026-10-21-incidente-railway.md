# Incidente de Railway: inventario y respuesta — 2026-10-21

## Estado y alcance

Railway confirmó posible acceso no autorizado a variables de entorno, incluso
al contenido descifrado de algunas. Recomienda renovar secretos y revisar
actividad: [aviso oficial](https://blog.railway.com/p/security-disclosure-wednesday-october-21st).
El aviso no confirma por sí solo acceso a las bases de datos de AELA.

Continuación del trabajo: [rotación coordinada del 22 de octubre](seguridad-2026-10-22-rotacion-credenciales.md).

Esta intervención identifica credenciales configuradas en el servicio AELAERP,
revisa sus dependencias y cierra el acceso público de PostgreSQL. Solo se
registran nombres y presencia; no se guardan valores de secretos en este
documento ni en Git. La rotación, revocación y revisión completa de actividad
siguen pendientes. No se cambiaron credenciales ni se reiniciaron servicios.

## Contención aplicada sin despliegue

El usuario confirmó que los clientes usan AELA por la web y que no hay programas
externos conectados directamente a la base de datos. Solicitó preservar la
continuidad mientras los despliegues están pausados.

El 21 de octubre de 2026, aproximadamente a las 21:45 de Ecuador (22 de octubre,
02:45 UTC), se eliminó únicamente el proxy TCP público de PostgreSQL del
proyecto AELA, entorno production. Se respaldaron su configuración y el estado
de los servicios en archivos locales de `backups/`, excluidos de Git.

Comprobaciones realizadas:

- Antes del cierre, `DATABASE_URL`, `DATABASE_MASTER_URL` y `DATABASE_ADMIN_URL`
  apuntaban a hosts privados de Railway. Los cuatro tenants activos también
  tenían hosts privados y contraseñas cifradas en el catálogo.
- Después del cierre, la API de Railway devolvió cero proxies TCP para ese
  servicio PostgreSQL. Un intento nuevo de conexión externa a la entrada
  anterior recibió `ECONNRESET`; antes del cierre se podía consultar la BD.
- La web y `/api/health` respondieron HTTP 200 antes y después. Además,
  `/api/super-admin/stats` ejecutó consultas reales al catálogo y respondió
  correctamente en ambos momentos. No se emitieron facturas ni correos como
  parte de estas comprobaciones.
- AELAERP y PostgreSQL conservaron sus deployments activos, ambos en estado
  `SUCCESS`. La operación no necesitó un build ni reiniciar la BD.

Esta medida retira una entrada directa desde Internet; las conexiones privadas
de la aplicación siguen disponibles. El acceso de mantenimiento desde equipos
externos por la URL pública anterior también queda deshabilitado. Si vuelve a
ser necesario, habrá que planificar un acceso controlado; no reabrirlo como
parte de una verificación rutinaria.

No se comprobaron todas las operaciones de cada cliente. La evidencia acredita
la disponibilidad de la web y la consulta al catálogo, junto con la
configuración privada de los tenants. La recomendación de mantener internos los
servicios de datos está documentada en la
[guía de protección de producción de Railway](https://docs.railway.com/guides/lock-down-production-project).

## Revisión inicial de actividad

Se preservaron metadatos de roles, sesiones y configuración de logs mediante
una transacción de solo lectura antes de cerrar el acceso público. La revisión
identificó un único rol con login y privilegios de superusuario, compartido por
las conexiones de los tenants. Es necesario considerar todos sus consumidores
al renovar la contraseña.

La consulta del historial de auditoría de Railway para este proyecto desde
el 21 de octubre a las 00:00 UTC devolvió cero eventos. La extracción de hasta
500 entradas de logs PostgreSQL con el filtro `authentication failed` desde
esa misma hora también devolvió cero entradas. Estos resultados están
limitados por la disponibilidad y cobertura de las fuentes: no prueban ausencia
de acceso no autorizado, especialmente si se usaron credenciales válidas. No
se completó la revisión de actividad de los proveedores de correo.

## Próxima intervención

La renovación coordinada de secretos queda pendiente para el 22 de octubre de
2026 en horario de Ecuador, condicionada a que Railway permita actualizar los
servicios y comprobar sus consumidores. No hay ejecución automática programada.
La pausa de builds seguía vigente en la actualización oficial de las 02:19 UTC
del 22 de octubre (21:19 del día 21 en Ecuador).

El cierre de la entrada pública no revoca contraseñas ni claves de correo,
sesiones o administración. Es una contención parcial; siguen aplicando las
acciones de rotación y revisión descritas a continuación. La regeneración de
PostgreSQL reinicia la BD y corta conexiones, por lo que se difirió para
coordinarla con los consumidores y la restricción de continuidad del usuario.

## Inventario confirmado

| Variables presentes | Uso y dependencia |
| --- | --- |
| `DATABASE_URL`, `DATABASE_MASTER_URL`, `DATABASE_ADMIN_URL` | Conexiones operativas, catálogo SaaS y administración PostgreSQL. Mapear cada rol y sus consumidores antes del cambio. |
| `SMTP_PASS` | Clave Resend usada por el envío HTTP. Revocar en Resend y crear reemplazo con permisos de envío limitados al dominio necesario. |
| `SMTP_PASS_BACKUP` | Credencial del correo SMTP de respaldo. Revocar y renovar en el proveedor correspondiente. |
| `JWT_SECRET` | Firma de sesiones. El reemplazo exige que los usuarios vuelvan a iniciar sesión una vez actualizado el backend. |
| `SUPER_ADMIN_KEY` | Acceso administrativo a la plataforma SaaS. Sustituir y actualizar los accesos administrativos que la usan. |
| `DB_ENCRYPT_KEY` | AES-256-GCM para las contraseñas `dbPass` del catálogo de tenants. Requiere migración de esos datos cifrados junto con el cambio de clave. |

`SMTP_USER` y `SMTP_USER_BACKUP` también están configuradas; son identificadores,
no contraseñas. Variables como PORT, dominio o remitente no se convierten en
secretos por estar almacenadas junto a las claves.

## Orden de actuación propuesto

1. Preservar el historial relevante de Railway y de los proveedores, y registrar
   los consumidores de cada credencial, incluyendo desarrollo local y CI.
   Esto acompaña la contención; no sustituye ni debe postergar la revocación.
2. Revocar los secretos potencialmente expuestos y emitir reemplazos en sus
   servicios de origen. La clave antigua sigue siendo válida si únicamente se
   cambia el texto de una variable. Prever una interrupción de correo o
   facturación si el proceso activo aún depende de la credencial revocada.
3. Para PostgreSQL usar el mecanismo **Regenerate** de Railway y coordinar los
   consumidores; no cambiar solo una URL ni ejecutar un ALTER USER aislado.
   El procedimiento reinicia la BD y los servicios dependientes necesitan
   recoger la nueva contraseña. Referencia:
   [guía oficial de rotación PostgreSQL](https://blog.railway.com/p/security-disclosure-recommendation-rotate-postgresql-database-credentials).
4. Actualizar las tres conexiones de AELA y las entradas de conexión de los
   tenants que utilicen el rol renovado. `config/prismaTenant.js` obtiene su
   contraseña del catálogo, no de `DATABASE_URL` directamente.
   `scripts/fixTenantCredentials.js` solo corrige entradas con host localhost;
   no es una herramienta general de rotación de todos los tenants.
5. Migrar las contraseñas cifradas antes/durante el cambio coordinado de
   `DB_ENCRYPT_KEY`. Cambiarla sola hace ilegibles las entradas anteriores.
   Conservar un respaldo protegido para recuperación fuera de los sistemas
   potencialmente afectados; nunca copiar claves o contraseñas al repositorio.
6. Sustituir las claves JWT y de administración, actualizar consumidores y
   desplegar los procesos que necesiten recibir los secretos nuevos.
7. Verificar acceso funcional a BD principal y tenants, administración y correo
   con las nuevas credenciales. `/api/health` responde sin consultar PostgreSQL:
   un 200 de esa ruta no acredita que la rotación de BD funcionó.

Los builds permanecían pausados al consultar el
[estado oficial del incidente](https://status.railway.com/incident/QH8L8B3E).
Editar Variables no actualiza por sí solo el entorno de un contenedor ya
ejecutándose. La revocación puede ser necesaria antes de que sea posible
recuperar el servicio con un despliegue; esa interrupción debe coordinarse.

## Revisión de actividad pendiente

- Railway: accesos y cambios de variables, miembros, conexiones, despliegues y
  credenciales de registro no reconocidos. Conservar las evidencias disponibles.
- PostgreSQL: sesiones, roles, autenticación y cambios inesperados. La falta de
  logs de accesos exitosos no demuestra ausencia de acceso.
- Resend y correo de respaldo: envíos no reconocidos, consumo y actividad de
  cuenta. El éxito de un envío habitual no descarta uso de la misma clave por
  terceros.
- Repositorios, registros privados y otros proveedores cuyas claves estuvieran
  en Railway: revisar accesos y renovar sus credenciales, si aplica.
- Si hay indicios de acceso a la BD, ampliar la investigación a las credenciales
  SRI y certificados almacenados allí; no asumir que solo estuvo expuesto el
  servicio de correo.

Railway también comunicó un restablecimiento de credenciales de buckets y
conexiones GitHub. Revisar la reconexión de GitHub y los servicios afectados
según la [guía oficial de recuperación](https://blog.railway.com/p/security-disclosure-recommendation-redeploy-buckets-and-reconnect-github-after-the-credential-reset).
Eso no sustituye la rotación de las credenciales propias de AELA.

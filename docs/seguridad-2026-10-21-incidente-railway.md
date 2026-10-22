# Incidente de Railway: inventario y respuesta — 2026-10-21

## Estado y alcance

Railway confirmó posible acceso no autorizado a variables de entorno, incluso
al contenido descifrado de algunas. Recomienda renovar secretos y revisar
actividad: [aviso oficial](https://blog.railway.com/p/security-disclosure-wednesday-october-21st).
El aviso no confirma por sí solo acceso a las bases de datos de AELA.

Esta intervención identifica credenciales configuradas en el servicio AELAERP
y revisa sus dependencias en el código. Solo se registran nombres y presencia;
no se guardan valores de secretos en este documento ni en Git. La rotación,
revocación y revisión completa de actividad siguen pendientes. No se cambiaron
credenciales ni se cerraron sesiones durante esta revisión.

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

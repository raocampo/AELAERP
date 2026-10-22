# Rotación de credenciales de AELA — 2026-10-22

## Alcance

Continuación de la [contención del día anterior](seguridad-2026-10-21-incidente-railway.md).
El usuario autorizó renovar las credenciales, guardar las nuevas en `.env.local`
y reducir la interrupción a los clientes. Ese archivo está excluido de Git.
Su `DATABASE_URL` de desarrollo local se conserva: no debe reemplazarse por una
conexión de producción inaccesible desde el equipo.

## Despliegues y disponibilidad

La API de Railway identifica este workspace como Hobby. Aunque el estado
general todavía indicaba restricciones para ese plan, el intento de desplegar
el commit `b77cc3b` fue aceptado y entró en construcción. La confirmación
definitiva requiere un deployment `SUCCESS` y consultas correctas a la BD;
la aceptación de la solicitud por sí sola no basta.

Se verificaron desde el contenedor consultas de solo lectura al catálogo y a
los cuatro tenants activos por red privada. PostgreSQL conserva cero proxies
TCP públicos. No se reabrió el acceso externo para realizar el mantenimiento.

## Cifrado de contraseñas de tenants

`DB_ENCRYPT_KEY` protege `aela_master.tenants.dbPass`. Cambiarla sin migrar esas
filas impediría abrir las bases de datos de los tenants.

Se añadió soporte temporal de `DB_ENCRYPT_KEY_PREVIOUS` a `utils/cifrado.js`:
las escrituras siempre usan la clave actual; las lecturas pueden aceptar la
anterior durante el cambio. La autenticación AES-GCM sigue rechazando datos
alterados. La opción `permitirClaveAnterior: false` permite comprobar que una
fila ya puede leerse sin la clave antigua.

Procedimiento:

1. Desplegar el código compatible antes de migrar los registros.
2. Configurar la clave nueva como actual y la anterior como respaldo temporal;
   desplegar y comprobar disponibilidad antes de escribir en el catálogo.
3. Ejecutar desde la red privada `node scripts/rotarCifradoTenants.js` para
   revisar. Sin argumentos usa una transacción de solo lectura.
4. Ejecutar `node scripts/rotarCifradoTenants.js --apply`. La actualización se
   realiza en una transacción con bloqueo de las filas y límites de espera.
   Si una credencial no se puede descifrar, se revierte la transacción completa.
5. Ejecutar `node scripts/rotarCifradoTenants.js --check`; verificar conexiones
   de los cuatro tenants. Solo entonces retirar `DB_ENCRYPT_KEY_PREVIOUS` y
   desplegar nuevamente. Repetir la comprobación sin la clave anterior.

No usar este script para cambiar contraseñas del rol PostgreSQL: únicamente
renueva el cifrado del catálogo. La contraseña de la BD tiene otra rotación.

## Validación previa

- Suite backend: 198 pruebas correctas, incluyendo transición entre claves,
  retirada de la anterior y rechazo de datos alterados.
- Prueba con PostgreSQL local en una BD aislada: revisión sin cambios,
  migración de claves anteriores y datos heredados, comprobación sin respaldo,
  idempotencia y rollback ante una credencial inválida. La BD de prueba fue
  eliminada al terminar.
- Se prepararon claves aleatorias nuevas para JWT, superadministración y
  cifrado en `.env.local`. Estar guardadas localmente no implica que ya estén
  activadas en producción.
- Se preservó una copia previa cifrada con DPAPI para el usuario de Windows
  en `backups/`, fuera de Git. Los registros de operación no contienen valores
  de claves ni contraseñas.

## Dependencias externas

La clave de Resend configurada solo permite envío: la API de administración
responde `restricted_api_key`. El respaldo usa una contraseña de aplicación de
Gmail. Renovarlas requiere acceso a esos proveedores; no se puede inventar un
reemplazo local ni revocar la anterior antes de disponer de la nueva.

Se solicitó guardar los reemplazos como `SMTP_PASS_NUEVA` y
`SMTP_PASS_BACKUP_NUEVA` en `.env.local`. Tras verificar autenticación, se deben
actualizar las variables de AELA, desplegar y retirar las claves antiguas en
sus proveedores. No se enviarán correos reales como prueba sin instrucciones
para hacerlo.

Para PostgreSQL corresponde usar **Regenerate** en Database → Config y
coordinar inmediatamente las conexiones de AELA y el catálogo. Railway
documenta que reinicia PostgreSQL y corta las conexiones existentes; no se
puede prometer una rotación sin ninguna interrupción con ese mecanismo.
No modificar `POSTGRES_PASSWORD` por separado ni ejecutar `ALTER USER` aislado.
Referencia: [guía de Railway](https://blog.railway.com/p/security-disclosure-recommendation-rotate-postgresql-database-credentials).

La rotación de `JWT_SECRET` invalida sesiones existentes: los usuarios deberán
iniciar sesión nuevamente. Esto es distinto a una caída del servicio.

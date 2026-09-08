# Cierre de sesión 2026-09-07 (segunda mitad) — producto vacío + redirect SRI

Continuación de `docs/pendientes-2026-09-07-bancos-pos.md` (primera
mitad de la sesión: bancos como destino de ventas no-efectivo,
permisos de Facturador en POS, Dashboard con ventas/compras de hoy,
Estadísticas v2). Esta segunda mitad atendió 2 reportes reales de
clientes en producción.

## Commits de este tramo

| Commit | Qué |
|---|---|
| `cdfd15e` | fix: producto con nombre "vaciado a un espacio" rompía el POS |
| `c5cc5a9` | fix: seguir redirects HTTP del SRI en soapRequest |
| `7d81ee3` | fix: respuesta HTML del SRI ya no se marca como rechazo real + mensaje menos alarmante |

## 1. Bug: "Todas las líneas del carrito necesitan una descripción"

Reportado por un cliente del tenant **sys** (RUC 1105863839001,
Comercial SyS) desde el POS. El mensaje culpaba a "líneas manuales",
pero la causa real estaba en `POST`/`PUT /productos`: la validación
usaba `!nombre` sobre el valor SIN recortar — un nombre de solo
espacios pasa esa validación pero queda `""` tras el `.trim()` al
guardar. El `PUT` (editar) ni siquiera exigía nombre en absoluto.

**Audité el catálogo real de sys (650 productos, solo lectura) y no
encontré ningún producto dañado** — los 5 precios exactos de la
captura del cliente correspondían a productos reales bien nombrados.
Conclusión: para ESE incidente puntual fue casi seguro una línea
manual sin descripción (el mensaje de error ya corregido lo va a
aclarar la próxima vez). El fix en sí (validar el valor recortado en
ambos endpoints + frontend) previene que esto vuelva a pasar con
cualquier producto de cualquier tenant.

Ver `bug_nombre_producto_vacio_2026_09_07.md` (memoria) para el
detalle completo.

## 2. Factura rechazada por "estado DESCONOCIDO" con HTML en rawXml

Reportado por el mismo tenant sys: la factura 001-001-000000023 quedó
`RECHAZADO` con un mensaje del SRI que era literalmente una página
HTML de redirect 302 ("The document has moved... 181.113.227.222").

**Causa real**: `soapRequest` (backend/utils/sri.js) usa el módulo
nativo `https` de Node sin seguir redirecciones HTTP. El SRI respondió
con un 302 (probablemente un rebalanceo de su infraestructura) y el
código tomó la página HTML del redirect como si fuera la respuesta
SOAP — no encontró `<estado>`, cayó al fallback `"DESCONOCIDO"`, y la
lógica existente interpretó "no es RECIBIDA" como rechazo real. **La
factura nunca fue revisada por el SRI** — fue un malentendido técnico
de nuestro lado, no un error de contenido de la factura.

**Fix en 2 partes**:
1. `soapRequest` ahora sigue 301/302/303/307/308 (hasta 3 saltos) antes
   de intentar parsear la respuesta.
2. Por si el body sigue sin ser SOAP real después de eso (ej. una
   página de mantenimiento servida con 200 OK en vez de redirect):
   `enviarPeticionSoap` detecta HTML en el body y lanza un error
   `SRI_RESPUESTA_NO_SOAP`, que `esErrorConectividad` (colaSRI.js)
   reconoce como problema de conectividad — la factura queda en
   `FIRMADO_PENDIENTE_ENVIO` y el worker de la cola SRI la reintenta
   solo cada ~2 minutos, sin que el usuario tenga que reenviar a mano.
3. Frontend (`DetalleFactura.jsx`): cuando SÍ queda en `RECHAZADO` con
   este patrón (mensajes vacíos + estado DESCONOCIDO/HTML/error de
   conectividad), el cuadro de "Mensajes del SRI" ahora se ve con fondo
   azul neutro y un texto explícito: "esto NO significa que la factura
   tenga un error" — en vez del JSON crudo con la página HTML adentro,
   que asustaba al usuario sin necesidad.

**La factura 001-001-000000023 ya quedó AUTORIZADA** — se reenvió
manualmente contra el SRI real (número de autorización
`0709202601110586383900120010010000000234408552811`, con el código ya
corregido) usando la técnica de correr el backend local apuntando a
`aela_sys` (ver `correcciones_produccion_2026_08_24.md` para la
técnica general). Se generaron los asientos contables automáticos
correspondientes.

## Verificación

- `npm test`: 109/109. `npx vitest run`: 25/25. `vite build`/`eslint`
  limpios.
- 3 scripts de integración aparte (no en el repo, en el scratchpad de
  la sesión) reproduciendo contra servidores HTTP locales: seguir un
  302 real, detectar HTML con status 200, y el flujo completo de
  reenvío contra la BD real de sys.
- Auditoría de solo lectura contra `aela_sys` (nunca escritura salvo
  el reenvío explícitamente pedido y confirmado por el usuario).

## 🔴 Pendientes para continuar

1. **El usuario le va a avisar a sus clientes que usen "Reenviar SRI"**
   para cualquier factura que haya quedado rechazada por este mismo
   patrón mientras el bug estaba activo — no se hizo un barrido
   automático de todos los tenants/facturas afectadas. Si en algún
   momento se quiere hacer ese barrido: buscar en cada BD de tenant
   facturas con `estadoSri='RECHAZADO'` y `mensajesSri` conteniendo
   `"DESCONOCIDO"` o `"<html"` — mismo query usado para auditar sys.
2. **Deploy pendiente**: estos 3 commits (`cdfd15e`, `c5cc5a9`,
   `7d81ee3`) están en `main` pero no se confirmó que Railway ya los
   haya desplegado — hasta que eso pase, el botón "Reenviar SRI" en
   producción real (no vía el backend local que usé para el reenvío
   puntual) seguirà usando el código viejo.
3. **Estadísticas** (de la primera mitad de la sesión, ver
   `docs/pendientes-2026-09-07-bancos-pos.md`): quedó pendiente que el
   usuario diga si quiere ampliar más allá de la v2 (desglose por
   producto ya existe, interanual ya existe) — candidatos: top
   clientes, filtro de mes/rango custom, exportar a Excel/PDF.
4. **Nada de lo de hoy se probó clic a clic en navegador** — todo se
   verificó por script/API directa contra BD real o local. Falta una
   pasada manual por: POS con selector de banco (ya lo hizo el
   usuario parcialmente, confirmó el fix de permisos), Dashboard con
   los nuevos KPIs de hoy, Estadísticas v2 con datos reales, y el
   nuevo mensaje "Aviso" azul en Detalle de Factura (no hay ninguna
   factura rechazada nueva ahora mismo para verlo en vivo salvo que
   vuelva a pasar el mismo problema de red del SRI).

## Al retomar

`git pull` y revisar este documento + `docs/pendientes-2026-09-07-bancos-pos.md`
(misma fecha, primera mitad de la sesión). No hay plan guardado en
`C:\Users\USUARIO\.claude\plans\` pendiente de esta sesión — el
archivo de plan activo quedó con el diseño de Estadísticas v2, ya
implementado y cerrado.

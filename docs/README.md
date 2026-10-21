# Documentación AELA ERP

Este directorio concentra la documentacion funcional y tecnica principal del proyecto.

## Indice

- `pendientes-2026-10-21-factura-telefono-largo.md`
  - error al guardar una factura con dos números telefónicos: formulario de 50 y columna de 20
  - ampliación sin recortes, validación previa al secuencial y pruebas del SQL en PostgreSQL
- `pendientes-2026-10-20-correo-facturas-cola-sri.md`
  - caso confirmado de El Rincón de la Catedral dentro de corpsimtelec multiempresa
  - corrección del correo omitido por la cola SRI y del RIDE incompleto; recuperación de correos pendiente
- `revision-2026-10-20-envio-correos-facturas.md`
  - revisión preliminar de sys: destinatarios y envío normal y por cola SRI
  - diferencia entre autorización fiscal y entrega de correo; confirmación del proveedor pendiente
- `pendientes-2026-10-19-lavatodo-no-inventariable.md`
  - causa y corrección de una compra vinculada a un producto sin control de inventario
  - entrada autorizada de ocho unidades y verificación sin duplicados
- `pendientes-2026-10-17-factura-iva-no-vigente.md`
  - rechazo SRI 52 por IVA 12% en una factura de octubre de 2026
  - validación por fecha, corrección del selector en Facturación/POS y pasos para la factura rechazada
- `puesta-en-marcha.md`
  - instalacion local de desarrollo
  - variables de entorno
  - bootstrap inicial
  - problemas comunes
- `instalacion.md`
  - instalacion Linux/VPS con script automatizado
  - instalacion Windows local con autoarranque como servicio
  - actualizacion sin downtime
  - cambio de plan, backups, problemas comunes
- `arquitectura.md`
  - estructura backend y frontend
  - multiempresa
  - tipos de sistema y seguridad
- `modulos.md`
  - descripcion funcional de cada modulo
  - configuracion SRI y configuracion del sistema
  - plan de cuentas base editable
- `api.md`
  - endpoints principales del backend
  - notas sobre autenticacion y bloqueos por rol o modulo
- `estado-proyecto.md`
  - realizado
  - validado
  - pendiente
  - riesgos y siguientes pasos
- `arquitectura-multitenant.md`
  - modelo de despliegue una-BD-por-cliente
  - planes Lite / Medium / Pro / White-label
  - flujo de activacion y provisioning automatico
  - resolucion de tenant por subdominio
  - pool de conexiones Prisma
  - variables de entorno y seguridad
  - escalabilidad
- `guia-implementacion-sistemas-hermanos.md`
  - PWA Service Worker adaptable a SUJAM y SGD-LTYC
  - IndexedDB + cola de sincronizacion offline (copiar tal cual)
  - Endpoint /api/sync/flush con adaptacion por entidad
  - Banner offline + toast actualizacion SW
  - Scripts de instalacion: variables a cambiar por sistema
  - Checklist de implementacion para cada sistema

## Recomendacion de lectura

1. Empezar por `puesta-en-marcha.md`
2. Continuar con `modulos.md`
3. Revisar `arquitectura.md` para desarrollo y mantenimiento
4. Revisar `arquitectura-multitenant.md` para el modelo SaaS y ventas
5. Consultar `api.md` para integraciones o pruebas manuales
6. Revisar `estado-proyecto.md` para el estado funcional real y los pendientes

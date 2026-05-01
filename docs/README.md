# Documentación AELA ERP

Este directorio concentra la documentacion funcional y tecnica principal del proyecto.

## Indice

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

// ====================================
// PRISMA CLIENT — context-aware para multi-tenant
//
// Todos los módulos que hacen `require('../config/prisma')` obtienen
// automáticamente el cliente del tenant activo en el request actual,
// sin necesidad de cambiar ninguna ruta existente.
//
// Cómo funciona:
//   1. app.js llama prisma.runWithClient(req.prisma, next) por cada request
//      que tiene un tenant resuelto.
//   2. El Proxy que se exporta delega cada propiedad al cliente almacenado
//      en AsyncLocalStorage (tenant activo) o al cliente global (monoinstancia).
// ====================================

const { PrismaClient }        = require('@prisma/client');
const { AsyncLocalStorage }   = require('async_hooks');

// Cliente global (monoinstancia / fallback)
const _global = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'info', 'warn', 'error']
    : ['error'],
});

// Almacén de contexto por request (AsyncLocalStorage)
const _storage = new AsyncLocalStorage();

/**
 * Ejecuta `fn` con el cliente `client` como contexto activo.
 * Llamado por app.js cuando resolverTenant inyecta req.prisma.
 */
function runWithClient(client, fn) {
  _storage.run(client, fn);
}

// Proxy que delega al cliente del contexto actual (tenant) o al global
const proxy = new Proxy(_global, {
  get(_target, prop) {
    const client = _storage.getStore() || _global;
    const val = client[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  },
});

// Exponer la función de contexto y el cliente global para uso interno
proxy.runWithClient  = runWithClient;
proxy._globalClient  = _global;

process.on('beforeExit', async () => {
  await _global.$disconnect();
});

module.exports = proxy;

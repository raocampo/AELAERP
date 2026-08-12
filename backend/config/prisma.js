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
 * Devuelve lo que retorne `fn` — AsyncLocalStorage.run propaga el contexto
 * a través de awaits/promesas iniciadas dentro de `fn`, así que un `fn`
 * async es awaitable normalmente desde el caller.
 */
function runWithClient(client, fn) {
  return _storage.run(client, fn);
}

/**
 * Cliente Prisma efectivamente activo en este punto (el del tenant en
 * contexto, o el global si no hay ninguno). Útil para código que necesita
 * cachear datos por-base-de-datos (ej. `empresaId` no es único entre
 * tenants — cada BD de tenant tiene su propia numeración desde 1).
 */
function getActiveClient() {
  return _storage.getStore() || _global;
}

// Proxy que delega al cliente del contexto actual (tenant) o al global.
// runWithClient/getActiveClient/_globalClient son casos especiales: deben
// resolver SIEMPRE a estas funciones fijas, nunca delegarse al cliente
// Prisma activo (que no las tiene). Sin este caso especial, llamar
// prisma.runWithClient(...) o prisma.getActiveClient() desde DENTRO de un
// runWithClient ya activo (contexto anidado) fallaba con "no es una
// función", porque el `get` buscaba esas props en el PrismaClient del
// tenant en curso en vez de en este wrapper.
const proxy = new Proxy(_global, {
  get(_target, prop) {
    if (prop === 'runWithClient')   return runWithClient;
    if (prop === 'getActiveClient') return getActiveClient;
    if (prop === '_globalClient')   return _global;
    const client = _storage.getStore() || _global;
    const val = client[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  },
});

process.on('beforeExit', async () => {
  await _global.$disconnect();
});

module.exports = proxy;

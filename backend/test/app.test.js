const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../app');

const cerrarServidor = (server) => new Promise((resolve, reject) => {
  server.close((err) => (err ? reject(err) : resolve()));
});

test('GET / responde metadatos base de la API', async () => {
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.match(body.mensaje, /AELA API/i);
    assert.equal(body.version, '1.0.0');
  } finally {
    await cerrarServidor(server);
  }
});

test('POST /api/buzon/sri/consultar está montado y protegido', async () => {
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/buzon/sri/consultar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.match(body.mensaje, /token no proporcionado/i);
  } finally {
    await cerrarServidor(server);
  }
});

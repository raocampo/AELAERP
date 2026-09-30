const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { detectarFormatoArchivoComprimido, extraerEntradasXml } = require('../utils/archivoComprimido');

// Fixture RAR real (no generado a mano) — descargado de los propios test
// fixtures de node-unrar-js (github.com/YuJianrong/node-unrar.js/testFiles),
// la librería que usamos para extraerlo. Verificado interactivamente antes
// de escribir este test que node-unrar-js extrae su contenido real y
// correcto (texto unicode incluido) contra este mismo archivo — este test
// cubre la detección de formato y el manejo de "sin XML dentro", que es el
// caso real de este fixture (solo trae .txt).
const RAR_FIXTURE = path.join(__dirname, 'fixtures', 'FolderTest.rar');

function construirZipConXml(entradas) {
  const zip = new AdmZip();
  entradas.forEach(({ nombre, contenido }) => zip.addFile(nombre, Buffer.from(contenido, 'utf8')));
  return zip.toBuffer();
}

test('detectarFormatoArchivoComprimido reconoce ZIP y RAR por los primeros bytes, no por el nombre', () => {
  const zipBuffer = construirZipConXml([{ nombre: 'factura.xml', contenido: '<factura/>' }]);
  const rarBuffer = fs.readFileSync(RAR_FIXTURE);
  assert.equal(detectarFormatoArchivoComprimido(zipBuffer), 'zip');
  assert.equal(detectarFormatoArchivoComprimido(rarBuffer), 'rar');
  assert.equal(detectarFormatoArchivoComprimido(Buffer.from('no es un archivo comprimido')), null);
});

test('extraerEntradasXml — ZIP: extrae solo los .xml (case-insensitive), ignora otros archivos, preserva el contenido exacto', async () => {
  const zip = new AdmZip();
  zip.addFile('factura1.xml', Buffer.from('<factura>1</factura>', 'utf8'));
  zip.addFile('subcarpeta/factura2.XML', Buffer.from('<factura>2</factura>', 'utf8')); // extensión en mayúsculas + subcarpeta
  zip.addFile('leame.txt', Buffer.from('no es un comprobante', 'utf8'));

  const resultado = await extraerEntradasXml(zip.toBuffer());
  const porNombre = Object.fromEntries(resultado.map((r) => [r.filename, r.xmlString]));

  assert.equal(resultado.length, 2);
  assert.equal(porNombre['factura1.xml'], '<factura>1</factura>');
  // AdmZip separa entryName (ruta completa) de name (solo el nombre base) —
  // el resultado usa el nombre base, igual que ya hacía el código original.
  assert.equal(porNombre['factura2.XML'], '<factura>2</factura>');
});

test('extraerEntradasXml — ZIP inválido lanza un mensaje de error claro', async () => {
  await assert.rejects(
    () => extraerEntradasXml(Buffer.from('PK esto no es un zip real')),
    (err) => { assert.match(err.message, /ZIP válido/); return true; },
  );
});

test('extraerEntradasXml — RAR real (fixture) sin .xml adentro devuelve arreglo vacío, no truena', async () => {
  const buffer = fs.readFileSync(RAR_FIXTURE);
  const resultado = await extraerEntradasXml(buffer);
  assert.deepEqual(resultado, []);
});

test('extraerEntradasXml — RAR inválido lanza un mensaje de error claro', async () => {
  await assert.rejects(
    () => extraerEntradasXml(Buffer.from('Rar!\x1a\x07\x00esto no es un rar real')),
    (err) => { assert.match(err.message, /RAR válido/); return true; },
  );
});

test('extraerEntradasXml — archivo que no es ni ZIP ni RAR lanza mensaje claro', async () => {
  await assert.rejects(
    () => extraerEntradasXml(Buffer.from('contenido cualquiera, no comprimido')),
    (err) => { assert.match(err.message, /ZIP ni RAR válido/); return true; },
  );
});

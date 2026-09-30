// ====================================
// utils/archivoComprimido.js — AELA
// Extrae archivos .xml de un ZIP o RAR subido al Buzón SRI — el cliente
// descarga cualquiera de los dos formatos del portal del SRI según con qué
// lo comprima, así que ambos deben aceptarse.
// ====================================
const AdmZip = require('adm-zip');
const { createExtractorFromData } = require('node-unrar-js');

// Detecta el formato real por los primeros bytes del archivo (nunca por la
// extensión del nombre — un usuario puede renombrar/el navegador puede
// mandar cualquier cosa). Firmas: ZIP = "PK" (0x50 0x4B); RAR = "Rar!"
// (0x52 0x61 0x72 0x21), válida tanto para RAR4 como RAR5.
function detectarFormatoArchivoComprimido(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4B) return 'zip';
  if (buffer.length >= 4 && buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21) return 'rar';
  return null;
}

// Extrae los .xml de un ZIP o RAR — devuelve [{filename, xmlString}], mismo
// formato para ambos casos, para que el llamador no distinga de dónde vino.
// node-unrar-js es WASM puro (compilado del unrar.exe oficial de
// rarlab.com), sin binario de sistema ni compilación nativa — corre igual
// en Railway que en local, sin depender de instalar `unrar` en el
// contenedor.
async function extraerEntradasXml(buffer) {
  const formato = detectarFormatoArchivoComprimido(buffer);

  if (formato === 'zip') {
    let zip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new Error('El archivo no es un ZIP válido');
    }
    return zip.getEntries()
      .filter((e) => !e.isDirectory && e.name.toLowerCase().endsWith('.xml'))
      .map((e) => ({ filename: e.name, xmlString: e.getData().toString('utf8') }));
  }

  if (formato === 'rar') {
    // node-unrar-js no siempre lanza en createExtractorFromData() para un
    // archivo corrupto — a veces el error real solo aparece al leer el
    // listado o extraer (lazy, ver README de la librería). Todo el flujo va
    // en un solo try/catch para que cualquier falla termine en el mismo
    // mensaje amigable, nunca en un error crudo de la librería.
    try {
      const extractor = await createExtractorFromData({ data: new Uint8Array(buffer).buffer });
      const xmlHeaders = [...extractor.getFileList().fileHeaders]
        .filter((h) => !h.flags.directory && h.name.toLowerCase().endsWith('.xml'));
      if (xmlHeaders.length === 0) return [];
      const { files } = extractor.extract({ files: xmlHeaders.map((h) => h.name) });
      // node-unrar-js devuelve la ruta completa dentro del RAR en `.name`
      // (a diferencia de AdmZip arriba, que separa name/entryName) — se
      // recorta al nombre base para que el resultado sea consistente entre
      // ambos formatos.
      return [...files]
        .filter((f) => f.extraction)
        .map((f) => ({
          filename: f.fileHeader.name.split(/[/\\]/).pop(),
          xmlString: Buffer.from(f.extraction).toString('utf8'),
        }));
    } catch {
      throw new Error('El archivo no es un RAR válido');
    }
  }

  throw new Error('El archivo no es un ZIP ni RAR válido');
}

module.exports = { detectarFormatoArchivoComprimido, extraerEntradasXml };

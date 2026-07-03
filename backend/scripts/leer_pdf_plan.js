const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const buf = fs.readFileSync(path.join(__dirname, '../../docs/pdf/PLAN DE CUENTAS.pdf'));

pdfParse(buf).then(data => {
  console.log('Páginas:', data.numpages);
  const lines = data.text.split('\n').filter(l => l.trim());
  console.log('Total líneas:', lines.length);
  lines.forEach((l, i) => console.log(String(i+1).padStart(4), l));
}).catch(e => console.error('ERROR:', e.message));

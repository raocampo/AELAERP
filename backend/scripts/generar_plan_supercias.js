// Script de uso único — genera planCuentasSupercias.js desde el PDF
// node backend/scripts/generar_plan_supercias.js
const pdfParse = require('pdf-parse');
const fs  = require('fs');
const path = require('path');

const NATUREZA_POR_TIPO = {
  ACTIVO: 'DEBITO', COSTO: 'DEBITO', GASTO: 'DEBITO',
  PASIVO: 'CREDITO', PATRIMONIO: 'CREDITO', INGRESO: 'CREDITO',
};

function tipoDesde(cod) {
  if (cod.startsWith('1'))  return 'ACTIVO';
  if (cod.startsWith('2'))  return 'PASIVO';
  if (cod.startsWith('3'))  return 'PATRIMONIO';
  if (cod.startsWith('41') || cod.startsWith('42') || cod.startsWith('43')) return 'INGRESO';
  if (cod.startsWith('51')) return 'COSTO';
  if (cod.startsWith('52')) return 'GASTO';
  return null;
}

pdfParse(fs.readFileSync(path.join(__dirname, '../../docs/pdf/PLAN DE CUENTAS.pdf')))
  .then(data => {
    const lineas = data.text.split('\n').map(l => l.trim()).filter(l => l);

    // Parsear líneas de cuentas: CODIGO DESCRIPCION... SIGNO TIPO_CUENTA TIPO_ESTADO
    const raw = [];
    for (const linea of lineas) {
      const tokens = linea.split(/\s+/);
      const cod = tokens[0];
      if (!/^\d+$/.test(cod)) continue;           // no empieza con número
      if (tokens.length < 3) continue;            // página o fragmento
      if (linea.includes('ELIMINADO')) continue;  // marcadas eliminadas

      // Último token es TIPO_ESTADO (1,2,3,5), antepenúltimo TIPO_CUENTA (T/D), etc.
      const signo      = tokens[tokens.length - 3]; // P/N/D
      const tipoCuenta = tokens[tokens.length - 2]; // T/D
      const tipoEstado = tokens[tokens.length - 1]; // 1/2/3/5

      if (!['P','N','D'].includes(signo)) continue;
      if (!['T','D'].includes(tipoCuenta)) continue;
      if (!['1','2','3','5'].includes(tipoEstado)) continue;

      // Nombre = todo entre el código y el signo
      const nombre = tokens.slice(1, tokens.length - 3).join(' ').trim();
      if (!nombre) continue;

      raw.push({ cod, nombre, signo, tipoCuenta });
    }

    // Filtrar solo cuentas 1-52
    const cuentas = raw.filter(r => tipoDesde(r.cod) !== null);

    // Índice para buscar padre por prefijo
    const codigos = new Set(cuentas.map(c => c.cod));

    function encontrarPadre(cod) {
      for (let l = cod.length - 1; l >= 1; l--) {
        const p = cod.substring(0, l);
        if (codigos.has(p)) return p;
      }
      return null;
    }

    // Calcular nivel por cadena de padres
    const nivelCache = {};
    const computing  = new Set();
    function calcularNivel(cod) {
      if (nivelCache[cod] !== undefined) return nivelCache[cod];
      if (computing.has(cod)) { nivelCache[cod] = 1; return 1; }
      computing.add(cod);
      const padre = encontrarPadre(cod);
      const n = padre ? 1 + calcularNivel(padre) : 1;
      computing.delete(cod);
      nivelCache[cod] = n;
      return n;
    }

    // Construir array final
    const resultado = cuentas.map(c => {
      const tipo = tipoDesde(c.cod);
      // N = cuenta contra (depreciaciones, provisiones) → siempre CREDITO
      const naturaleza = c.signo === 'N' ? 'CREDITO' : NATUREZA_POR_TIPO[tipo];
      const aceptaMovimiento = c.tipoCuenta === 'D';
      const codigoPadre = encontrarPadre(c.cod);
      const nivel = calcularNivel(c.cod);
      return { codigo: c.cod, nombre: c.nombre, nivel, tipo, naturaleza, codigoPadre, aceptaMovimiento };
    });

    // Ordenar por código ascendente (padres antes que hijos)
    resultado.sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));

    // Generar archivo
    const lineasJS = resultado.map(r =>
      `  { codigo: '${r.codigo}', nombre: ${JSON.stringify(r.nombre)}, nivel: ${r.nivel}, tipo: '${r.tipo}', naturaleza: '${r.naturaleza}', codigoPadre: ${r.codigoPadre ? `'${r.codigoPadre}'` : 'null'}, aceptaMovimiento: ${r.aceptaMovimiento} },`
    );

    const contenido = `// Plan de Cuentas NIIF — Superintendencia de Compañías del Ecuador
// Fuente: Catálogo Único de Cuentas (CUC) Supercias — cuentas 1-52
// Generado automáticamente desde docs/pdf/PLAN DE CUENTAS.pdf
// ${resultado.length} cuentas

const PLAN_SUPERCIAS = [
${lineasJS.join('\n')}
];

async function sembrarPlanSupercias(db, empresaId, overwriteExisting = false) {
  let creadas = 0;
  let actualizadas = 0;

  for (const cuenta of PLAN_SUPERCIAS) {
    const data = { ...cuenta, empresaId, activo: true };
    const existente = await db.plan_cuentas.findFirst({ where: { empresaId, codigo: cuenta.codigo } });
    if (existente) {
      if (overwriteExisting) {
        await db.plan_cuentas.update({ where: { id: existente.id }, data });
        actualizadas++;
      }
    } else {
      await db.plan_cuentas.create({ data });
      creadas++;
    }
  }

  return { creadas, actualizadas, total: PLAN_SUPERCIAS.length };
}

module.exports = { sembrarPlanSupercias, PLAN_SUPERCIAS };
`;

    const destino = path.join(__dirname, '../utils/planCuentasSupercias.js');
    fs.writeFileSync(destino, contenido, 'utf8');
    console.log(`✅ Generado: ${destino}`);
    console.log(`   Total cuentas: ${resultado.length}`);
    const stats = {};
    resultado.forEach(r => { stats[r.tipo] = (stats[r.tipo]||0)+1; });
    Object.entries(stats).forEach(([t, n]) => console.log(`   ${t}: ${n}`));
  });

#!/usr/bin/env node
// ====================================
// SCRIPT: Reparar mojibake UTF-8 -> Latin-1 en catastro/clientes/notas de venta
//
// Hallazgo 2026-08-27: varios clientes con "enye" en el nombre (ej.
// "IÑIGUEZ") aparecen guardados con un caracter roto seguido de un byte de
// control invisible (ej. "IÃIGUEZ") -- el patron clasico de un archivo
// UTF-8 leido como si fuera Latin-1. Sospecha de raiz: importarCatastroSRI.js
// declara `{ encoding: 'latin1' }` para los CSV del catastro SRI (correcto
// SI el CSV realmente viene en esa codificacion); si el archivo usado en
// alguna importacion en realidad era UTF-8, cada tilde/enye quedo corrompida
// en `contribuyentes_sri`, y de ahi se propago a `clientes`/`notas_venta`
// cada vez que alguien consulto a un contribuyente afectado.
//
// Este script NO decide si hay que cambiar la codificacion del importador --
// eso depende de como sea el proximo CSV real que se use -- solo repara el
// dano ya hecho, detectando y revirtiendo el patron de doble codificacion.
//
// Uso:
//   node scripts/repararMojibakeContribuyentes.js            (dry-run, solo lista)
//   node scripts/repararMojibakeContribuyentes.js --aplicar  (aplica los cambios)
//
// Requiere DATABASE_URL apuntando a la base a reparar (correr una vez por
// cada base de datos de tenant si aplica -- ver notas de la sesion sobre
// arquitectura multi-tenant).
// ====================================

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Los bytes de continuacion UTF-8 (0x80-0xBF) mal leidos como Latin-1 caen
// mayormente en el rango de controles C1 (U+0080-U+009F), casi siempre
// invisibles -- senal fuerte de corrupcion. "Ã" (A con tilde) y
// "Â" (A circunfleja) son los primeros bytes mas comunes de vocales
// acentuadas y de la enye en UTF-8 (0xC3/0xC2) leidos como Latin-1.
const CARACTERES_SOSPECHOSOS = [0xC3, 0xC2]; // A-tilde, A-circunfleja
const C1_INICIO = 0x80;
const C1_FIN = 0x9f;

function esSospechoso(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (CARACTERES_SOSPECHOSOS.includes(code)) return true;
    if (code >= C1_INICIO && code <= C1_FIN) return true;
  }
  return false;
}

function pareceMojibake(str) {
  if (!str || typeof str !== 'string') return false;
  if (!esSospechoso(str)) return false;
  try {
    const reparado = Buffer.from(str, 'latin1').toString('utf8');
    // Debe cambiar, no debe producir caracteres de reemplazo (bytes que no
    // forman UTF-8 valido), y el resultado ya no debe verse sospechoso.
    if (reparado === str) return false;
    if (reparado.includes('�')) return false; // caracter de reemplazo = UTF-8 invalido
    if (esSospechoso(reparado)) return false;
    return true;
  } catch {
    return false;
  }
}

function repararMojibake(str) {
  return Buffer.from(str, 'latin1').toString('utf8');
}

// Tablas/campos a revisar. contribuyentes_sri es la fuente raiz (catastro
// SRI compartido); clientes/notas_venta/facturas son copias hechas al
// consultar un contribuyente afectado.
const OBJETIVOS = [
  { modelo: 'contribuyentes_sri', campos: ['razonSocial', 'nombreComercial'] },
  { modelo: 'directorio_global',  campos: ['razonSocial', 'nombreComercial'] },
  { modelo: 'clientes',           campos: ['razonSocial', 'nombreComercial'] },
  { modelo: 'notas_venta',        campos: ['razonSocial', 'razonSocialEmisor'] },
  { modelo: 'facturas',           campos: ['razonSocialComprador', 'razonSocialEmisor'] },
];

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  console.log(aplicar ? 'Modo: APLICAR cambios' : 'Modo: dry-run (solo listar)');
  console.log('========================================');

  let totalEncontrados = 0;
  let totalReparados = 0;

  for (const { modelo, campos } of OBJETIVOS) {
    const select = { id: true };
    campos.forEach((c) => { select[c] = true; });
    const filas = await prisma[modelo].findMany({ select });

    for (const fila of filas) {
      const cambios = {};
      for (const campo of campos) {
        const valor = fila[campo];
        if (pareceMojibake(valor)) {
          cambios[campo] = repararMojibake(valor);
        }
      }
      if (Object.keys(cambios).length === 0) continue;

      totalEncontrados++;
      const antes = campos.map((c) => `${c}="${fila[c] ?? ''}"`).join(' ');
      const despues = campos.map((c) => `${c}="${cambios[c] ?? fila[c] ?? ''}"`).join(' ');
      console.log(`[${modelo}#${fila.id}]`);
      console.log(`  ANTES  : ${antes}`);
      console.log(`  DESPUES: ${despues}`);

      if (aplicar) {
        await prisma[modelo].update({ where: { id: fila.id }, data: cambios });
        totalReparados++;
      }
    }
  }

  console.log('========================================');
  console.log(`Registros con mojibake detectado: ${totalEncontrados}`);
  if (aplicar) {
    console.log(`Registros reparados: ${totalReparados}`);
  } else {
    console.log('Nada se modifico (dry-run). Ejecuta con --aplicar para corregir.');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});

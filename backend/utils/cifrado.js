// ====================================
// CIFRADO AES-256-GCM — para dbPass de tenants
//
// Formato cifrado: enc:<iv_hex>:<tag_hex>:<ciphertext_hex>
// Si el valor no empieza con "enc:", se considera texto plano
// (compatibilidad hacia atrás con registros existentes).
// ====================================

const crypto = require('crypto');

const ALGORITMO = 'aes-256-gcm';
const IV_LEN    = 12; // bytes — recomendado para GCM

function getKey() {
  const hex = process.env.DB_ENCRYPT_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('DB_ENCRYPT_KEY faltante o inválida — debe ser 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function cifrar(texto) {
  const key = getKey();
  const iv  = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITMO, key, iv);

  const cifrado = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();

  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${cifrado.toString('hex')}`;
}

function descifrar(valor) {
  if (!valor || !valor.startsWith('enc:')) {
    return valor; // plaintext heredado
  }

  const partes = valor.split(':');
  if (partes.length !== 4) throw new Error('Formato cifrado inválido');

  const [, ivHex, tagHex, cifradoHex] = partes;
  const key     = getKey();
  const iv      = Buffer.from(ivHex, 'hex');
  const tag     = Buffer.from(tagHex, 'hex');
  const cifrado = Buffer.from(cifradoHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITMO, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
}

module.exports = { cifrar, descifrar };

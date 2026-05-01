// ====================================
// SCRIPT DE EMERGENCIA — Reset de contraseña
// backend/scripts/resetPassword.js
//
// Uso:
//   node scripts/resetPassword.js <usuario_o_email> <nueva_contraseña>
//
// Ejemplo:
//   node scripts/resetPassword.js admin NuevaPassword123
// ====================================

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function resetPassword() {
  const [, , identificador, nuevaPassword] = process.argv;

  if (!identificador || !nuevaPassword) {
    console.error('\nUso: node scripts/resetPassword.js <usuario_o_email> <nueva_contraseña>\n');
    process.exit(1);
  }

  if (nuevaPassword.length < 8) {
    console.error('\nError: La contraseña debe tener al menos 8 caracteres.\n');
    process.exit(1);
  }

  const id = String(identificador).trim().toLowerCase();

  const usuario = await prisma.usuarios.findFirst({
    where: {
      OR: [
        { username: id },
        { email: id },
      ],
    },
    select: { id: true, nombre: true, username: true, email: true, rol: true },
  });

  if (!usuario) {
    console.error(`\nUsuario no encontrado: "${identificador}"\n`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(nuevaPassword, 10);

  await prisma.usuarios.update({
    where: { id: usuario.id },
    data: { password: hash },
  });

  console.log('\n✅ Contraseña actualizada correctamente.');
  console.log(`   Usuario : ${usuario.username}`);
  console.log(`   Nombre  : ${usuario.nombre}`);
  console.log(`   Rol     : ${usuario.rol}`);
  console.log('\nYa puedes iniciar sesión con la nueva contraseña.\n');

  await prisma.$disconnect();
}

resetPassword().catch((err) => {
  console.error('\nError al actualizar contraseña:', err.message);
  prisma.$disconnect();
  process.exit(1);
});

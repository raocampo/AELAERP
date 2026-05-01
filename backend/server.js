// ====================================
// AELA — ERP de Comprobantes Fiscales (Ecuador)
// backend/server.js
// ====================================

require('dotenv').config();
const app = require('./app');
const { iniciarWorkerColaSRI } = require('./utils/colaSRI');

const PORT = process.env.PORT || 5600;
const EDITION = process.env.AELA_EDITION || 'full';
const MODO = process.env.MODO_EMPRESA || 'mono';

app.listen(PORT, () => {
  console.log(`\n🧾 AELA Backend corriendo en puerto ${PORT}`);
  console.log(`📦 Edición : ${EDITION.toUpperCase()}${EDITION === 'lite' ? ' (máx 100 facturas/año)' : ''}`);
  console.log(`🏢 Modo    : ${MODO === 'multi' ? 'MULTIEMPRESA' : 'MONOEMPRESA'}`);
  console.log(`📁 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 CORS    : ${process.env.FRONTEND_URL || 'http://localhost:5174'}\n`);

  // Iniciar worker de reintentos SRI (cola offline)
  iniciarWorkerColaSRI();
});

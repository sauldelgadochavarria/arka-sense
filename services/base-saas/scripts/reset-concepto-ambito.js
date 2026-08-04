'use strict';
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27020/config');
  const r = await mongoose.connection.collection('nomina_conceptos').updateMany(
    {},
    { $set: { aplicaTiposPeriodo: [], aplicaTipoNomina: [] } }
  );
  console.log('conceptos actualizados:', r.modifiedCount);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

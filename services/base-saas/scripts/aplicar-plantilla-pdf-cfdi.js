'use strict';
/**
 * Aplica el layout CFDI 4.0 / Nómina 1.2 a una plantilla PDF.
 *   node scripts/aplicar-plantilla-pdf-cfdi.js [id]
 * Default id: 6a7e2d294b7c9ffddced755f
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { COLLECTION_RECIBO_PDF_PLANTILLAS } = require('../config/constants');
const { PLANTILLA_PDF_CFDI } = require('../config/reciboPdfPlantillaCfdi');

const ID = process.argv[2] || '6a7e2d294b7c9ffddced755f';

(async () => {
  const uri = dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config';
  const conn = await mongoose.createConnection(uri).asPromise();
  const col = conn.collection(COLLECTION_RECIBO_PDF_PLANTILLAS);
  let oid;
  try {
    oid = new mongoose.Types.ObjectId(ID);
  } catch {
    throw new Error(`ID inválido: ${ID}`);
  }
  const before = await col.findOne({ _id: oid }, { projection: { codigo: 1, nombre: 1 } });
  if (!before) {
    console.error('Plantilla no encontrada:', ID);
    process.exit(1);
  }
  const res = await col.updateOne(
    { _id: oid },
    {
      $set: {
        plantillaHtml: PLANTILLA_PDF_CFDI,
        nombre: 'Recibo CFDI 4.0 / Nómina 1.2',
        updatedAt: new Date()
      }
    }
  );
  console.log('Actualizada', before.codigo, before.nombre, 'matched', res.matchedCount, 'html', PLANTILLA_PDF_CFDI.length, 'chars');
  await conn.close();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const db = require('../config/db');
const { diasCalendarioInclusive } = require('../libs/timeHelpers');

(async () => {
  await mongoose.connect(db.connectionStringConfig || 'mongodb://localhost:27020/config');
  const col = mongoose.connection.collection('nomina_periods');
  const p = await col.findOne({ _id: new mongoose.Types.ObjectId('6a73db159c0cfe3c74708938') });
  const dias = diasCalendarioInclusive(p.fechaInicio, p.fechaFin);
  await col.updateOne({ _id: p._id }, { $set: { diasPeriodo: dias } });
  console.log('periodo corregido', p.diasPeriodo, '->', dias);
  console.log('tope 1.3*UMA*15', Number((1.3 * 117.31 * 15).toFixed(2)));
  console.log('tope 1.3*UMA_mensual/2', Number((1.3 * 3566.22 / 2).toFixed(2)));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

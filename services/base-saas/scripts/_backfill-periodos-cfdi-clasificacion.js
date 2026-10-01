'use strict';

/** Backfill tipoNominaCfdi + periodicidadPagoSat en períodos ya importados. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

(async () => {
  const getP = require('../models/periodoNomina');
  const getPay = require('../models/payrollPeriod');
  const getTipo = require('../models/tipoPeriodoNomina');
  const P = await getP();
  const Pay = await getPay();
  const Tipo = await getTipo();

  const tipos = await Tipo.find({}).select('_id periodicidadPagoSat tipoMotor').lean();
  const satById = new Map(tipos.map((t) => [String(t._id), t.periodicidadPagoSat]));

  let n = 0;
  const cursor = P.find({
    $or: [
      { tipoNominaCfdi: { $in: [null, ''] } },
      { tipoNominaCfdi: { $exists: false } },
      { periodicidadPagoSat: null },
      { periodicidadPagoSat: { $exists: false } }
    ]
  }).cursor();

  for await (const doc of cursor) {
    const set = {};
    if (!doc.tipoNominaCfdi) {
      set.tipoNominaCfdi = doc.tipoNomina === 'ordinaria' ? 'O' : 'E';
    }
    if (doc.periodicidadPagoSat == null) {
      let sat = null;
      if (doc.payrollPeriodId) {
        const pay = await Pay.findById(doc.payrollPeriodId).select('tipoPeriodoId periodicidadPagoSat').lean();
        if (pay?.periodicidadPagoSat != null) sat = pay.periodicidadPagoSat;
        else if (pay?.tipoPeriodoId) sat = satById.get(String(pay.tipoPeriodoId));
      }
      if (sat == null && doc.tipoPeriodo === 'otra') sat = 99;
      if (sat == null && doc.tipoPeriodo === 'semanal') sat = 2;
      if (sat == null && doc.tipoPeriodo === 'catorcenal') sat = 3;
      if (sat == null && doc.tipoPeriodo === 'quincenal') sat = 4;
      if (sat == null && doc.tipoPeriodo === 'mensual') sat = 5;
      if (sat == null && doc.tipoPeriodo === 'decena') sat = 10;
      if (sat != null) set.periodicidadPagoSat = sat;
    }
    if (Object.keys(set).length) {
      await P.updateOne({ _id: doc._id }, { $set: set });
      if (doc.payrollPeriodId) {
        await Pay.updateOne({ _id: doc.payrollPeriodId }, { $set: set });
      }
      n += 1;
    }
  }
  console.log('backfilled', n);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

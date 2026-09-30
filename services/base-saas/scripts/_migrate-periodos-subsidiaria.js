'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

(async () => {
  const getP = require('../models/payrollPeriod');
  const getS = require('../models/subsidiaria');
  const P = await getP();
  const S = await getS();

  try {
    const ixs = await P.collection.indexes();
    for (const ix of ixs) {
      if (ix.name === 'tenantId_1_tipoPeriodoId_1_anio_1_numeroPeriodo_1') {
        console.log('drop', ix.name);
        await P.collection.dropIndex(ix.name);
      }
    }
  } catch (e) {
    console.log('idx', e.message);
  }

  await P.syncIndexes();

  const empresas = await P.distinct('empresaId');
  let total = 0;
  for (const empId of empresas) {
    const main = await S.findOne({ empresaId: empId, activo: true }).sort({ codigo: 1 }).lean();
    if (!main) {
      console.log('no sub for', empId);
      continue;
    }
    const r = await P.updateMany(
      {
        empresaId: empId,
        $or: [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }]
      },
      { $set: { subsidiariaId: main._id } }
    );
    console.log('empresa', String(empId), 'main', main.codigo, 'updated', r.modifiedCount);
    total += r.modifiedCount;
  }

  const sample = await P.findById('6a36eb74ed78b8ded14b3be3').lean();
  console.log('sample', sample && { emp: String(sample.empresaId), sub: String(sample.subsidiariaId) });
  console.log('indexes', (await P.collection.indexes()).map((i) => i.name));
  console.log('totalUpdated', total);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

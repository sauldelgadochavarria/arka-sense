'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

(async () => {
  const getJ = require('../models/cargaInicialJob');
  const J = await getJ();
  const cursor = J.find({
    'resumen.subsidiariaId': { $ne: null },
    $or: [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }]
  })
    .select('_id resumen.subsidiariaId')
    .cursor();

  let n = 0;
  for await (const doc of cursor) {
    const sub = doc.resumen?.subsidiariaId;
    if (!sub) continue;
    await J.updateOne({ _id: doc._id }, { $set: { subsidiariaId: sub } });
    n += 1;
  }
  console.log('jobsBackfilled', n);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

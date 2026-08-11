'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { calcularPeriodo } = require('../services/nomina/calculoNominaService');

(async () => {
  await mongoose.connect(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config');
  const t = await mongoose.connection.collection('tenants').findOne({ slug: 'empresa-demo' });
  const periodoId = new mongoose.Types.ObjectId('6a73db159c0cfe3c74708938');
  await mongoose.connection
    .collection('nomina_periods')
    .updateOne({ _id: periodoId }, { $set: { estatus: 'abierto' } });
  await calcularPeriodo(t.tenantId, periodoId, {});
  const emp = await mongoose.connection
    .collection('empleados')
    .findOne({ tenantId: t.tenantId, numEmpleado: '100' });
  const recibo = await mongoose.connection.collection('nomina_recibos').findOne({
    tenantId: t.tenantId,
    periodoId,
    empleadoId: emp._id
  });
  const codes = ['DEDUCCIONES_TOTALES', 'NETO_PAGAR', 'PERCEPCIONES_GRAVADAS', 'ISR'];
  const lineas = await mongoose.connection
    .collection('nomina_conceptos_aplicados')
    .find({ tenantId: t.tenantId, reciboId: recibo._id, conceptoCodigo: { $in: codes } })
    .project({ conceptoCodigo: 1, importe: 1, formulaUsada: 1 })
    .toArray();
  const by = Object.fromEntries(lineas.map((l) => [l.conceptoCodigo, l]));
  const ok =
    Math.abs((by.DEDUCCIONES_TOTALES?.importe || 0) - recibo.totalDeducciones) < 0.02 &&
    Math.abs((by.NETO_PAGAR?.importe || 0) - recibo.netoPagar) < 0.02;
  console.log(
    JSON.stringify(
      {
        recibo: {
          perc: recibo.totalPercepciones,
          ded: recibo.totalDeducciones,
          neto: recibo.netoPagar
        },
        lineas: by,
        match: ok
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
  if (!ok) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

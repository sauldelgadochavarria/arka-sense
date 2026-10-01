'use strict';

/**
 * Repara desalineación PayrollPeriod ↔ PeriodoNomina tras import CFDI
 * (match incorrecto por numeroPeriodo sin actualizar fechas).
 *
 * Uso: node scripts/_repair-cfdi-period-dates.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const Nomina = db.collection('nomina_periods');
  const Payroll = db.collection('payroll_periods');

  const rows = await Nomina.find({
    $or: [{ cerradoPorLabel: 'import_cfdi' }, { notas: /Importado desde CFDI/i }]
  }).toArray();

  let synced = 0;
  let missingPayroll = 0;
  const report = [];

  for (const n of rows) {
    if (!n.payrollPeriodId) {
      missingPayroll += 1;
      continue;
    }
    const p = await Payroll.findOne({ _id: n.payrollPeriodId });
    if (!p) {
      missingPayroll += 1;
      report.push({ nominaId: String(n._id), issue: 'payroll_missing' });
      continue;
    }

    const sameStart = new Date(p.fechaInicio).getTime() === new Date(n.fechaInicio).getTime();
    const sameEnd = new Date(p.fechaFin).getTime() === new Date(n.fechaFin).getTime();
    if (sameStart && sameEnd && p.numeroPeriodo === n.numeroPeriodo) continue;

    await Payroll.updateOne(
      { _id: p._id },
      {
        $set: {
          fechaInicio: n.fechaInicio,
          fechaFin: n.fechaFin,
          fechaPago: n.fechaPago || p.fechaPago || null,
          anio: n.anio || p.anio,
          numeroPeriodo: n.numeroPeriodo != null ? n.numeroPeriodo : p.numeroPeriodo,
          estatus: 'cerrado',
          compartirConNomina: true,
          aplicaAsistenciaPrenomina: false,
          totales: n.totales || p.totales,
          notas: p.notas && /Import CFDI/i.test(p.notas)
            ? p.notas
            : `Import CFDI · ${n.totales?.empleados || 0} recibos timbrados`,
          cerradoAt: n.cerradoAt || n.fechaCierre || p.cerradoAt || n.fechaFin,
          calculadoAt: n.calculadoAt || n.fechaCalculo || p.calculadoAt || n.fechaFin
        }
      }
    );
    synced += 1;
    report.push({
      payrollId: String(p._id),
      numeroPeriodo: n.numeroPeriodo,
      before: { inicio: p.fechaInicio, fin: p.fechaFin },
      after: { inicio: n.fechaInicio, fin: n.fechaFin }
    });
  }

  console.log(JSON.stringify({ totalImportNomina: rows.length, synced, missingPayroll, report }, null, 2));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

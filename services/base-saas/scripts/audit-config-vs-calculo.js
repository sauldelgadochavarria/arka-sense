'use strict';

/**
 * Compara fiscal config en DB vs líneas calculadas del recibo demo emp 100.
 *   node scripts/audit-config-vs-calculo.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');

(async () => {
  await mongoose.connect(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config');
  const t = await mongoose.connection.collection('tenants').findOne({ slug: 'empresa-demo' });
  const tid = t.tenantId;

  const emp = await mongoose.connection.collection('empleados').findOne({ tenantId: tid, numEmpleado: '100' });
  const periodoId = new mongoose.Types.ObjectId('6a73db159c0cfe3c74708938');
  const recibo = await mongoose.connection.collection('nomina_recibos').findOne({
    tenantId: tid,
    periodoId,
    empleadoId: emp._id
  });

  const lineas = await mongoose.connection
    .collection('nomina_conceptos_aplicados')
    .find({ tenantId: tid, reciboId: recibo._id })
    .project({
      conceptoCodigo: 1,
      nombre: 1,
      tipo: 1,
      importe: 1,
      gravado: 1,
      exento: 1,
      formulaUsada: 1,
      desgloseModo: 1,
      fiscal: 1,
      isr: 1,
      imss: 1
    })
    .toArray();

  const codes = [...new Set(lineas.map((l) => l.conceptoCodigo))];
  const conceptos = await mongoose.connection
    .collection('nomina_conceptos')
    .find({ tenantId: tid, codigo: { $in: codes } })
    .project({
      codigo: 1,
      nombre: 1,
      tipo: 1,
      naturaleza: 1,
      activo: 1,
      fiscal: 1,
      formulaDefault: 1
    })
    .toArray();
  const byCode = Object.fromEntries(conceptos.map((c) => [c.codigo, c]));

  const formulas = await mongoose.connection
    .collection('nomina_formulas')
    .find({ tenantId: tid, tipoPeriodo: 'quincenal', conceptoCodigo: { $in: codes }, activo: true })
    .project({ conceptoCodigo: 1, formula: 1, condicion: 1, fase: 1 })
    .toArray();
  const formByCode = Object.fromEntries(formulas.map((f) => [f.conceptoCodigo, f]));

  const report = lineas
    .filter((l) => !['PERCEPCIONES_GRAVADAS', 'DEDUCCIONES_TOTALES', 'NETO_PAGAR'].includes(l.conceptoCodigo) || true)
    .map((l) => {
      const cfg = byCode[l.conceptoCodigo] || {};
      const f = cfg.fiscal || {};
      const d = f.desglose || {};
      const im = f.imss || {};
      const form = formByCode[l.conceptoCodigo];
      const issues = [];

      // ISR: importe vs gravado+exento
      const sumIsr = Math.round(((Number(l.gravado) || 0) + (Number(l.exento) || 0)) * 100) / 100;
      const imp = Math.round((Number(l.importe) || 0) * 100) / 100;
      if (imp > 0 && Math.abs(sumIsr - imp) > 0.02 && (l.tipo === 'percepcion' || l.tipo === 'otro_pago')) {
        issues.push(`ISR sum grav+ex=${sumIsr} != importe ${imp}`);
      }

      // Config modo vs desgloseModo aplicado
      if (d.modo && l.desgloseModo && d.modo !== l.desgloseModo) {
        issues.push(`modo config=${d.modo} vs aplicado=${l.desgloseModo}`);
      }

      // Fórmula importe vs fórmulas desglose
      if (d.modo === 'formula' || d.formulaExento || d.formulaGravado) {
        if (d.formulaExento && Math.abs((Number(l.exento) || 0)) < 0.005 && (Number(l.gravado) || 0) === imp && imp > 0) {
          // might still be ok if exento formula evaluates to 0
        }
      }

      // PERCEPCIONES_GRAVADAS debería sumar gravados
      return {
        codigo: l.conceptoCodigo,
        tipo: l.tipo,
        importe: l.importe,
        gravado: l.gravado,
        exento: l.exento,
        desgloseModoAplicado: l.desgloseModo,
        formulaUsada: l.formulaUsada,
        formulaPeriodo: form?.formula,
        config: {
          naturaleza: f.naturaleza || cfg.naturaleza,
          integraISR: f.integraISR,
          integraIMSS: f.integraIMSS,
          desgloseModo: d.modo,
          formulaExento: d.formulaExento || '',
          formulaGravado: d.formulaGravado || '',
          codigoRegla: d.codigoRegla || '',
          naturalezaSdi: im.naturalezaSdi,
          imssModo: im.desglose?.modo,
          imssRegla: im.desglose?.codigoRegla || ''
        },
        imssLinea: l.imss || null,
        issues
      };
    });

  // Totales
  const pg = lineas.find((l) => l.conceptoCodigo === 'PERCEPCIONES_GRAVADAS');
  const sumGravPerc = lineas
    .filter((l) => l.tipo === 'percepcion')
    .reduce((s, l) => s + (Number(l.gravado) || 0), 0);

  console.log('=== CONFIG vs CALCULO (emp 100, quincena jul 1-15) ===\n');
  for (const r of report) {
    console.log('---', r.codigo, `(${r.tipo})`);
    console.log(
      JSON.stringify(
        {
          importe: r.importe,
          gravado: r.gravado,
          exento: r.exento,
          desgloseModoAplicado: r.desgloseModoAplicado,
          formulaUsada: r.formulaUsada,
          formulaPeriodo: r.formulaPeriodo,
          config: r.config,
          imssLinea: r.imssLinea,
          issues: r.issues
        },
        null,
        2
      )
    );
  }
  console.log('\n=== CHECK PERCEPCIONES_GRAVADAS ===');
  console.log({
    conceptoPG: pg?.importe,
    formulaPG: formByCode.PERCEPCIONES_GRAVADAS?.formula,
    sumaGravadoPercepciones: Math.round(sumGravPerc * 100) / 100,
    match: pg && Math.abs((pg.importe || 0) - sumGravPerc) < 0.02
  });

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

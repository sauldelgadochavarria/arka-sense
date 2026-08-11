'use strict';

/**
 * Corrige vigencia UMA 2026 (1-feb → 117.31), dependencias ISR y recalcula demo.
 *   node scripts/fix-uma-isr-recibo.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { calcularPeriodo } = require('../services/nomina/calculoNominaService');
const { obtenerParametrosVigentes } = require('../services/nomina/tablasFiscalesService');

(async () => {
  await mongoose.connect(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config');
  const Param = mongoose.connection.collection('parametros_generales');

  // UMA oficial 2026: diaria 117.31 desde 1 de febrero
  const umaNueva = await Param.findOne({ clave: 'UMA', valor: 117.31 });
  const umaVieja = await Param.findOne({
    clave: 'UMA',
    valor: { $ne: 117.31 },
    $or: [{ vigenciaHasta: { $ne: null } }, { vigenciaHasta: null }]
  });

  const desdeFeb1 = new Date('2026-02-01T00:00:00.000Z');
  const hastaEne31 = new Date('2026-01-31T23:59:59.999Z');

  if (umaVieja) {
    await Param.updateOne(
      { _id: umaVieja._id },
      {
        $set: {
          vigenciaHasta: hastaEne31,
          descripcion: umaVieja.descripcion || 'UMA previa a actualización 2026',
          updatedAt: new Date()
        }
      }
    );
  }

  if (umaNueva) {
    await Param.updateOne(
      { _id: umaNueva._id },
      {
        $set: {
          valor: 117.31,
          vigenciaDesde: desdeFeb1,
          vigenciaHasta: null,
          descripcion: 'Unidad de Medida y Actualización diaria 2026 (DOF)',
          updatedAt: new Date()
        }
      }
    );
  } else {
    await Param.insertOne({
      clave: 'UMA',
      valor: 117.31,
      vigenciaDesde: desdeFeb1,
      vigenciaHasta: null,
      descripcion: 'Unidad de Medida y Actualización diaria 2026 (DOF)',
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  // Cerrar cualquier otra UMA abierta que no sea 117.31
  await Param.updateMany(
    { clave: 'UMA', valor: { $ne: 117.31 }, vigenciaHasta: null },
    { $set: { vigenciaHasta: hastaEne31, updatedAt: new Date() } }
  );

  console.log('params@2026-01-15', await obtenerParametrosVigentes(new Date('2026-01-15T12:00:00Z')));
  console.log('params@2026-02-01', await obtenerParametrosVigentes(new Date('2026-02-01T12:00:00Z')));
  console.log('params@2026-07-01', await obtenerParametrosVigentes(new Date('2026-07-01T12:00:00Z')));

  const t = await mongoose.connection.collection('tenants').findOne({ slug: 'empresa-demo' });
  const tid = t.tenantId;
  const colF = mongoose.connection.collection('nomina_formulas');

  // ISR debe depender de PERCEPCIONES_GRAVADAS
  await colF.updateMany(
    { tenantId: tid, conceptoCodigo: 'ISR', activo: true },
    {
      $set: {
        dependencias: ['PERCEPCIONES_GRAVADAS'],
        condicion: 'PERCEPCIONES_GRAVADAS > 0',
        updatedAt: new Date()
      }
    }
  );

  // Reparar fórmulas con vigenciaHasta < vigenciaDesde
  const rotas = await colF
    .find({ tenantId: tid, activo: true })
    .project({ _id: 1, conceptoCodigo: 1, vigenciaDesde: 1, vigenciaHasta: 1 })
    .toArray();
  for (const f of rotas) {
    if (f.vigenciaHasta && f.vigenciaDesde && new Date(f.vigenciaHasta) < new Date(f.vigenciaDesde)) {
      await colF.updateOne(
        { _id: f._id },
        { $set: { activo: false, updatedAt: new Date() } }
      );
      console.log('desactivada fórmula vigencia inválida', f.conceptoCodigo, String(f._id));
    }
  }

  const periodoId = new mongoose.Types.ObjectId('6a73db159c0cfe3c74708938');
  await mongoose.connection
    .collection('nomina_periods')
    .updateOne({ _id: periodoId }, { $set: { estatus: 'abierto' } });
  await calcularPeriodo(tid, periodoId, {});

  const emp = await mongoose.connection.collection('empleados').findOne({
    tenantId: tid,
    numEmpleado: '100'
  });
  const recibo = await mongoose.connection.collection('nomina_recibos').findOne({
    tenantId: tid,
    periodoId,
    empleadoId: emp._id
  });
  const isr = await mongoose.connection.collection('nomina_conceptos_aplicados').findOne({
    tenantId: tid,
    reciboId: recibo._id,
    conceptoCodigo: 'ISR'
  });
  console.log({
    recibo: {
      perc: recibo.totalPercepciones,
      ded: recibo.totalDeducciones,
      neto: recibo.netoPagar,
      error: recibo.errorCalculo,
      bases: recibo.basesFiscales
    },
    isr: {
      importe: isr?.importe,
      formulaUsada: isr?.formulaUsada,
      requiereRevision: isr?.requiereRevision,
      errorCalculo: isr?.errorCalculo
    }
  });

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

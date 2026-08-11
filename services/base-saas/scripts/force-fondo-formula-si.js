'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const {
  FORMULA_FONDO_EMPRESA,
  FORMULA_FONDO_TRABAJADOR
} = require('../config/nominaConceptosCapaC');

(async () => {
  await mongoose.connect(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config');
  const t = await mongoose.connection.collection('tenants').findOne({ slug: 'empresa-demo' });
  const tid = t.tenantId;
  const colF = mongoose.connection.collection('nomina_formulas');
  const codes = ['FONDO_AHORRO_EMPRESA', 'DED_FONDO_AHORRO', 'DED_FONDO_AHORRO_EMPRESA'];

  const before = await colF
    .find({ tenantId: tid, conceptoCodigo: { $in: codes } })
    .project({
      conceptoCodigo: 1,
      tipoPeriodo: 1,
      formula: 1,
      condicion: 1,
      activo: 1,
      empresaId: 1,
      version: 1,
      vigenciaDesde: 1,
      vigenciaHasta: 1
    })
    .toArray();
  console.log('ANTES', JSON.stringify(before, null, 2));

  const map = {
    FONDO_AHORRO_EMPRESA: FORMULA_FONDO_EMPRESA,
    DED_FONDO_AHORRO: FORMULA_FONDO_TRABAJADOR,
    DED_FONDO_AHORRO_EMPRESA: FORMULA_FONDO_EMPRESA
  };
  const periodos = ['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'];
  const vigenciaDesde = new Date('2026-01-01T00:00:00Z');

  for (const codigo of codes) {
    // Desactivar todas
    await colF.updateMany(
      { tenantId: tid, conceptoCodigo: codigo },
      { $set: { activo: false, updatedAt: new Date() } }
    );
    for (const tipoPeriodo of periodos) {
      await colF.updateOne(
        {
          tenantId: tid,
          conceptoCodigo: codigo,
          tipoPeriodo,
          tipoNomina: 'ordinaria',
          empresaId: null
        },
        {
          $set: {
            formula: map[codigo],
            condicion: '',
            dependencias: [],
            tipoAplicacion: 'FIJO',
            fase: codigo.startsWith('DED_') ? 2 : 1,
            activo: true,
            redondeo: 2,
            version: 3,
            vigenciaDesde,
            vigenciaHasta: null,
            updatedAt: new Date()
          },
          $setOnInsert: {
            tenantId: tid,
            empresaId: null,
            conceptoCodigo: codigo,
            tipoPeriodo,
            tipoNomina: 'ordinaria',
            createdAt: new Date()
          }
        },
        { upsert: true }
      );
    }
  }

  const after = await colF
    .find({ tenantId: tid, conceptoCodigo: { $in: codes }, activo: true })
    .project({ conceptoCodigo: 1, tipoPeriodo: 1, formula: 1, condicion: 1, activo: 1, version: 1 })
    .toArray();
  console.log('DESPUES activas', JSON.stringify(after, null, 2));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

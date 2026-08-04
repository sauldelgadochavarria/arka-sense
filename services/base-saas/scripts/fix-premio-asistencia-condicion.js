'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');

async function main() {
  await mongoose.connect(dbConfig.connectionStringConfig || process.env.MONGO_URI || 'mongodb://localhost:27020/config');
  const t = await mongoose.connection.collection('tenants').findOne({ slug: 'empresa-demo' });
  if (!t) throw new Error('tenant no encontrado');
  const col = mongoose.connection.collection('nomina_formulas');
  const tid = t.tenantId;
  const periodos = ['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'];
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const ayer = new Date(hoy.getTime() - 1);
  const condicion = 'diasLaborados >= diasProgramados';

  for (const tp of periodos) {
    await col.updateMany(
      {
        tenantId: tid,
        conceptoCodigo: 'PREMIO_ASISTENCIA',
        tipoPeriodo: tp,
        tipoNomina: 'ordinaria',
        activo: true,
        vigenciaHasta: null,
        $or: [{ empresaId: null }, { empresaId: { $exists: false } }]
      },
      { $set: { vigenciaHasta: ayer } }
    );
    const last = await col
      .find({ tenantId: tid, conceptoCodigo: 'PREMIO_ASISTENCIA', tipoPeriodo: tp, tipoNomina: 'ordinaria' })
      .sort({ version: -1 })
      .limit(1)
      .next();
    const version = (last && last.version ? last.version : 0) + 1;
    await col.insertOne({
      tenantId: tid,
      empresaId: null,
      conceptoCodigo: 'PREMIO_ASISTENCIA',
      tipoPeriodo: tp,
      tipoNomina: 'ordinaria',
      fase: 1,
      tipoAplicacion: 'EVENTUAL',
      vigenciaDesde: hoy,
      vigenciaHasta: null,
      condicion,
      formula: '500',
      dependencias: [],
      redondeo: 2,
      version,
      activo: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    console.log('updated', tp, 'v' + version);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

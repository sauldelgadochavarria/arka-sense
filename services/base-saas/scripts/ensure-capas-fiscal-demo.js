'use strict';

/** Aplica ensure capa B/C (fiscal completo) al tenant demo. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const {
  ensureCapaBConceptosForTenant,
  ensureCapaCConceptosForTenant
} = require('../services/nomina/nominaConceptoService');

(async () => {
  await mongoose.connect(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config');
  const t = await mongoose.connection.collection('tenants').findOne({ slug: 'empresa-demo' });
  const e = await mongoose.connection.collection('empresas').findOne({ tenantId: t.tenantId });
  await ensureCapaBConceptosForTenant(t.tenantId, e._id);
  await ensureCapaCConceptosForTenant(t.tenantId, e._id);

  const codes = [
    'FONDO_AHORRO_EMPRESA',
    'DED_FONDO_AHORRO',
    'DED_FONDO_AHORRO_EMPRESA',
    'PREMIO_PUNTUALIDAD',
    'PREMIO_ASISTENCIA'
  ];
  const docs = await mongoose.connection
    .collection('nomina_conceptos')
    .find({ tenantId: t.tenantId, codigo: { $in: codes } })
    .project({ codigo: 1, naturaleza: 1, 'fiscal.naturaleza': 1, 'fiscal.desglose': 1, 'fiscal.imss': 1, activo: 1 })
    .toArray();
  console.log(JSON.stringify(docs, null, 2));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

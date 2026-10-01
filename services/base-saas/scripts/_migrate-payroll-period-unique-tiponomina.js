'use strict';

/**
 * Sustituye el unique de payroll_periods:
 *   (tenant, empresa, sub, tipoPeriodoId, anio, numeroPeriodo)
 * por uno que también incluye tipoNomina (alineado a PeriodoNomina).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const OLD =
  'tenantId_1_empresaId_1_subsidiariaId_1_tipoPeriodoId_1_anio_1_numeroPeriodo_1';
const NEW =
  'tenantId_1_empresaId_1_subsidiariaId_1_tipoPeriodoId_1_tipoNomina_1_anio_1_numeroPeriodo_1';

(async () => {
  const getP = require('../models/payrollPeriod');
  const P = await getP();
  const col = P.collection;
  const before = (await col.indexes()).map((i) => i.name);
  console.log('before', before);

  if (before.includes(OLD)) {
    console.log('drop', OLD);
    await col.dropIndex(OLD);
  }

  await P.syncIndexes();

  const after = (await col.indexes()).map((i) => i.name);
  console.log('after', after);
  console.log('hasNew', after.includes(NEW));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

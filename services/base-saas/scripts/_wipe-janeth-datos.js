#!/usr/bin/env node
'use strict';

/**
 * Borra datos operativos de la subsidiaria Janeth; conserva empresa y la subsidiaria.
 *   node scripts/_wipe-janeth-datos.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');

const SUB_ID = '6abeeb4dc5a3517e2eb7aad2';
const EMPRESA_ID = '6a31b72ad1c37344e497e67b';
const TENANT = '09438d66-db3a-4d7e-8d1d-0ad63357eabb';

async function del(col, filter, label) {
  const r = await col.deleteMany(filter);
  console.log(`  ${label}: ${r.deletedCount}`);
  return r.deletedCount;
}

async function main() {
  await mongoose.connect(dbConfig.connectionStringConfig);
  const db = mongoose.connection.db;
  const subOid = new mongoose.Types.ObjectId(SUB_ID);
  const empOid = new mongoose.Types.ObjectId(EMPRESA_ID);

  const sub = await db.collection('subsidiarias').findOne({ _id: subOid });
  console.log('Subsidiaria:', sub ? sub.nombre || sub.razonSocial || SUB_ID : 'NO ENCONTRADA');
  if (!sub) {
    console.error('Abort: subsidiaria Janeth no existe');
    process.exit(1);
  }

  // Empleados de la sub
  const empIds = await db
    .collection('empleados')
    .find({ tenantId: TENANT, subsidiariaId: subOid })
    .project({ _id: 1 })
    .toArray()
    .then((rows) => rows.map((r) => r._id));
  console.log('Empleados Janeth:', empIds.length);

  // Períodos de la sub
  const periodoIds = await db
    .collection('nomina_periods')
    .find({ tenantId: TENANT, subsidiariaId: subOid })
    .project({ _id: 1 })
    .toArray()
    .then((rows) => rows.map((r) => r._id));
  console.log('Períodos Janeth:', periodoIds.length);

  console.log('Borrando…');

  if (periodoIds.length) {
    await del(
      db.collection('nomina_recibos'),
      { periodoId: { $in: periodoIds } },
      'nomina_recibos (por periodo)'
    );
    await del(
      db.collection('nomina_conceptos_aplicados'),
      { periodoId: { $in: periodoIds } },
      'nomina_conceptos_aplicados (por periodo)'
    );
    await del(
      db.collection('nomina_calculo_jobs'),
      { periodoId: { $in: periodoIds } },
      'nomina_calculo_jobs'
    );
    await del(
      db.collection('nomina_auditoria'),
      { periodoId: { $in: periodoIds } },
      'nomina_auditoria (periodo)'
    );
  }

  if (empIds.length) {
    await del(
      db.collection('nomina_historico_recibos'),
      { empleadoId: { $in: empIds } },
      'nomina_historico_recibos (por empleado)'
    );
    await del(
      db.collection('nomina_acumulados'),
      { empleadoId: { $in: empIds } },
      'nomina_acumulados (por empleado)'
    );
    await del(
      db.collection('nomina_cfdi_archivos'),
      { empleadoId: { $in: empIds } },
      'nomina_cfdi_archivos (por empleado)'
    );
    await del(
      db.collection('historial_laboral'),
      { empleadoId: { $in: empIds } },
      'historial_laboral'
    );
    await del(
      db.collection('movimientos_asistencia_nomina'),
      { empleadoId: { $in: empIds } },
      'movimientos_asistencia_nomina'
    );
    await del(
      db.collection('nomina_recibos'),
      { empleadoId: { $in: empIds } },
      'nomina_recibos (por empleado)'
    );
  }

  await del(
    db.collection('nomina_historico_recibos'),
    { tenantId: TENANT, subsidiariaId: subOid },
    'nomina_historico_recibos (sub)'
  );
  await del(
    db.collection('nomina_acumulados'),
    { tenantId: TENANT, subsidiariaId: subOid },
    'nomina_acumulados (sub)'
  );
  await del(
    db.collection('nomina_cfdi_archivos'),
    { tenantId: TENANT, subsidiariaId: subOid },
    'nomina_cfdi_archivos (sub)'
  );
  await del(
    db.collection('nomina_periods'),
    { tenantId: TENANT, subsidiariaId: subOid },
    'nomina_periods'
  );
  await del(
    db.collection('payroll_periods'),
    { tenantId: TENANT, subsidiariaId: subOid },
    'payroll_periods'
  );
  await del(
    db.collection('empleados'),
    { tenantId: TENANT, subsidiariaId: subOid },
    'empleados'
  );
  await del(
    db.collection('subsidiary_concept_config'),
    { tenantId: TENANT, subsidiariaId: subOid },
    'subsidiary_concept_config'
  );
  await del(
    db.collection('sat_concepto_motor_map'),
    { tenantId: TENANT, subsidiariaId: subOid },
    'sat_concepto_motor_map'
  );

  // Jobs / staging CFDI de esa sub
  await del(
    db.collection('cargas_iniciales_jobs'),
    { tenantId: TENANT, subsidiariaId: subOid },
    'cargas_iniciales_jobs (sub)'
  );
  await del(
    db.collection('cargas_iniciales_jobs'),
    { tenantId: TENANT, 'resumen.subsidiariaId': SUB_ID },
    'cargas_iniciales_jobs (resumen.sub string)'
  );
  await del(
    db.collection('cargas_iniciales_jobs'),
    { tenantId: TENANT, 'resumen.subsidiariaId': subOid },
    'cargas_iniciales_jobs (resumen.sub oid)'
  );
  await del(
    db.collection('carga_cfdi_staging'),
    { tenantId: TENANT, subsidiariaId: subOid },
    'carga_cfdi_staging'
  );

  // Tipos de período creados solo para la sub (si existen)
  await del(
    db.collection('tipos_periodo_nomina'),
    { tenantId: TENANT, subsidiariaId: subOid },
    'tipos_periodo_nomina (sub)'
  );

  // Finiquitos si hubiera
  try {
    await del(
      db.collection('finiquito_calculos'),
      { tenantId: TENANT, subsidiariaId: subOid },
      'finiquito_calculos'
    );
  } catch (_) {
    /* colección opcional */
  }

  // Verificación
  const left = {
    empleados: await db.collection('empleados').countDocuments({ subsidiariaId: subOid }),
    periodos: await db.collection('nomina_periods').countDocuments({ subsidiariaId: subOid }),
    historico: await db.collection('nomina_historico_recibos').countDocuments({ subsidiariaId: subOid }),
    acumulados: await db.collection('nomina_acumulados').countDocuments({ subsidiariaId: subOid }),
    subCfg: await db.collection('subsidiary_concept_config').countDocuments({ subsidiariaId: subOid }),
    empresa: await db.collection('empresas').countDocuments({ _id: empOid }),
    subsidiaria: await db.collection('subsidiarias').countDocuments({ _id: subOid })
  };
  console.log('Queda:', left);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

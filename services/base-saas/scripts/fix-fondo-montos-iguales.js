'use strict';

/**
 * Unifica fórmulas de fondo a insumos (misma mitad) y recalcula período demo.
 *   node scripts/fix-fondo-montos-iguales.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const {
  FORMULA_FONDO_EMPRESA,
  FORMULA_FONDO_TRABAJADOR
} = require('../config/nominaConceptosCapaC');
const { calcularPeriodo } = require('../services/nomina/calculoNominaService');

(async () => {
  await mongoose.connect(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config');
  const t = await mongoose.connection.collection('tenants').findOne({ slug: 'empresa-demo' });
  const tid = t.tenantId;
  const colF = mongoose.connection.collection('nomina_formulas');
  const periodos = ['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'];

  for (const tipoPeriodo of periodos) {
    await colF.updateMany(
      { tenantId: tid, conceptoCodigo: 'FONDO_AHORRO_EMPRESA', tipoPeriodo },
      { $set: { formula: FORMULA_FONDO_EMPRESA, condicion: 'aplicaFondoAhorro == 1', activo: true } }
    );
    await colF.updateMany(
      { tenantId: tid, conceptoCodigo: 'DED_FONDO_AHORRO_EMPRESA', tipoPeriodo },
      { $set: { formula: FORMULA_FONDO_EMPRESA, condicion: 'aplicaFondoAhorro == 1', activo: true } }
    );
    await colF.updateMany(
      { tenantId: tid, conceptoCodigo: 'DED_FONDO_AHORRO', tipoPeriodo },
      { $set: { formula: FORMULA_FONDO_TRABAJADOR, condicion: 'aplicaFondoAhorro == 1', activo: true } }
    );
    await colF.updateMany(
      { tenantId: tid, conceptoCodigo: 'FONDO_AHORRO_TRABAJADOR', tipoPeriodo },
      { $set: { activo: false, condicion: '0 == 1' } }
    );
  }
  console.log('✓ fórmulas fondo → fondoAhorroEmpresa / fondoAhorroTrabajador');

  const periodo = await mongoose.connection.collection('nomina_periods').findOne({
    tenantId: tid,
    _id: new mongoose.Types.ObjectId('6a73db159c0cfe3c74708938')
  });
  if (!periodo) {
    const alt = await mongoose.connection.collection('nomina_periods').findOne({
      tenantId: tid,
      tipoPeriodo: 'quincenal'
    }, { sort: { fechaInicio: -1 } });
    if (!alt) {
      console.log('sin período quincenal');
    } else {
      await recalcularYMostrar(tid, alt);
    }
  } else {
    await recalcularYMostrar(tid, periodo);
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function recalcularYMostrar(tid, periodo) {
  await mongoose.connection
    .collection('nomina_periods')
    .updateOne({ _id: periodo._id }, { $set: { estatus: 'abierto' } });
  await calcularPeriodo(tid, periodo._id, {});
  const emp = await mongoose.connection.collection('empleados').findOne({
    tenantId: tid,
    numEmpleado: '100'
  });
  if (!emp) {
    console.log('sin empleado 100');
    return;
  }
  const recibo = await mongoose.connection.collection('nomina_recibos').findOne({
    tenantId: tid,
    periodoId: periodo._id,
    empleadoId: emp._id
  });
  if (!recibo) {
    console.log('sin recibo');
    return;
  }
  const codes = ['FONDO_AHORRO_EMPRESA', 'DED_FONDO_AHORRO', 'DED_FONDO_AHORRO_EMPRESA'];
  const lineas = await mongoose.connection
    .collection('nomina_conceptos_aplicados')
    .find({ tenantId: tid, reciboId: recibo._id, conceptoCodigo: { $in: codes } })
    .project({ conceptoCodigo: 1, importe: 1, gravado: 1, exento: 1, formulaUsada: 1 })
    .toArray();
  console.log(JSON.stringify(lineas, null, 2));
  const a = lineas.find((l) => l.conceptoCodigo === 'FONDO_AHORRO_EMPRESA')?.importe;
  const b = lineas.find((l) => l.conceptoCodigo === 'DED_FONDO_AHORRO')?.importe;
  const c = lineas.find((l) => l.conceptoCodigo === 'DED_FONDO_AHORRO_EMPRESA')?.importe;
  console.log('iguales?', a === b && b === c, { percepcion: a, dedTrab: b, dedEmp: c });
}
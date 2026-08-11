'use strict';
/**
 * Asegura fórmulas PRIMA_VACACIONAL para ordinaria (+ extraordinaria) y recalcula demo.
 *   node scripts/fix-prima-vacacional-ordinaria.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { calcularPeriodo } = require('../services/nomina/calculoNominaService');
const {
  diasVacacionesPorAntiguedad,
  calcularAniosServicio,
  aniversarioCaeEnPeriodo
} = require('../config/vacacionesLFT');

const PERIODOS = ['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'];
const NOMINAS = ['ordinaria', 'extraordinaria'];
const FORMULA = 'si(diasPrimaVacacional > 0, sueldoDiario * diasPrimaVacacional * (primaVacacionalPct / 100), 0)';
const CONDICION = 'diasPrimaVacacional > 0';
const PERIODO_DEMO_ID = '6a73db159c0cfe3c74708938';

async function upsertFormula(colF, tid, tipoPeriodo, tipoNomina) {
  const vigenciaDesde = new Date('2026-01-01T00:00:00Z');
  await colF.updateMany(
    {
      tenantId: tid,
      conceptoCodigo: 'PRIMA_VACACIONAL',
      tipoPeriodo,
      tipoNomina
    },
    { $set: { activo: false, updatedAt: new Date() } }
  );
  await colF.updateOne(
    {
      tenantId: tid,
      conceptoCodigo: 'PRIMA_VACACIONAL',
      tipoPeriodo,
      tipoNomina,
      empresaId: null
    },
    {
      $set: {
        formula: FORMULA,
        condicion: CONDICION,
        dependencias: [],
        tipoAplicacion: 'EVENTUAL',
        fase: 1,
        activo: true,
        redondeo: 2,
        version: 2,
        vigenciaDesde,
        vigenciaHasta: null,
        updatedAt: new Date()
      },
      $setOnInsert: {
        tenantId: tid,
        empresaId: null,
        conceptoCodigo: 'PRIMA_VACACIONAL',
        tipoPeriodo,
        tipoNomina,
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
}

(async () => {
  await mongoose.connect(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config');
  const t = await mongoose.connection.collection('tenants').findOne({ slug: 'empresa-demo' });
  const tid = t.tenantId;
  const colF = mongoose.connection.collection('nomina_formulas');

  for (const tp of PERIODOS) {
    for (const tn of NOMINAS) {
      await upsertFormula(colF, tid, tp, tn);
    }
  }
  console.log('✓ fórmulas PRIMA_VACACIONAL ordinaria/extraordinaria');

  await mongoose.connection.collection('company_concept_config').updateOne(
    { tenantId: tid, conceptoCodigo: 'PRIMA_VACACIONAL' },
    { $set: { tipoAplicacion: 'EVENTUAL', activo: true, deshabilitado: false } }
  );

  const emp = await mongoose.connection.collection('empleados').findOne({
    tenantId: tid,
    numEmpleado: '100'
  });
  const periodo = await mongoose.connection
    .collection('nomina_periods')
    .findOne({ _id: new mongoose.Types.ObjectId(PERIODO_DEMO_ID) });

  console.log('emp ingreso', emp.fechaIngreso);
  console.log('periodo', periodo.fechaInicio, '→', periodo.fechaFin);
  console.log(
    'aniversario en período?',
    aniversarioCaeEnPeriodo(emp.fechaIngreso, periodo.fechaInicio, periodo.fechaFin)
  );
  const anios = calcularAniosServicio(emp.fechaIngreso, new Date('2026-07-03T12:00:00Z'));
  console.log('años / días LFT', anios, diasVacacionesPorAntiguedad(anios));
  console.log('esperado prima ≈', emp.salarioDiario * diasVacacionesPorAntiguedad(anios) * 0.25);

  await mongoose.connection
    .collection('nomina_periods')
    .updateOne({ _id: periodo._id }, { $set: { estatus: 'abierto' } });

  const result = await calcularPeriodo(tid, periodo._id, {});
  console.log('cálculo', { exitos: result.exitos, errores: result.errores });

  const recibo = await mongoose.connection.collection('nomina_recibos').findOne({
    tenantId: tid,
    periodoId: periodo._id,
    empleadoId: emp._id
  });
  const linea = await mongoose.connection.collection('nomina_conceptos_aplicados').findOne({
    tenantId: tid,
    reciboId: recibo._id,
    conceptoCodigo: 'PRIMA_VACACIONAL'
  });
  console.log('PRIMA_VACACIONAL', {
    importe: linea?.importe,
    gravado: linea?.gravado,
    exento: linea?.exento,
    formula: linea?.formulaUsada,
    condicion: linea?.condicionUsada
  });

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

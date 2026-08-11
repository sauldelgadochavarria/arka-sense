'use strict';

/**
 * Alinea fórmulas/config de conceptos demo con lo que el motor debe calcular.
 * Deduplica fórmulas activas conflictivas y recalcula el período quincenal demo.
 *
 *   node scripts/sync-config-vs-calculo.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const {
  CONCEPTOS_CAPA_C,
  FORMULA_FONDO_EMPRESA,
  FORMULA_FONDO_TRABAJADOR,
  buildCapaCFormulasForPeriodo
} = require('../config/nominaConceptosCapaC');
const { buildCapaBFormulasForPeriodo } = require('../config/nominaConceptosCapaB');
const { calcularPeriodo } = require('../services/nomina/calculoNominaService');

const PERIODOS = ['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'];
const PERIODO_DEMO_ID = '6a73db159c0cfe3c74708938';

const FORMULAS_CANONICAS = {
  SUELDO: {
    // Quincena demo: 15 días de período (no usar diasPagados si la política lo infla)
    formula: 'EMPLEADO.salarioDiario * PERIODO.diasTrabajados',
    condicion: '',
    fase: 1
  },
  ISR: {
    formula: 'si(PERCEPCIONES_GRAVADAS > 0, isrPeriodo(PERCEPCIONES_GRAVADAS), 0)',
    condicion: '',
    fase: 2
  },
  IMSS_OBRERO: {
    formula: 'si(diasCotizacion > 0, imssObrero(sueldoDiario, diasCotizacion), 0)',
    condicion: '',
    fase: 2
  },
  FONDO_AHORRO_EMPRESA: {
    formula: FORMULA_FONDO_EMPRESA,
    condicion: '',
    fase: 1
  },
  DED_FONDO_AHORRO: {
    formula: FORMULA_FONDO_TRABAJADOR,
    condicion: '',
    fase: 2
  },
  DED_FONDO_AHORRO_EMPRESA: {
    formula: FORMULA_FONDO_EMPRESA,
    condicion: '',
    fase: 2
  },
  DESPENSA: { formula: 'si(pagaDespensa == 1, despensaMonto, 0)', condicion: '', fase: 1 },
  SEGURO_VIDA: { formula: 'si(seguroVidaMonto > 0, seguroVidaMonto, 0)', condicion: '', fase: 1 },
  SGMM: { formula: 'si(sgmmMonto > 0, sgmmMonto, 0)', condicion: '', fase: 1 },
  DED_SEGURO_VIDA: { formula: 'si(seguroVidaMonto > 0, seguroVidaMonto, 0)', condicion: '', fase: 2 },
  DED_SGMM: { formula: 'si(sgmmMonto > 0, sgmmMonto, 0)', condicion: '', fase: 2 },
  PREMIO_PUNTUALIDAD: {
    formula: 'si(INCIDENCIAS.sinRetardo == 1, 500, 0)',
    condicion: '',
    fase: 1
  },
  PREMIO_ASISTENCIA: {
    formula: 'si(diasLaborados >= diasProgramados, 500, 0)',
    condicion: '',
    fase: 1
  },
  HORAS_EXTRA_DOBLES: {
    formula:
      'si(INCIDENCIAS.horasExtraDobles > 0, (EMPLEADO.salarioDiario / EMPLEADO.horasJornada) * INCIDENCIAS.horasExtraDobles * 2, 0)',
    condicion: '',
    fase: 1
  },
  HORAS_EXTRA_TRIPLES: {
    formula:
      'si(INCIDENCIAS.horasExtraTriples > 0, (EMPLEADO.salarioDiario / EMPLEADO.horasJornada) * INCIDENCIAS.horasExtraTriples * 3, 0)',
    condicion: '',
    fase: 1
  },
  IMSS_PATRONAL: {
    formula: 'si(diasCotizacion > 0, imssPatronal(sueldoDiario, diasCotizacion), 0)',
    condicion: '',
    fase: 2
  }
};

function formulaFromCapa(codigo, tipoPeriodo) {
  const fromC = buildCapaCFormulasForPeriodo(tipoPeriodo).find((f) => f.conceptoCodigo === codigo);
  if (fromC) return fromC;
  return buildCapaBFormulasForPeriodo(tipoPeriodo).find((f) => f.conceptoCodigo === codigo);
}

async function upsertCanonicalFormula(colF, tid, codigo, tipoPeriodo, spec) {
  const vigenciaDesde = new Date('2026-01-01T00:00:00Z');
  // Desactivar todas las demás del mismo concepto+periodo
  await colF.updateMany(
    { tenantId: tid, conceptoCodigo: codigo, tipoPeriodo, tipoNomina: 'ordinaria' },
    { $set: { activo: false, updatedAt: new Date() } }
  );

  const filter = {
    tenantId: tid,
    conceptoCodigo: codigo,
    tipoPeriodo,
    tipoNomina: 'ordinaria',
    empresaId: null
  };
  await colF.updateOne(
    filter,
    {
      $set: {
        formula: spec.formula,
        condicion: spec.condicion || '',
        dependencias: spec.dependencias || [],
        tipoAplicacion: 'FIJO',
        fase: spec.fase || 1,
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
        conceptoCodigo: codigo,
        tipoPeriodo,
        tipoNomina: 'ordinaria',
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
  const colC = mongoose.connection.collection('nomina_conceptos');

  // 1) Fiscal fondo desde capa C
  for (const c of CONCEPTOS_CAPA_C) {
    if (!c.fiscal) continue;
    await colC.updateOne(
      { tenantId: tid, codigo: c.codigo },
      {
        $set: {
          naturaleza: c.naturaleza,
          fiscal: c.fiscal,
          activo: c.metadata?.deprecado ? false : true,
          updatedAt: new Date()
        }
      }
    );
  }
  console.log('✓ fiscal fondo (capa C) aplicado a conceptos');

  await colC.updateOne(
    { tenantId: tid, codigo: 'DESPENSA' },
    {
      $set: {
        categoria: 'prevision_social',
        naturaleza: 'mixto',
        'fiscal.naturaleza': 'mixto',
        'fiscal.integraISR': true,
        'fiscal.integraIMSS': true,
        'fiscal.desglose': { modo: 'regla_ley', codigoRegla: 'despensa' },
        updatedAt: new Date()
      }
    }
  );
  console.log('✓ DESPENSA → mixto ISR (regla despensa: 1 UMA mensual / 7 UMA semanal)');

  await mongoose.connection.collection('empleados').updateOne(
    { tenantId: tid, numEmpleado: '100' },
    {
      $set: {
        'nominaConfig.despensaModalidad': 'fijo',
        'nominaConfig.despensaMontoMensual': 3566,
        'nominaConfig.despensaMonto': 3566,
        'nominaConfig.despensaTopeModo': 'sin_tope',
        updatedAt: new Date()
      }
    }
  );
  console.log('✓ emp 100 despensa modalidad fijo');

  // 2) Fórmulas canónicas por período
  for (const tipoPeriodo of PERIODOS) {
    for (const [codigo, base] of Object.entries(FORMULAS_CANONICAS)) {
      await upsertCanonicalFormula(colF, tid, codigo, tipoPeriodo, base);
    }

    for (const codigo of ['PERCEPCIONES_GRAVADAS', 'DEDUCCIONES_TOTALES', 'NETO_PAGAR']) {
      const fromSeed = formulaFromCapa(codigo, tipoPeriodo === 'decena' ? 'mensual' : tipoPeriodo);
      const fallback = {
        PERCEPCIONES_GRAVADAS: {
          formula: '0',
          fase: 2
        },
        DEDUCCIONES_TOTALES: {
          formula:
            'ISR + IMSS_OBRERO + DED_FONDO_AHORRO + DED_FONDO_AHORRO_EMPRESA + DED_SEGURO_VIDA + DED_SGMM',
          fase: 3
        },
        NETO_PAGAR: {
          formula:
            'SUELDO + HORAS_EXTRA_DOBLES + HORAS_EXTRA_TRIPLES + PREMIO_PUNTUALIDAD + PREMIO_ASISTENCIA + DESPENSA + SEGURO_VIDA + SGMM + FONDO_AHORRO_EMPRESA - DEDUCCIONES_TOTALES',
          fase: 4
        }
      }[codigo];
      await upsertCanonicalFormula(colF, tid, codigo, tipoPeriodo, {
        formula: fromSeed?.formula || fallback.formula,
        condicion: fromSeed?.condicion || '',
        dependencias: fromSeed?.dependencias || [],
        fase: fallback.fase
      });
    }

    // Premios: una sola activa con condición real (no 0==1)
    await colF.updateMany(
      { tenantId: tid, conceptoCodigo: 'PREMIO_PUNTUALIDAD', tipoPeriodo },
      { $set: { activo: false } }
    );
    await upsertCanonicalFormula(colF, tid, 'PREMIO_PUNTUALIDAD', tipoPeriodo, {
      formula: '500',
      condicion: 'INCIDENCIAS.sinRetardo == 1',
      fase: 1
    });
    await colF.updateMany(
      { tenantId: tid, conceptoCodigo: 'PREMIO_ASISTENCIA', tipoPeriodo },
      { $set: { activo: false } }
    );
    await upsertCanonicalFormula(colF, tid, 'PREMIO_ASISTENCIA', tipoPeriodo, {
      formula: '500',
      condicion: 'diasLaborados >= diasProgramados',
      fase: 1
    });
  }
  console.log('✓ fórmulas canónicas (sin duplicados activos)');

  // 3) Recalcular demo
  const periodoId = new mongoose.Types.ObjectId(PERIODO_DEMO_ID);
  await mongoose.connection
    .collection('nomina_periods')
    .updateOne(
      { _id: periodoId },
      {
        $set: {
          estatus: 'abierto',
          'prestaciones.pagaDespensa': true,
          'prestaciones.despensaPagoMensual': true
        }
      }
    );
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
  const lineas = await mongoose.connection
    .collection('nomina_conceptos_aplicados')
    .find({ tenantId: tid, reciboId: recibo._id })
    .project({ conceptoCodigo: 1, importe: 1, formulaUsada: 1, gravado: 1, exento: 1 })
    .toArray();

  const pick = (c) => lineas.find((l) => l.conceptoCodigo === c);
  const percCodes = [
    'SUELDO',
    'DESPENSA',
    'FONDO_AHORRO_EMPRESA',
    'SEGURO_VIDA',
    'SGMM',
    'PREMIO_PUNTUALIDAD',
    'PREMIO_ASISTENCIA'
  ];
  const dedCodes = [
    'ISR',
    'IMSS_OBRERO',
    'DED_FONDO_AHORRO',
    'DED_FONDO_AHORRO_EMPRESA',
    'DED_SEGURO_VIDA',
    'DED_SGMM'
  ];
  const sp = percCodes.reduce((s, c) => s + (Number(pick(c)?.importe) || 0), 0);
  const sd = dedCodes.reduce((s, c) => s + (Number(pick(c)?.importe) || 0), 0);
  const neto = pick('NETO_PAGAR')?.importe;
  const dedTot = pick('DEDUCCIONES_TOTALES')?.importe;

  console.log('\n=== Verificación emp 100 ===');
  console.log({
    FONDO_AHORRO_EMPRESA: pick('FONDO_AHORRO_EMPRESA'),
    DED_FONDO_AHORRO: pick('DED_FONDO_AHORRO')?.importe,
    DED_FONDO_AHORRO_EMPRESA: pick('DED_FONDO_AHORRO_EMPRESA')?.importe,
    DEDUCCIONES_TOTALES: { importe: dedTot, formula: pick('DEDUCCIONES_TOTALES')?.formulaUsada },
    NETO_PAGAR: { importe: neto, formula: pick('NETO_PAGAR')?.formulaUsada },
    sumaPerc: Math.round(sp * 100) / 100,
    sumaDed: Math.round(sd * 100) / 100,
    netoEsperado: Math.round((sp - sd) * 100) / 100,
    dedMatch: Math.abs((dedTot || 0) - sd) < 0.02,
    netoMatch: Math.abs((neto || 0) - (sp - sd)) < 0.02
  });

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

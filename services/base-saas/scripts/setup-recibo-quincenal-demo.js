'use strict';

/**
 * Configura empleado + conceptos estilo recibo ISA quincenal
 * (SD 2587.93, despensa, fondo, vida, SGMM) y calcula 1–15 jul 2026.
 *
 *   node scripts/setup-recibo-quincenal-demo.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { emptyImssDesglose } = require('../models/fiscalConceptoShared');
const { startOfDay, endOfDay, diasCalendarioInclusive } = require('../libs/timeHelpers');
const { calcularPeriodo } = require('../services/nomina/calculoNominaService');

const TARGET = {
  numEmpleado: '100',
  sd: 2587.93,
  sdi: 2932.75,
  sueldo: 38819,
  despensa: 3566,
  fondo: 2318,
  vida: 730,
  sgmm: 3222,
  totalPerc: 48655,
  imss: 1199,
  isr: 8555,
  totalDed: 18342,
  neto: 30313
};

function imssExcluido() {
  return { naturalezaSdi: 'excluido', desglose: emptyImssDesglose({ modo: 'todo_excluye' }) };
}

function imssFijoDespensa() {
  return {
    naturalezaSdi: 'fijo',
    desglose: emptyImssDesglose({
      modo: 'regla_ley',
      topeNoIntegraUMA: 0.4,
      codigoRegla: 'despensa_40_uma'
    })
  };
}

const NUEVOS_CONCEPTOS = [
  {
    codigo: 'DESPENSA',
    nombre: 'Vales de despensa',
    tipo: 'percepcion',
    naturaleza: 'mixto',
    categoria: 'prevision_social',
    ordenCalculo: 20,
    sat: { tipo: 'percepcion', clave: '029', descripcion: 'Vales de despensa' },
    fiscal: {
      naturaleza: 'mixto',
      integraISR: true,
      integraIMSS: true,
      integraINFONAVIT: false,
      desglose: {
        modo: 'regla_ley',
        codigoRegla: 'despensa'
      },
      imss: imssFijoDespensa()
    }
  },
  {
    codigo: 'SEGURO_VIDA',
    nombre: 'Seguro de vida',
    tipo: 'percepcion',
    naturaleza: 'exento',
    ordenCalculo: 22,
    sat: { tipo: 'percepcion', clave: '011', descripcion: 'Seguros de vida' },
    fiscal: {
      naturaleza: 'exento',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_exento' },
      imss: imssExcluido()
    }
  },
  {
    codigo: 'SGMM',
    nombre: 'Seguro de gastos médicos mayores',
    tipo: 'percepcion',
    naturaleza: 'exento',
    ordenCalculo: 23,
    sat: { tipo: 'percepcion', clave: '012', descripcion: 'Seguro de gastos médicos mayores' },
    fiscal: {
      naturaleza: 'exento',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_exento' },
      imss: imssExcluido()
    }
  },
  {
    codigo: 'DED_SEGURO_VIDA',
    nombre: 'Deducción seguro de vida',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    ordenCalculo: 62,
    sat: { tipo: 'deduccion', clave: '004', descripcion: 'Otros' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado' },
      imss: imssExcluido()
    }
  },
  {
    codigo: 'DED_SGMM',
    nombre: 'Deducción SGMM',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    ordenCalculo: 63,
    sat: { tipo: 'deduccion', clave: '004', descripcion: 'Otros' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado' },
      imss: imssExcluido()
    }
  },
  {
    codigo: 'DED_FONDO_AHORRO_EMPRESA',
    nombre: 'Deducción fondo de ahorro empresa',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    ordenCalculo: 58,
    sat: { tipo: 'deduccion', clave: '004', descripcion: 'Otros' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado' },
      imss: imssExcluido()
    }
  }
];

const FORMULAS_QUINCENA = [
  {
    codigo: 'SUELDO',
    formula: 'EMPLEADO.salarioDiario * PERIODO.diasTrabajados',
    condicion: '',
    tipoAplicacion: 'FIJO',
    fase: 1
  },
  {
    codigo: 'DESPENSA',
    formula: 'si(pagaDespensa == 1, despensaMonto, 0)',
    condicion: '',
    tipoAplicacion: 'FIJO',
    fase: 1
  },
  {
    codigo: 'FONDO_AHORRO_EMPRESA',
    formula: 'si(aplicaFondoAhorro == 1, fondoAhorroEmpresa, 0)',
    condicion: '',
    tipoAplicacion: 'FIJO',
    fase: 1
  },
  {
    codigo: 'DED_FONDO_AHORRO',
    formula: 'si(aplicaFondoAhorro == 1, fondoAhorroTrabajador, 0)',
    condicion: '',
    tipoAplicacion: 'FIJO',
    fase: 2
  },
  {
    codigo: 'DED_FONDO_AHORRO_EMPRESA',
    formula: 'si(aplicaFondoAhorro == 1, fondoAhorroEmpresa, 0)',
    condicion: '',
    tipoAplicacion: 'FIJO',
    fase: 2
  },
  {
    codigo: 'SEGURO_VIDA',
    formula: 'si(seguroVidaMonto > 0, seguroVidaMonto, 0)',
    condicion: '',
    tipoAplicacion: 'FIJO',
    fase: 1
  },
  {
    codigo: 'SGMM',
    formula: 'si(sgmmMonto > 0, sgmmMonto, 0)',
    condicion: '',
    tipoAplicacion: 'FIJO',
    fase: 1
  },
  {
    codigo: 'DED_SEGURO_VIDA',
    formula: 'si(seguroVidaMonto > 0, seguroVidaMonto, 0)',
    condicion: '',
    tipoAplicacion: 'FIJO',
    fase: 2
  },
  {
    codigo: 'DED_SGMM',
    formula: 'si(sgmmMonto > 0, sgmmMonto, 0)',
    condicion: '',
    tipoAplicacion: 'FIJO',
    fase: 2
  },
  {
    codigo: 'PERCEPCIONES_GRAVADAS',
    formula: 'SUELDO + fondoAhorroEmpresaGravado',
    condicion: '',
    tipoAplicacion: 'FIJO',
    fase: 2
  },
  {
    codigo: 'DEDUCCIONES_TOTALES',
    formula:
      'ISR + IMSS_OBRERO + DED_FONDO_AHORRO + DED_FONDO_AHORRO_EMPRESA + DED_SEGURO_VIDA + DED_SGMM',
    condicion: '',
    tipoAplicacion: 'FIJO',
    fase: 3
  },
  {
    codigo: 'NETO_PAGAR',
    formula:
      'SUELDO + DESPENSA + FONDO_AHORRO_EMPRESA + SEGURO_VIDA + SGMM + PREMIO_PUNTUALIDAD + PREMIO_ASISTENCIA - DEDUCCIONES_TOTALES',
    condicion: '',
    tipoAplicacion: 'FIJO',
    fase: 4
  }
];

(async () => {
  await mongoose.connect(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config');
  const db = mongoose.connection;
  const tenant = await db.collection('tenants').findOne({ slug: 'empresa-demo' });
  const empresa = await db.collection('empresas').findOne({ tenantId: tenant.tenantId });
  const tid = tenant.tenantId;
  const empresaId = empresa._id;

  // 1) Tipo período quincenal
  let tpQ = await db.collection('tipos_periodo_nomina').findOne({
    tenantId: tid,
    tipoMotor: 'quincenal',
    activo: true
  });
  if (!tpQ) {
    const ins = await db.collection('tipos_periodo_nomina').insertOne({
      tenantId: tid,
      empresaId,
      nombre: 'QUINCENAL',
      tipoMotor: 'quincenal',
      diasPago: 15,
      activo: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    tpQ = { _id: ins.insertedId, tipoMotor: 'quincenal', nombre: 'QUINCENAL' };
    console.log('✓ tipo período QUINCENAL creado');
  } else {
    console.log('✓ tipo período quincenal', String(tpQ._id));
  }

  const tpSem = await db.collection('tipos_periodo_nomina').findOne({
    tenantId: tid,
    tipoMotor: 'semanal',
    activo: true
  });

  // Otros empleados → semanal (para no mezclarlos en el cálculo quincenal)
  if (tpSem) {
    const r = await db.collection('empleados').updateMany(
      { tenantId: tid, numEmpleado: { $ne: TARGET.numEmpleado }, tipoPeriodoId: null },
      { $set: { tipoPeriodoId: tpSem._id } }
    );
    console.log('✓ empleados sin tipo → semanal:', r.modifiedCount);
  }

  // 2) Empleado 100
  // % fondo para ~2318: 2318*200/(2587.93*15) ≈ 11.95
  const pctFondo = Math.round((TARGET.fondo * 200) / (TARGET.sd * 15) * 100) / 100;
  const empPayload = {
    tenantId: tid,
    empresaId,
    numEmpleado: TARGET.numEmpleado,
    firstName: 'Gerardo',
    lastName: 'Solís Mendoza',
    apellidoPaterno: 'Solís',
    apellidoMaterno: 'Mendoza',
    salarioDiario: TARGET.sd,
    sdi: TARGET.sdi,
    tipoSalario: 'fijo',
    tipoPeriodoId: tpQ._id,
    tipoContrato: 'indefinido',
    tipoEmpleado: 'confianza',
    fechaIngreso: new Date('2020-03-01T00:00:00Z'),
    estatus: 'activo',
    activo: true,
    rfc: 'SOMG800101XXX',
    curp: 'SOMG800101HNLLNR09',
    nss: '12345678901',
    domicilio: {
      calle: 'Av. Constitución',
      numeroExt: '100',
      colonia: 'Centro',
      poblacion: 'Monterrey',
      entidad: 'NL',
      codigoPostal: '64000'
    },
    nominaConfig: {
      aplicaFondoAhorro: true,
      porcentajeFondoAhorro: pctFondo,
      despensaModalidad: 'fijo',
      despensaMonto: TARGET.despensa,
      despensaMontoMensual: TARGET.despensa,
      despensaPorcentaje: 0,
      despensaTopeModo: 'sin_tope',
      despensaTopeMonto: 0,
      seguroVidaMonto: TARGET.vida,
      sgmmMonto: TARGET.sgmm,
      tipoCreditoInfonavit: '',
      tasaInfonavit: 0,
      infonavitDescuento: 0,
      diasCotizacionImss: 0,
      sueldoIntegrado: 0,
      diasPrimaVacacional: 0,
      proporcionAguinaldoFiniquito: 0,
      fondoAhorroSaldoFiniquito: 0
    },
    updatedAt: new Date()
  };

  await db.collection('empleados').updateOne(
    { tenantId: tid, numEmpleado: TARGET.numEmpleado },
    { $set: empPayload, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  console.log('✓ empleado', TARGET.numEmpleado, 'SD', TARGET.sd, 'SDI/SBC', TARGET.sdi, 'fondo%', pctFondo);

  // 3) Conceptos nuevos + fix fondo empresa como percepción
  const colC = db.collection('nomina_conceptos');
  for (const c of NUEVOS_CONCEPTOS) {
    await colC.updateOne(
      { tenantId: tid, codigo: c.codigo },
      {
        $set: {
          ...c,
          tenantId: tid,
          empresaId,
          activo: true,
          claveSAT: c.sat.clave,
          aplicaEn: 'nomina',
          aplicaTipoNomina: ['ordinaria'],
          metadata: {
            naturalezaSdi: c.fiscal.imss.naturalezaSdi,
            esVariableSdi: false
          },
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
    console.log('✓ concepto', c.codigo);
  }

  await colC.updateOne(
    { tenantId: tid, codigo: 'FONDO_AHORRO_EMPRESA' },
    {
      $set: {
        tipo: 'percepcion',
        naturaleza: 'mixto',
        'fiscal.naturaleza': 'mixto',
        'fiscal.integraISR': true,
        'fiscal.integraIMSS': false,
        'fiscal.integraINFONAVIT': false,
        'fiscal.desglose': {
          modo: 'formula',
          formulaExento: 'fondoAhorroEmpresaExento',
          formulaGravado: 'fondoAhorroEmpresaGravado',
          codigoRegla: ''
        },
        'fiscal.imss': imssExcluido(),
        sat: { tipo: 'percepcion', clave: '005', descripcion: 'Fondo de ahorro' },
        claveSAT: '005'
      }
    }
  );
  // Legado: no calcular como percepción
  await colC.updateOne(
    { tenantId: tid, codigo: 'FONDO_AHORRO_TRABAJADOR' },
    {
      $set: {
        activo: false,
        nombre: 'Fondo de ahorro trabajador (legado — no usar)',
        naturaleza: 'informativo',
        'fiscal.naturaleza': 'informativo',
        'metadata.deprecado': true,
        'metadata.reemplazo': 'DED_FONDO_AHORRO'
      }
    }
  );

  // company_concept_config
  const colCfg = db.collection('company_concept_config');
  for (const c of [
    ...NUEVOS_CONCEPTOS,
    { codigo: 'FONDO_AHORRO_EMPRESA' },
    { codigo: 'DED_FONDO_AHORRO' },
    { codigo: 'SUELDO' }
  ]) {
    await colCfg.updateOne(
      { tenantId: tid, empresaId, conceptoCodigo: c.codigo },
      {
        $set: {
          activo: true,
          deshabilitado: false,
          tipoAplicacion: 'FIJO',
          updatedAt: new Date()
        },
        $setOnInsert: {
          tenantId: tid,
          empresaId,
          conceptoCodigo: c.codigo,
          plantillaOrigen: 'recibo-demo',
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
  }
  for (const codigo of ['PREMIO_ASISTENCIA', 'PREMIO_PUNTUALIDAD', 'FONDO_AHORRO_TRABAJADOR']) {
    await colCfg.updateOne(
      { tenantId: tid, empresaId, conceptoCodigo: codigo },
      { $set: { deshabilitado: true, activo: false } },
      { upsert: true }
    );
  }

  // 4) Fórmulas quincenal
  const colF = db.collection('nomina_formulas');
  const vigenciaDesde = new Date('2026-01-01T00:00:00Z');
  for (const f of FORMULAS_QUINCENA) {
    await colF.updateOne(
      {
        tenantId: tid,
        conceptoCodigo: f.codigo,
        tipoPeriodo: 'quincenal',
        tipoNomina: 'ordinaria',
        empresaId: null,
        activo: true
      },
      {
        $set: {
          formula: f.formula,
          condicion: f.condicion,
          tipoAplicacion: f.tipoAplicacion,
          fase: f.fase,
          dependencias: [],
          redondeo: 2,
          version: 1,
          vigenciaDesde,
          vigenciaHasta: null,
          updatedAt: new Date()
        },
        $setOnInsert: {
          tenantId: tid,
          empresaId: null,
          conceptoCodigo: f.codigo,
          tipoPeriodo: 'quincenal',
          tipoNomina: 'ordinaria',
          activo: true,
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
  }
  console.log('✓ fórmulas quincenal', FORMULAS_QUINCENA.length);

  // 5) Período 1–15 jul 2026
  const fechaInicio = startOfDay(new Date('2026-07-01T00:00:00'));
  const fechaFin = endOfDay(new Date('2026-07-15T00:00:00'));
  const colP = db.collection('nomina_periods');
  let periodo = await colP.findOne({
    tenantId: tid,
    tipoPeriodo: 'quincenal',
    tipoNomina: 'ordinaria',
    fechaInicio,
    fechaFin
  });
  if (!periodo) {
    const anio = 2026;
    const last = await colP
      .find({ tenantId: tid, anio, tipoPeriodo: 'quincenal' })
      .sort({ numeroPeriodo: -1 })
      .limit(1)
      .toArray();
    const numeroPeriodo = (last[0]?.numeroPeriodo || 0) + 1;
    const ins = await colP.insertOne({
      tenantId: tid,
      empresaId,
      tipoPeriodo: 'quincenal',
      tipoNomina: 'ordinaria',
      fechaInicio,
      fechaFin,
      anio,
      numeroPeriodo,
      diasPeriodo: diasCalendarioInclusive(fechaInicio, fechaFin),
      estatus: 'abierto',
      notas: 'Demo recibo ISA quincenal (empleado 100)',
      prestaciones: {
        pagaDespensa: true,
        despensaMontoOverride: 0,
        despensaPagoMensual: true
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });
    periodo = await colP.findOne({ _id: ins.insertedId });
    console.log('✓ período creado', String(periodo._id), 'días', periodo.diasPeriodo);
  } else {
    await colP.updateOne(
      { _id: periodo._id },
      {
        $set: {
          estatus: 'abierto',
          'prestaciones.pagaDespensa': true,
          'prestaciones.despensaPagoMensual': true
        }
      }
    );
    console.log('✓ período existente', String(periodo._id));
  }

  // 6) Calcular
  console.log('… calculando período');
  const result = await calcularPeriodo(tid, periodo._id, {});
  console.log('cálculo:', {
    exitos: result.exitos,
    errores: result.errores,
    total: result.total
  });
  if (result.resultados) {
    for (const r of result.resultados) {
      console.log(r.ok ? 'OK' : 'ERR', r.numEmpleado, r.ok ? r.reciboId : r.error);
    }
  }

  // 7) Comparar recibo empleado 100
  const emp = await db.collection('empleados').findOne({ tenantId: tid, numEmpleado: TARGET.numEmpleado });
  const recibo = await db.collection('nomina_recibos').findOne({
    tenantId: tid,
    periodoId: periodo._id,
    empleadoId: emp._id
  });
  if (!recibo) {
    console.log('⚠ sin recibo para empleado 100');
    await mongoose.disconnect();
    return;
  }
  const lineas = await db
    .collection('nomina_conceptos_aplicados')
    .find({ tenantId: tid, reciboId: recibo._id })
    .project({ conceptoCodigo: 1, tipo: 1, importe: 1, gravado: 1, exento: 1 })
    .toArray();

  const byCode = {};
  for (const l of lineas) byCode[l.conceptoCodigo] = l;

  function cmp(label, got, want) {
    const g = Math.round((Number(got) || 0) * 100) / 100;
    const w = Math.round((Number(want) || 0) * 100) / 100;
    const diff = Math.round((g - w) * 100) / 100;
    const ok = Math.abs(diff) <= 2;
    console.log(`${ok ? '✓' : '≈'} ${label}: got ${g} want ${w} (Δ ${diff})`);
  }

  console.log('\n=== Comparación vs recibo objetivo ===');
  cmp('SUELDO', byCode.SUELDO?.importe, TARGET.sueldo);
  cmp('DESPENSA', byCode.DESPENSA?.importe, TARGET.despensa);
  cmp('FONDO_AHORRO_EMPRESA', byCode.FONDO_AHORRO_EMPRESA?.importe, TARGET.fondo);
  cmp('SEGURO_VIDA', byCode.SEGURO_VIDA?.importe, TARGET.vida);
  cmp('SGMM', byCode.SGMM?.importe, TARGET.sgmm);
  cmp('IMSS_OBRERO', byCode.IMSS_OBRERO?.importe, TARGET.imss);
  cmp('ISR', byCode.ISR?.importe, TARGET.isr);
  cmp('DED_FONDO_AHORRO', byCode.DED_FONDO_AHORRO?.importe, TARGET.fondo);
  cmp('DED_FONDO_AHORRO_EMPRESA', byCode.DED_FONDO_AHORRO_EMPRESA?.importe, TARGET.fondo);
  cmp('DED_SEGURO_VIDA', byCode.DED_SEGURO_VIDA?.importe, TARGET.vida);
  cmp('DED_SGMM', byCode.DED_SGMM?.importe, TARGET.sgmm);
  cmp('NETO', recibo.neto ?? byCode.NETO_PAGAR?.importe, TARGET.neto);

  console.log('\nPercepciones:', lineas.filter((l) => l.tipo === 'percepcion' && (l.importe || 0) !== 0).map((l) => `${l.conceptoCodigo}=${l.importe}`).join(', '));
  console.log('Deducciones:', lineas.filter((l) => l.tipo === 'deduccion' && (l.importe || 0) !== 0).map((l) => `${l.conceptoCodigo}=${l.importe}`).join(', '));
  console.log('\nUI: /personal-empleados/' + emp._id + '/edit');
  console.log('UI: /nomina/periodos/' + periodo._id);

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

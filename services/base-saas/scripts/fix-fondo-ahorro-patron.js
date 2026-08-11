'use strict';

/**
 * Alinea fondo de ahorro al patrón 1 percepción + 2 deducciones.
 *   node scripts/fix-fondo-ahorro-patron.js [tenantSlug]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { emptyImssDesglose } = require('../models/fiscalConceptoShared');
const {
  FORMULA_FONDO_EMPRESA,
  FORMULA_FONDO_TRABAJADOR
} = require('../config/nominaConceptosCapaC');

function imssExcluido() {
  return { naturalezaSdi: 'excluido', desglose: emptyImssDesglose({ modo: 'todo_excluye' }) };
}

(async () => {
  await mongoose.connect(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config');
  const slug = process.argv[2] || 'empresa-demo';
  const tenant = await mongoose.connection.collection('tenants').findOne({ slug });
  if (!tenant) throw new Error('Tenant no encontrado: ' + slug);
  const empresa = await mongoose.connection.collection('empresas').findOne({ tenantId: tenant.tenantId });
  const tid = tenant.tenantId;
  const empresaId = empresa._id;
  const colC = mongoose.connection.collection('nomina_conceptos');
  const colF = mongoose.connection.collection('nomina_formulas');
  const colCfg = mongoose.connection.collection('company_concept_config');

  // 1) Percepción empresa
  await colC.updateOne(
    { tenantId: tid, codigo: 'FONDO_AHORRO_EMPRESA' },
    {
      $set: {
        tipo: 'percepcion',
        naturaleza: 'mixto',
        nombre: 'Fondo de ahorro empresa',
        activo: true,
        sat: { tipo: 'percepcion', clave: '005', descripcion: 'Fondo de ahorro' },
        claveSAT: '005',
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
        'metadata.rolFondo': 'percepcion_empresa'
      }
    }
  );

  // 2) Deducción trabajador
  await colC.updateOne(
    { tenantId: tid, codigo: 'DED_FONDO_AHORRO' },
    {
      $set: {
        tipo: 'deduccion',
        naturaleza: 'gravado',
        nombre: 'Deducción fondo de ahorro trabajador',
        activo: true,
        sat: { tipo: 'deduccion', clave: '004', descripcion: 'Otros' },
        claveSAT: '004',
        'fiscal.integraISR': false,
        'fiscal.integraIMSS': false,
        'fiscal.integraINFONAVIT': false,
        'fiscal.imss': imssExcluido(),
        'metadata.rolFondo': 'deduccion_trabajador'
      }
    }
  );

  // 3) Deducción empresa (crear si falta)
  await colC.updateOne(
    { tenantId: tid, codigo: 'DED_FONDO_AHORRO_EMPRESA' },
    {
      $set: {
        tenantId: tid,
        empresaId,
        codigo: 'DED_FONDO_AHORRO_EMPRESA',
        nombre: 'Deducción fondo de ahorro empresa',
        tipo: 'deduccion',
        naturaleza: 'gravado',
        ordenCalculo: 58,
        activo: true,
        aplicaEn: 'nomina',
        sat: { tipo: 'deduccion', clave: '004', descripcion: 'Otros' },
        claveSAT: '004',
        fiscal: {
          naturaleza: 'gravado',
          integraISR: false,
          integraIMSS: false,
          integraINFONAVIT: false,
          desglose: { modo: 'todo_gravado' },
          imss: imssExcluido()
        },
        metadata: { rolFondo: 'deduccion_empresa', naturalezaSdi: 'excluido' },
        updatedAt: new Date()
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );

  // 4) Legado: desactivar percepción trabajador (no debe salir en recibo)
  await colC.updateOne(
    { tenantId: tid, codigo: 'FONDO_AHORRO_TRABAJADOR' },
    {
      $set: {
        activo: false,
        nombre: 'Fondo de ahorro trabajador (legado — no usar)',
        tipo: 'percepcion',
        naturaleza: 'informativo',
        'fiscal.naturaleza': 'informativo',
        'fiscal.integraISR': false,
        'fiscal.integraIMSS': false,
        'fiscal.imss': imssExcluido(),
        'metadata.deprecado': true,
        'metadata.reemplazo': 'DED_FONDO_AHORRO',
        'metadata.rolFondo': 'legado_inactivo'
      }
    }
  );

  // Company config
  for (const codigo of ['FONDO_AHORRO_EMPRESA', 'DED_FONDO_AHORRO', 'DED_FONDO_AHORRO_EMPRESA']) {
    await colCfg.updateOne(
      { tenantId: tid, empresaId, conceptoCodigo: codigo },
      {
        $set: { activo: true, deshabilitado: false, tipoAplicacion: 'FIJO', updatedAt: new Date() },
        $setOnInsert: {
          tenantId: tid,
          empresaId,
          conceptoCodigo: codigo,
          plantillaOrigen: 'fondo-patron',
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
  }
  await colCfg.updateOne(
    { tenantId: tid, empresaId, conceptoCodigo: 'FONDO_AHORRO_TRABAJADOR' },
    { $set: { activo: false, deshabilitado: true, updatedAt: new Date() } },
    { upsert: true }
  );

  // Fórmulas por período: activas para 1+2, inactivas/condicion imposible para legado
  const periodos = ['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'];
  const vigenciaDesde = new Date('2026-01-01T00:00:00Z');
  const activos = [
    { codigo: 'FONDO_AHORRO_EMPRESA', fase: 1, formula: FORMULA_FONDO_EMPRESA },
    { codigo: 'DED_FONDO_AHORRO', fase: 2, formula: FORMULA_FONDO_TRABAJADOR },
    { codigo: 'DED_FONDO_AHORRO_EMPRESA', fase: 2, formula: FORMULA_FONDO_EMPRESA }
  ];

  for (const tipoPeriodo of periodos) {
    for (const a of activos) {
      await colF.updateOne(
        {
          tenantId: tid,
          conceptoCodigo: a.codigo,
          tipoPeriodo,
          tipoNomina: 'ordinaria',
          empresaId: null
        },
        {
          $set: {
            formula: a.formula,
            condicion: '',
            tipoAplicacion: 'FIJO',
            fase: a.fase,
            activo: true,
            dependencias: [],
            redondeo: 2,
            version: 2,
            vigenciaDesde,
            vigenciaHasta: null,
            updatedAt: new Date()
          },
          $setOnInsert: {
            tenantId: tid,
            empresaId: null,
            conceptoCodigo: a.codigo,
            tipoPeriodo,
            tipoNomina: 'ordinaria',
            createdAt: new Date()
          }
        },
        { upsert: true }
      );
    }

    await colF.updateMany(
      { tenantId: tid, conceptoCodigo: 'FONDO_AHORRO_TRABAJADOR', tipoPeriodo },
      { $set: { activo: false, condicion: '0 == 1', updatedAt: new Date() } }
    );

    // Totales: incluir ambas deducciones de fondo
    await colF.updateMany(
      { tenantId: tid, conceptoCodigo: 'DEDUCCIONES_TOTALES', tipoPeriodo, tipoNomina: 'ordinaria' },
      {
        $set: {
          formula: 'ISR + IMSS_OBRERO + DED_FONDO_AHORRO + DED_FONDO_AHORRO_EMPRESA',
          dependencias: ['ISR', 'IMSS_OBRERO', 'DED_FONDO_AHORRO', 'DED_FONDO_AHORRO_EMPRESA'],
          updatedAt: new Date()
        }
      }
    );
  }

  const rows = await colC
    .find({
      tenantId: tid,
      codigo: {
        $in: [
          'FONDO_AHORRO_EMPRESA',
          'FONDO_AHORRO_TRABAJADOR',
          'DED_FONDO_AHORRO',
          'DED_FONDO_AHORRO_EMPRESA'
        ]
      }
    })
    .project({ codigo: 1, tipo: 1, activo: 1, nombre: 1 })
    .toArray();

  console.log('Patrón fondo de ahorro:');
  for (const r of rows.sort((a, b) => a.codigo.localeCompare(b.codigo))) {
    console.log(
      `  ${r.codigo}: tipo=${r.tipo} activo=${r.activo} — ${r.nombre}`
    );
  }
  console.log('\nEsperado en recibo: 1 percepción + 2 deducciones');
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

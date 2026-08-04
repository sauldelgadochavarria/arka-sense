#!/usr/bin/env node
'use strict';

/**
 * Siembra tablas fiscales y parámetros (UMA, ISR, IMSS cuotas oficiales, CEAV).
 * Ejecutar: npm run seed:nomina-fiscal
 *
 * Referencia de cuotas: estructura tipo Nominax / LSS.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTablaFiscalModel = require('../models/tablaFiscal');
const getRangoFiscalModel = require('../models/rangoFiscal');
const getParametroGeneralModel = require('../models/parametroGeneral');
const { TABLAS_ISR_2026, VIGENCIA_ISR_2026 } = require('../config/isrTablas2026');

const VIGENCIA = VIGENCIA_ISR_2026;

const PARAMETROS = [
  { clave: 'UMA', valor: 113.14, descripcion: 'Unidad de Medida y Actualización (editar cada año; p.ej. ~117.31 para tope fondo ≈ $55,663.60)' },
  { clave: 'SALARIO_MINIMO', valor: 278.8, descripcion: 'Salario mínimo diario general 2026' },
  { clave: 'FONDO_AHORRO_PORC', valor: 13, descripcion: '% máximo del salario para fondo de ahorro (tope exento)' },
  { clave: 'FONDO_AHORRO_TOPE_UMA', valor: 1.3, descripcion: 'Veces la UMA anual para tope exento del fondo de ahorro' },
  { clave: 'FONDO_AHORRO_DIAS_ANIO', valor: 365, descripcion: 'Días para calcular UMA anual del fondo de ahorro' },
  { clave: 'IMSS_TOPE_UMA', valor: 25, descripcion: 'Tope SBC en veces UMA' }
];

/**
 * Ramos IMSS oficiales (patrón / trabajador / base).
 * INFONAVIT no se incluye aquí (concepto aparte).
 * CEAV patronal va en IMSS_CEAV_PATRONAL (tramos).
 */
const CUOTAS_IMSS = [
  {
    clave: 'RT',
    nombre: 'Riesgos de trabajo (prima empresa)',
    tasaPatronal: 0,
    tasaObrero: 0,
    baseCalculo: 'prima_rt'
  },
  {
    clave: 'EM_CUOTA_FIJA',
    nombre: 'Enfermedad y maternidad — cuota fija (hasta 3 UMA)',
    tasaPatronal: 0.204,
    tasaObrero: 0,
    baseCalculo: 'uma'
  },
  {
    clave: 'EM_EXCEDENTE',
    nombre: 'Enfermedad y maternidad — excedente sobre 3 UMA',
    tasaPatronal: 0.011,
    tasaObrero: 0.004,
    baseCalculo: 'sbc_menos_3_uma'
  },
  {
    clave: 'EM_GASTOS_MEDICOS',
    nombre: 'EM — gastos médicos pensionados y beneficiarios',
    tasaPatronal: 0.0105,
    tasaObrero: 0.00375,
    baseCalculo: 'sbc'
  },
  {
    clave: 'EM_DINERO',
    nombre: 'EM — prestaciones en dinero',
    tasaPatronal: 0.007,
    tasaObrero: 0.0025,
    baseCalculo: 'sbc'
  },
  {
    clave: 'INVALIDEZ_VIDA',
    nombre: 'Invalidez y vida',
    tasaPatronal: 0.0175,
    tasaObrero: 0.00625,
    baseCalculo: 'sbc'
  },
  {
    clave: 'GUARDERIAS',
    nombre: 'Guarderías y prestaciones sociales',
    tasaPatronal: 0.01,
    tasaObrero: 0,
    baseCalculo: 'sbc'
  },
  {
    clave: 'RETIRO',
    nombre: 'Retiro',
    tasaPatronal: 0.02,
    tasaObrero: 0,
    baseCalculo: 'sbc'
  },
  {
    clave: 'CEAV',
    nombre: 'Cesantía en edad avanzada y vejez (trabajador)',
    tasaPatronal: 0,
    tasaObrero: 0.01125,
    baseCalculo: 'sbc'
  }
];

/**
 * CEAV patronal 2025+ (tramos). Último tramo abierto hasta 25 UMA (tope SBC).
 * Fuente: reforma gradual CEAV / tablas tipo Nominax.
 */
const TRAMOS_CEAV_PATRONAL = [
  {
    clave: 'CEAV_T1',
    nombre: 'SBC = 1.0 SM',
    limiteInferior: 0,
    limiteInfUnidad: 'sm',
    limiteSuperior: 1.0,
    limiteSupUnidad: 'sm',
    tasaPatronal: 0.0315
  },
  {
    clave: 'CEAV_T2',
    nombre: '1.01 SM a 1.50 UMA',
    limiteInferior: 1.01,
    limiteInfUnidad: 'sm',
    limiteSuperior: 1.5,
    limiteSupUnidad: 'uma',
    tasaPatronal: 0.03544
  },
  {
    clave: 'CEAV_T3',
    nombre: '1.51 UMA a 2.00 UMA',
    limiteInferior: 1.51,
    limiteInfUnidad: 'uma',
    limiteSuperior: 2.0,
    limiteSupUnidad: 'uma',
    tasaPatronal: 0.04426
  },
  {
    clave: 'CEAV_T4',
    nombre: '2.01 UMA a 2.50 UMA',
    limiteInferior: 2.01,
    limiteInfUnidad: 'uma',
    limiteSuperior: 2.5,
    limiteSupUnidad: 'uma',
    tasaPatronal: 0.04954
  },
  {
    clave: 'CEAV_T5',
    nombre: '2.51 UMA a 3.00 UMA',
    limiteInferior: 2.51,
    limiteInfUnidad: 'uma',
    limiteSuperior: 3.0,
    limiteSupUnidad: 'uma',
    tasaPatronal: 0.05307
  },
  {
    clave: 'CEAV_T6',
    nombre: '3.01 UMA a 3.50 UMA',
    limiteInferior: 3.01,
    limiteInfUnidad: 'uma',
    limiteSuperior: 3.5,
    limiteSupUnidad: 'uma',
    tasaPatronal: 0.05559
  },
  {
    clave: 'CEAV_T7',
    nombre: '3.51 UMA a 4.00 UMA',
    limiteInferior: 3.51,
    limiteInfUnidad: 'uma',
    limiteSuperior: 4.0,
    limiteSupUnidad: 'uma',
    tasaPatronal: 0.05747
  },
  {
    clave: 'CEAV_T8',
    nombre: 'Más de 4.00 UMA',
    limiteInferior: 4.01,
    limiteInfUnidad: 'uma',
    limiteSuperior: 25,
    limiteSupUnidad: 'uma',
    tasaPatronal: 0.06422
  }
];

async function seedParametros() {
  const ParametroGeneral = await getParametroGeneralModel();
  for (const p of PARAMETROS) {
    const exists = await ParametroGeneral.findOne({ clave: p.clave, vigenciaDesde: VIGENCIA }).lean();
    if (exists) {
      console.log(`· Parámetro ${p.clave} ya existe`);
      continue;
    }
    await ParametroGeneral.create({
      ...p,
      vigenciaDesde: VIGENCIA,
      vigenciaHasta: null
    });
    console.log(`✓ Parámetro ${p.clave} sembrado`);
  }
}

async function seedTablaIsr() {
  const TablaFiscal = await getTablaFiscalModel();
  const RangoFiscal = await getRangoFiscalModel();

  for (const def of TABLAS_ISR_2026) {
    let tabla = await TablaFiscal.findOne({ codigo: def.codigo, vigenciaDesde: VIGENCIA });
    if (!tabla) {
      tabla = await TablaFiscal.create({
        codigo: def.codigo,
        nombre: def.nombre,
        vigenciaDesde: VIGENCIA,
        vigenciaHasta: null,
        periodicidad: def.periodicidad,
        activo: true
      });
      console.log(`✓ Tabla ${def.codigo} creada`);
    } else {
      tabla.nombre = def.nombre;
      tabla.periodicidad = def.periodicidad;
      tabla.activo = true;
      await tabla.save();
      console.log(`· Tabla ${def.codigo} actualizada`);
    }

    await RangoFiscal.deleteMany({ tablaId: tabla._id });
    await RangoFiscal.insertMany(
      def.rangos.map((r) => ({
        limiteInferior: r.limiteInferior,
        limiteSuperior: r.limiteSuperior,
        cuotaFija: r.cuotaFija,
        porcentajeExcedente: r.porcentajeExcedente,
        tablaId: tabla._id
      }))
    );
    console.log(`✓ ${def.rangos.length} rangos en ${def.codigo}`);
  }
}

async function ensureTabla(codigo, nombre, periodicidad = 'diario') {
  const TablaFiscal = await getTablaFiscalModel();
  let tabla = await TablaFiscal.findOne({ codigo, vigenciaDesde: VIGENCIA });
  if (!tabla) {
    tabla = await TablaFiscal.create({
      codigo,
      nombre,
      vigenciaDesde: VIGENCIA,
      vigenciaHasta: null,
      periodicidad,
      activo: true
    });
    console.log(`✓ Tabla ${codigo} creada`);
  } else {
    tabla.activo = true;
    tabla.nombre = nombre;
    await tabla.save();
    console.log(`· Tabla ${codigo} ya existe (reactivada)`);
  }
  return tabla;
}

async function replaceFilas(tabla, filas) {
  const RangoFiscal = await getRangoFiscalModel();
  await RangoFiscal.deleteMany({ tablaId: tabla._id });
  if (!filas.length) return;
  await RangoFiscal.insertMany(filas.map((f) => ({ ...f, tablaId: tabla._id })));
  console.log(`✓ ${filas.length} filas en ${tabla.codigo}`);
}

async function seedImssOficial() {
  const tablaCuotas = await ensureTabla(
    'IMSS_CUOTAS',
    'IMSS cuotas obrero-patronal (ramos oficiales)',
    'diario'
  );
  await replaceFilas(
    tablaCuotas,
    CUOTAS_IMSS.map((c) => ({
      clave: c.clave,
      nombre: c.nombre,
      limiteInferior: 0,
      limiteSuperior: 999999999,
      cuotaFija: 0,
      porcentajeExcedente: c.tasaObrero || 0,
      tasaObrero: c.tasaObrero,
      tasaPatronal: c.tasaPatronal,
      baseCalculo: c.baseCalculo,
      limiteInfUnidad: '',
      limiteSupUnidad: ''
    }))
  );

  const tablaCeav = await ensureTabla(
    'IMSS_CEAV_PATRONAL',
    'IMSS CEAV patronal por tramos SBC (2025+)',
    'diario'
  );
  await replaceFilas(
    tablaCeav,
    TRAMOS_CEAV_PATRONAL.map((t) => ({
      clave: t.clave,
      nombre: t.nombre,
      limiteInferior: t.limiteInferior,
      limiteSuperior: t.limiteSuperior,
      cuotaFija: 0,
      porcentajeExcedente: t.tasaPatronal,
      tasaObrero: 0,
      tasaPatronal: t.tasaPatronal,
      baseCalculo: 'ceav_tramo',
      limiteInfUnidad: t.limiteInfUnidad,
      limiteSupUnidad: t.limiteSupUnidad
    }))
  );

  // Desactivar tablas legado simplificadas
  const TablaFiscal = await getTablaFiscalModel();
  const legado = await TablaFiscal.updateMany(
    { codigo: { $in: ['IMSS_OBRERO', 'IMSS_PATRONAL'] }, activo: true },
    { $set: { activo: false } }
  );
  if (legado.modifiedCount) {
    console.log(`✓ Desactivadas ${legado.modifiedCount} tablas IMSS legado`);
  }
}

async function main() {
  const uri = dbConfig.connectionStringConfig;
  console.log('Conectando a', uri);
  await mongoose.connect(uri);

  await seedParametros();
  await seedTablaIsr();
  await seedImssOficial();

  await mongoose.disconnect();
  console.log('Seed fiscal completado.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

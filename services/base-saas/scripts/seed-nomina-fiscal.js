#!/usr/bin/env node
'use strict';

/**
 * Siembra tablas fiscales y parámetros globales (UMA, ISR de referencia).
 * Ejecutar una vez por ambiente: npm run seed:nomina-fiscal
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTablaFiscalModel = require('../models/tablaFiscal');
const getRangoFiscalModel = require('../models/rangoFiscal');
const getParametroGeneralModel = require('../models/parametroGeneral');

const VIGENCIA = new Date('2026-01-01');

const PARAMETROS = [
  { clave: 'UMA', valor: 113.14, descripcion: 'Unidad de Medida y Actualización 2026' },
  { clave: 'SALARIO_MINIMO', valor: 278.8, descripcion: 'Salario mínimo diario general 2026' },
  { clave: 'FONDO_AHORRO_PORC', valor: 13, descripcion: 'Porcentaje base fondo de ahorro' }
];

const RANGOS_ISR_MENSUAL = [
  { limiteInferior: 0.01, limiteSuperior: 746.04, cuotaFija: 0, porcentajeExcedente: 0.0192 },
  { limiteInferior: 746.05, limiteSuperior: 6332.05, cuotaFija: 14.32, porcentajeExcedente: 0.064 },
  { limiteInferior: 6332.06, limiteSuperior: 11128.01, cuotaFija: 371.83, porcentajeExcedente: 0.1088 },
  { limiteInferior: 11128.02, limiteSuperior: 12935.82, cuotaFija: 893.63, porcentajeExcedente: 0.16 },
  { limiteInferior: 12935.83, limiteSuperior: 15487.71, cuotaFija: 1182.88, porcentajeExcedente: 0.1792 },
  { limiteInferior: 15487.72, limiteSuperior: 31236.49, cuotaFija: 1640.18, porcentajeExcedente: 0.2136 },
  { limiteInferior: 31236.5, limiteSuperior: 49233.0, cuotaFija: 5004.12, porcentajeExcedente: 0.2352 },
  { limiteInferior: 49233.01, limiteSuperior: 93993.9, cuotaFija: 9236.89, porcentajeExcedente: 0.3 },
  { limiteInferior: 93993.91, limiteSuperior: 125325.2, cuotaFija: 22665.17, porcentajeExcedente: 0.32 },
  { limiteInferior: 125325.21, limiteSuperior: 375975.61, cuotaFija: 32691.18, porcentajeExcedente: 0.34 },
  { limiteInferior: 375975.62, limiteSuperior: 999999999, cuotaFija: 117912.32, porcentajeExcedente: 0.35 }
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

  let tabla = await TablaFiscal.findOne({ codigo: 'ISR_MENSUAL', vigenciaDesde: VIGENCIA }).lean();
  if (!tabla) {
    tabla = await TablaFiscal.create({
      codigo: 'ISR_MENSUAL',
      nombre: 'Tabla ISR mensual Art. 96 LISR',
      vigenciaDesde: VIGENCIA,
      vigenciaHasta: null,
      periodicidad: 'mensual',
      activo: true
    });
    console.log('✓ Tabla ISR_MENSUAL creada');
  } else {
    console.log('· Tabla ISR_MENSUAL ya existe');
  }

  const count = await RangoFiscal.countDocuments({ tablaId: tabla._id });
  if (count > 0) {
    console.log(`· ${count} rangos ISR ya existen`);
    return;
  }

  await RangoFiscal.insertMany(
    RANGOS_ISR_MENSUAL.map((r) => ({ ...r, tablaId: tabla._id }))
  );
  console.log(`✓ ${RANGOS_ISR_MENSUAL.length} rangos ISR sembrados`);
}

async function main() {
  const uri = dbConfig.connectionStringConfig;
  console.log('Conectando a', uri);
  await mongoose.connect(uri);

  await seedParametros();
  await seedTablaIsr();

  await mongoose.disconnect();
  console.log('Seed fiscal completado.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

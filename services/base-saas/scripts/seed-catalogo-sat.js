#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getCatalogoSatModel = require('../models/catalogoSat');

const VIGENCIA = new Date('2017-07-01');

const ENTRADAS = [
  { catalogo: 'c_TipoPercepcion', clave: '001', descripcion: 'Sueldos, salarios rayas y jornales' },
  { catalogo: 'c_TipoPercepcion', clave: '002', descripcion: 'Aguinaldo' },
  { catalogo: 'c_TipoPercepcion', clave: '003', descripcion: 'Participación de los trabajadores en las utilidades PTU' },
  { catalogo: 'c_TipoPercepcion', clave: '019', descripcion: 'Horas extra' },
  { catalogo: 'c_TipoPercepcion', clave: '020', descripcion: 'Prima dominical' },
  { catalogo: 'c_TipoPercepcion', clave: '021', descripcion: 'Prima vacacional' },
  { catalogo: 'c_TipoPercepcion', clave: '025', descripcion: 'Indemnizaciones' },
  { catalogo: 'c_TipoPercepcion', clave: '038', descripcion: 'Otros ingresos por salarios' },
  { catalogo: 'c_TipoDeduccion', clave: '001', descripcion: 'Seguridad social' },
  { catalogo: 'c_TipoDeduccion', clave: '002', descripcion: 'ISR' },
  { catalogo: 'c_TipoDeduccion', clave: '003', descripcion: 'Aportaciones a retiro, cesantía en edad avanzada y vejez' },
  { catalogo: 'c_TipoDeduccion', clave: '004', descripcion: 'Otros' },
  { catalogo: 'c_TipoDeduccion', clave: '010', descripcion: 'Pago por crédito de vivienda' },
  { catalogo: 'c_TipoOtroPago', clave: '002', descripcion: 'Subsidio para el empleo' },
  { catalogo: 'c_TipoHorasExtra', clave: '01', descripcion: 'Dobles' },
  { catalogo: 'c_TipoHorasExtra', clave: '02', descripcion: 'Triples' },
  { catalogo: 'c_TipoHorasExtra', clave: '03', descripcion: 'Simples' }
];

async function main() {
  const uri = dbConfig.connectionStringConfig;
  console.log('Conectando a', uri);
  await mongoose.connect(uri);

  const CatalogoSat = await getCatalogoSatModel();
  let creados = 0;

  for (const e of ENTRADAS) {
    const res = await CatalogoSat.updateOne(
      { catalogo: e.catalogo, clave: e.clave, vigenciaDesde: VIGENCIA },
      {
        $setOnInsert: {
          ...e,
          vigenciaDesde: VIGENCIA,
          vigenciaHasta: null,
          activo: true
        }
      },
      { upsert: true }
    );
    if (res.upsertedCount) {
      creados++;
      console.log(`✓ ${e.catalogo} ${e.clave}`);
    }
  }

  console.log(`Catálogo SAT: ${creados} nuevos, ${ENTRADAS.length} total verificados`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

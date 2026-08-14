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
  { catalogo: 'c_TipoPercepcion', clave: '004', descripcion: 'Reembolso de gastos médicos dentales y hospitalarios' },
  { catalogo: 'c_TipoPercepcion', clave: '005', descripcion: 'Fondo de ahorro' },
  { catalogo: 'c_TipoPercepcion', clave: '006', descripcion: 'Caja de ahorro' },
  { catalogo: 'c_TipoPercepcion', clave: '009', descripcion: 'Contribuciones a Seguridad Social pagadas por el patrón' },
  { catalogo: 'c_TipoPercepcion', clave: '010', descripcion: 'Premios por puntualidad' },
  { catalogo: 'c_TipoPercepcion', clave: '011', descripcion: 'Seguro de vida' },
  { catalogo: 'c_TipoPercepcion', clave: '012', descripcion: 'Seguro de gastos médicos mayores' },
  { catalogo: 'c_TipoPercepcion', clave: '013', descripcion: 'Cuotas sindicales pagadas por el patrón' },
  { catalogo: 'c_TipoPercepcion', clave: '014', descripcion: 'Subsidios por incapacidad' },
  { catalogo: 'c_TipoPercepcion', clave: '015', descripcion: 'Becas para trabajadores / hijos' },
  { catalogo: 'c_TipoPercepcion', clave: '019', descripcion: 'Horas extra' },
  { catalogo: 'c_TipoPercepcion', clave: '020', descripcion: 'Prima dominical' },
  { catalogo: 'c_TipoPercepcion', clave: '021', descripcion: 'Prima vacacional' },
  { catalogo: 'c_TipoPercepcion', clave: '022', descripcion: 'Prima por antigüedad' },
  { catalogo: 'c_TipoPercepcion', clave: '023', descripcion: 'Pagos por separación' },
  { catalogo: 'c_TipoPercepcion', clave: '024', descripcion: 'Seguro de retiro' },
  { catalogo: 'c_TipoPercepcion', clave: '025', descripcion: 'Indemnizaciones' },
  { catalogo: 'c_TipoPercepcion', clave: '026', descripcion: 'Reembolso por funeral' },
  { catalogo: 'c_TipoPercepcion', clave: '027', descripcion: 'Cuotas de seguridad social pagadas por el patrón' },
  { catalogo: 'c_TipoPercepcion', clave: '028', descripcion: 'Comisiones' },
  { catalogo: 'c_TipoPercepcion', clave: '029', descripcion: 'Vales de despensa' },
  { catalogo: 'c_TipoPercepcion', clave: '030', descripcion: 'Vales de restaurante' },
  { catalogo: 'c_TipoPercepcion', clave: '031', descripcion: 'Vales de gasolina' },
  { catalogo: 'c_TipoPercepcion', clave: '032', descripcion: 'Vales de ropa' },
  { catalogo: 'c_TipoPercepcion', clave: '034', descripcion: 'Ayuda para renta' },
  { catalogo: 'c_TipoPercepcion', clave: '035', descripcion: 'Ayuda para artículos escolares' },
  { catalogo: 'c_TipoPercepcion', clave: '036', descripcion: 'Ayuda para anteojos' },
  { catalogo: 'c_TipoPercepcion', clave: '037', descripcion: 'Ayuda para transporte' },
  { catalogo: 'c_TipoPercepcion', clave: '038', descripcion: 'Otros ingresos por salarios' },
  { catalogo: 'c_TipoPercepcion', clave: '039', descripcion: 'Jubilaciones, pensiones o haberes de retiro' },
  { catalogo: 'c_TipoPercepcion', clave: '044', descripcion: 'Jubilaciones, pensiones o haberes de retiro en parcialidades' },
  { catalogo: 'c_TipoPercepcion', clave: '045', descripcion: 'Ingresos en acciones o títulos valor' },
  { catalogo: 'c_TipoPercepcion', clave: '046', descripcion: 'Ingresos asimilados a salarios' },
  { catalogo: 'c_TipoPercepcion', clave: '047', descripcion: 'Alimentación' },
  { catalogo: 'c_TipoPercepcion', clave: '048', descripcion: 'Habitación' },
  { catalogo: 'c_TipoPercepcion', clave: '049', descripcion: 'Premios por asistencia' },
  { catalogo: 'c_TipoPercepcion', clave: '050', descripcion: 'Viáticos' },
  { catalogo: 'c_TipoDeduccion', clave: '001', descripcion: 'Seguridad social' },
  { catalogo: 'c_TipoDeduccion', clave: '002', descripcion: 'ISR' },
  { catalogo: 'c_TipoDeduccion', clave: '003', descripcion: 'Aportaciones a retiro, cesantía en edad avanzada y vejez' },
  { catalogo: 'c_TipoDeduccion', clave: '004', descripcion: 'Otros' },
  { catalogo: 'c_TipoDeduccion', clave: '010', descripcion: 'Pago por crédito de vivienda' },
  { catalogo: 'c_TipoDeduccion', clave: '011', descripcion: 'Pago por crédito FONACOT' },
  { catalogo: 'c_TipoDeduccion', clave: '012', descripcion: 'Pensión alimenticia' },
  { catalogo: 'c_TipoDeduccion', clave: '019', descripcion: 'Cuotas sindicales' },
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

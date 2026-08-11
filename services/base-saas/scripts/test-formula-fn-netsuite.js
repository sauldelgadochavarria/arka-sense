'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const db = require('../config/db');
const {
  validarFormulaFunctionPayload,
  probarFormulaFunctionPayload,
  ensureFormulaFunctionsSeeded,
  getFormulaFunctionByName
} = require('../services/nomina/formulaFunctionsService');
const getFormulaFunctionModel = require('../models/formulaFunction');

(async () => {
  await mongoose.connect(db.connectionStringConfig || 'mongodb://localhost:27020/config');
  await ensureFormulaFunctionsSeeded();

  console.log(
    'validate expr',
    validarFormulaFunctionPayload({
      tipo: 'expresion',
      cuerpo: 'sueldo*dias*porc/200',
      args: 'sueldo,dias,porc'
    })
  );
  console.log(
    'test expr',
    probarFormulaFunctionPayload({
      tipo: 'expresion',
      cuerpo: 'sueldo*dias*porc/200',
      args: 'sueldo,dias,porc',
      valores: [2587.93, 14, 13]
    })
  );
  console.log(
    'validate js',
    validarFormulaFunctionPayload({
      tipo: 'javascript',
      cuerpo: 'return sueldo * dias * porc / 200;',
      args: 'sueldo,dias,porc'
    })
  );
  console.log(
    'test js',
    probarFormulaFunctionPayload({
      tipo: 'javascript',
      cuerpo: 'return sueldo * dias * porc / 200;',
      args: 'sueldo,dias,porc',
      valores: [2587.93, 14, 13]
    })
  );
  try {
    validarFormulaFunctionPayload({
      tipo: 'javascript',
      cuerpo: 'return require("fs");',
      args: 'x'
    });
  } catch (e) {
    console.log('block ok', e.message);
  }

  const fm = await getFormulaFunctionByName('fondoMitad');
  if (fm) {
    const FormulaFunction = await getFormulaFunctionModel();
    await FormulaFunction.updateOne(
      { _id: fm._id },
      {
        $set: {
          estado: 'publicado',
          cuerpoPublicado: fm.cuerpo || 'sueldo * dias * porc / 200',
          activo: true
        }
      }
    );
    console.log('fondoMitad publicado', String(fm._id));
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

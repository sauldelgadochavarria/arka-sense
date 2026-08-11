'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { COLLECTION_FORMULA_FUNCTIONS } = require('../config/constants');
const svc = require('../services/nomina/formulaFunctionsService');
const { createFormulaScopeWithCatalog, evaluateExpression } = require('../services/nomina/formulaEvaluator');

(async () => {
  await mongoose.connect(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config');
  const col = mongoose.connection.collection(COLLECTION_FORMULA_FUNCTIONS);
  await col.drop().catch(() => {});
  console.log('colección reseteada');

  const seed = await svc.ensureFormulaFunctionsSeeded();
  console.log('seed', seed);

  try {
    await svc.crearFormulaFunction({
      name: 'fondoMitad',
      args: 'sueldo,dias,porc',
      cuerpo: 'sueldo * dias * porc / 200',
      descripcion: 'Mitad % salario del período'
    });
    console.log('creada fondoMitad');
  } catch (e) {
    console.log('crear:', e.message);
  }

  const scope = await createFormulaScopeWithCatalog({ uma: 117.31 }, {});
  const v = evaluateExpression('si(1, fondoMitad(2587.93, 15, 11.95), 0)', {}, scope);
  console.log('resultado', v);

  const names = (await svc.listActiveFormulaFunctions()).map((f) => f.name);
  console.log('activas', names.join(', '));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

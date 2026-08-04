'use strict';

const getEmpleadoModel = require('../../../models/empleado');
const getNominaAcumuladoModel = require('../../../models/nominaAcumulado');
const { toNum } = require('../csvParse');

function buildPorMes(data) {
  const porMes = {};
  for (let m = 1; m <= 12; m += 1) {
    const key = `mes${String(m).padStart(2, '0')}`;
    const n = toNum(data[key], null);
    if (n != null && n !== 0) porMes[String(m)] = n;
  }
  return porMes;
}

async function validateAcumulados(tenantId, empresaId, rows) {
  const Empleado = await getEmpleadoModel();
  const empleados = await Empleado.find({ tenantId }).select('_id numEmpleado').lean();
  const byNum = new Map(empleados.map((e) => [String(e.numEmpleado), e]));
  const errores = [];
  const ok = [];
  const keys = new Set();

  for (const { fila, data } of rows) {
    const num = String(data.numEmpleado || '').trim();
    const anio = toNum(data.anio, null);
    const concepto = String(data.conceptoCodigo || '').trim().toUpperCase();
    if (!num) {
      errores.push({ fila, campo: 'numEmpleado', mensaje: 'Obligatorio', valor: '' });
      continue;
    }
    const emp = byNum.get(num);
    if (!emp) {
      errores.push({ fila, campo: 'numEmpleado', mensaje: 'Empleado no existe', valor: num });
      continue;
    }
    if (!anio || anio < 2000 || anio > 2100) {
      errores.push({ fila, campo: 'anio', mensaje: 'Año inválido', valor: String(data.anio || '') });
      continue;
    }
    if (!concepto) {
      errores.push({ fila, campo: 'conceptoCodigo', mensaje: 'Obligatorio', valor: '' });
      continue;
    }
    const dedupe = `${num}|${anio}|${concepto}`;
    if (keys.has(dedupe)) {
      errores.push({ fila, campo: 'conceptoCodigo', mensaje: 'Duplicado en archivo', valor: dedupe });
      continue;
    }
    keys.add(dedupe);

    ok.push({
      fila,
      numEmpleado: num,
      empleadoId: emp._id,
      anio,
      conceptoCodigo: concepto,
      importeAnual: toNum(data.importeAnual, 0) || 0,
      gravadoAnual: toNum(data.gravadoAnual, 0) || 0,
      exentoAnual: toNum(data.exentoAnual, 0) || 0,
      porMes: buildPorMes(data)
    });
  }

  return { errores, validos: ok, resumen: { acumulados: ok.length } };
}

async function applyAcumulados(tenantId, empresaId, validos) {
  const Acumulado = await getNominaAcumuladoModel();
  let aplicadas = 0;
  const errores = [];

  for (const row of validos) {
    try {
      await Acumulado.updateOne(
        {
          tenantId,
          empleadoId: row.empleadoId,
          anio: row.anio,
          conceptoCodigo: row.conceptoCodigo
        },
        {
          $set: {
            empresaId,
            importeAnual: row.importeAnual,
            gravadoAnual: row.gravadoAnual,
            exentoAnual: row.exentoAnual,
            porMes: row.porMes,
            ultimaFechaCierre: new Date()
          },
          $setOnInsert: {
            tenantId,
            empleadoId: row.empleadoId,
            anio: row.anio,
            conceptoCodigo: row.conceptoCodigo
          }
        },
        { upsert: true }
      );
      aplicadas += 1;
    } catch (err) {
      errores.push({
        fila: row.fila,
        campo: 'conceptoCodigo',
        mensaje: err.message || 'Error al guardar acumulado',
        valor: row.conceptoCodigo
      });
    }
  }

  return { aplicadas, errores };
}

module.exports = { validateAcumulados, applyAcumulados };

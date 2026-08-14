'use strict';

const getEmpleadoModel = require('../../../models/empleado');
const getNominaAcumuladoModel = require('../../../models/nominaAcumulado');
const { toNum } = require('../csvParse');

/**
 * Forma canónica de porMes[m]: { importe, gravado, exento }.
 * El cierre hace $inc sobre esos campos; un número plano rompe Mongo
 * ("Cannot create field 'exento' in element {6: 14084.69}").
 */
function toPorMesBucket(val, gravadoHint = null, exentoHint = null) {
  if (val != null && typeof val === 'object' && !Array.isArray(val)) {
    return {
      importe: toNum(val.importe, 0) || 0,
      gravado: toNum(val.gravado, 0) || 0,
      exento: toNum(val.exento, 0) || 0
    };
  }
  const importe = toNum(val, 0) || 0;
  if (!importe) return null;
  const gravado = gravadoHint != null ? toNum(gravadoHint, importe) || 0 : importe;
  const exento = exentoHint != null ? toNum(exentoHint, 0) || 0 : 0;
  return { importe, gravado, exento };
}

function buildPorMes(data) {
  const porMes = {};
  for (let m = 1; m <= 12; m += 1) {
    const key = `mes${String(m).padStart(2, '0')}`;
    const bucket = toPorMesBucket(data[key]);
    if (bucket) porMes[String(m)] = bucket;
  }
  return porMes;
}

async function validateAcumulados(tenantId, empresaId, rows) {
  const Empleado = await getEmpleadoModel();
  const empleados = await Empleado.find({ tenantId })
    .select('_id numEmpleado empresaId subsidiariaId')
    .lean();
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
      subsidiariaId: emp.subsidiariaId || null,
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
            subsidiariaId: row.subsidiariaId || null,
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

module.exports = { validateAcumulados, applyAcumulados, toPorMesBucket, buildPorMes };

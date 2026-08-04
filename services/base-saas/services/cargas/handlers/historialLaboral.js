'use strict';

const getEmpleadoModel = require('../../../models/empleado');
const getHistorialLaboralModel = require('../../../models/historialLaboral');
const { toNum, toDate } = require('../csvParse');

async function validateHistorial(tenantId, empresaId, rows) {
  const Empleado = await getEmpleadoModel();
  const empleados = await Empleado.find({ tenantId }).select('_id numEmpleado').lean();
  const byNum = new Map(empleados.map((e) => [String(e.numEmpleado), e]));
  const errores = [];
  const ok = [];

  for (const { fila, data } of rows) {
    const num = String(data.numEmpleado || '').trim();
    const tipo = String(data.tipoMovimientoCodigo || '').trim().toUpperCase();
    const fecha = toDate(data.fechaMovimiento);
    if (!num) {
      errores.push({ fila, campo: 'numEmpleado', mensaje: 'Obligatorio', valor: '' });
      continue;
    }
    const emp = byNum.get(num);
    if (!emp) {
      errores.push({ fila, campo: 'numEmpleado', mensaje: 'Empleado no existe', valor: num });
      continue;
    }
    if (!tipo) {
      errores.push({ fila, campo: 'tipoMovimientoCodigo', mensaje: 'Obligatorio', valor: '' });
      continue;
    }
    if (!fecha) {
      errores.push({
        fila,
        campo: 'fechaMovimiento',
        mensaje: 'Fecha inválida (YYYY-MM-DD)',
        valor: String(data.fechaMovimiento || '')
      });
      continue;
    }
    ok.push({
      fila,
      numEmpleado: num,
      empleadoId: emp._id,
      tipoMovimientoCodigo: tipo,
      fechaMovimiento: fecha,
      salarioDiario: toNum(data.salarioDiario, null),
      observaciones: String(data.observaciones || '').trim()
    });
  }

  return { errores, validos: ok, resumen: { movimientos: ok.length } };
}

async function applyHistorial(tenantId, empresaId, validos, userLabel = '') {
  const Historial = await getHistorialLaboralModel();
  let aplicadas = 0;
  const errores = [];

  for (const row of validos) {
    try {
      await Historial.create({
        tenantId,
        empresaId,
        empleadoId: row.empleadoId,
        tipoMovimientoCodigo: row.tipoMovimientoCodigo,
        fechaMovimiento: row.fechaMovimiento,
        salarioDiario: row.salarioDiario,
        observaciones: row.observaciones,
        origen: 'importacion',
        registradoPor: userLabel || 'carga_inicial'
      });
      aplicadas += 1;
    } catch (err) {
      errores.push({
        fila: row.fila,
        campo: 'numEmpleado',
        mensaje: err.message || 'Error al guardar movimiento',
        valor: row.numEmpleado
      });
    }
  }

  return { aplicadas, errores };
}

module.exports = { validateHistorial, applyHistorial };

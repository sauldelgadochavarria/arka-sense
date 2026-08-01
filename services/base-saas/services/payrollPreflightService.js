'use strict';

const getEmpleadoModel = require('../models/empleado');
const getIncidenciaModel = require('../models/incidencia');
const getPayrollDetailModel = require('../models/payrollDetail');
const { getEmpleadoExportId } = require('../libs/empleadoHelpers');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');

async function validateCodigoExternoForPeriod(period, tenantId) {
  const Empleado = await getEmpleadoModel();
  const Incidencia = await getIncidenciaModel();
  const PayrollDetail = await getPayrollDetailModel();
  const inicio = startOfDay(period.fechaInicio);
  const fin = endOfDay(period.fechaFin);

  const [empleados, incidencias, detalles] = await Promise.all([
    Empleado.find({ tenantId, estatus: 'activo', activo: true }).lean(),
    Incidencia.find({
      tenantId,
      estatus: 'aprobada',
      fechaInicio: { $gte: inicio, $lte: fin }
    }).lean(),
    PayrollDetail.find({ tenantId, periodId: period._id }).lean()
  ]);

  const empMap = new Map(empleados.map((e) => [String(e._id), e]));
  const afectados = new Set();

  for (const inc of incidencias) {
    afectados.add(String(inc.empleadoId));
  }
  for (const det of detalles) {
    if ((det.diasFalta || 0) > 0 || (det.minutosRetardo || 0) > 0 || (det.minutosHorasExtra || 0) > 0) {
      afectados.add(String(det.empleadoId));
    }
  }

  const sinCodigo = [];
  for (const empId of afectados) {
    const emp = empMap.get(empId);
    if (!emp) continue;
    // Mismo criterio que exportación: codigoExterno o, en su defecto, numEmpleado
    if (!getEmpleadoExportId(emp)) {
      sinCodigo.push({
        _id: emp._id,
        numEmpleado: emp.numEmpleado,
        nombre: `${emp.firstName} ${emp.lastName}`.trim()
      });
    }
  }

  return {
    ok: sinCodigo.length === 0,
    sinCodigo,
    totalAfectados: afectados.size
  };
}

function applyExportFlagsToDetalle(empleado, detalle) {
  const percepciones = [...(detalle.percepciones || [])];
  const deducciones = [...(detalle.deducciones || [])];

  const filteredPercepciones = empleado.exportarHorasExtra === false
    ? percepciones.filter((p) => p.clave !== 'P002' && p.formula !== 'horas_extra')
    : percepciones;

  const filteredDeducciones = deducciones.filter((d) => {
    if (empleado.exportarRetardos === false && (d.clave === 'D001' || d.formula === 'retardos')) return false;
    if (empleado.exportarFaltas === false && (d.clave === 'D002' || d.formula === 'faltas')) return false;
    return true;
  });

  const totalPercepciones = Math.round(filteredPercepciones.reduce((s, l) => s + l.monto, 0) * 100) / 100;
  const totalDeducciones = Math.round(filteredDeducciones.reduce((s, l) => s + l.monto, 0) * 100) / 100;

  return {
    ...detalle,
    percepciones: filteredPercepciones,
    deducciones: filteredDeducciones,
    totalPercepciones,
    totalDeducciones,
    netoPagar: Math.round((totalPercepciones - totalDeducciones) * 100) / 100,
    exportId: getEmpleadoExportId(empleado)
  };
}

module.exports = { validateCodigoExternoForPeriod, applyExportFlagsToDetalle };

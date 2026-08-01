'use strict';

const { getEmpleadoExportId } = require('../../libs/empleadoHelpers');

function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToCsv(row, headers) {
  return headers.map((h) => escapeCsv(row[h])).join(',');
}

function buildCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(rowToCsv(row, headers));
  return lines.join('\n');
}

function resolveMapping(fieldMapping, defaults) {
  return { ...defaults, ...(fieldMapping || {}) };
}

function mapPayrollRow(empleado, detalle, periodo, mapping) {
  return {
    [mapping.numEmpleado]: getEmpleadoExportId(empleado),
    [mapping.rfc]: empleado.rfc || '',
    [mapping.curp]: empleado.curp || '',
    [mapping.nss]: empleado.nss || '',
    [mapping.nombre]: empleado.firstName,
    [mapping.apellidos]: empleado.lastName,
    [mapping.salarioDiario]: detalle.salarioDiario ?? 0,
    [mapping.diasTrabajados]: detalle.diasTrabajados ?? 0,
    [mapping.totalPercepciones]: detalle.totalPercepciones ?? 0,
    [mapping.totalDeducciones]: detalle.totalDeducciones ?? 0,
    [mapping.netoPagar]: detalle.netoPagar ?? 0,
    PERIODO_INICIO: new Date(periodo.fechaInicio).toISOString().slice(0, 10),
    PERIODO_FIN: new Date(periodo.fechaFin).toISOString().slice(0, 10)
  };
}

module.exports = { escapeCsv, buildCsv, resolveMapping, mapPayrollRow };

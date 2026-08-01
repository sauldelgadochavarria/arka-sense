'use strict';

const { DEFAULT_FIELD_MAPPING } = require('../../../config/integraciones');
const { buildCsv, resolveMapping, mapPayrollRow } = require('../csvUtils');

const HEADERS = [
  'NUM_EMPLEADO',
  'RFC',
  'CURP',
  'NSS',
  'NOMBRE',
  'APELLIDOS',
  'SALARIO_DIARIO',
  'DIAS_TRABAJADOS',
  'PERCEPCIONES',
  'DEDUCCIONES',
  'NETO',
  'PERIODO_INICIO',
  'PERIODO_FIN'
];

function exportPayroll({ empleados, detalles, periodo, fieldMapping }) {
  const mapping = resolveMapping(fieldMapping, DEFAULT_FIELD_MAPPING);
  const detMap = new Map(detalles.map((d) => [String(d.empleadoId), d]));
  const rows = [];

  for (const emp of empleados) {
    const det = detMap.get(String(emp._id));
    if (!det) continue;
    rows.push(mapPayrollRow(emp, det, periodo, mapping));
  }

  const headers = [...new Set([...Object.values(mapping), 'PERIODO_INICIO', 'PERIODO_FIN'])];
  const content = buildCsv(headers, rows);
  const inicio = new Date(periodo.fechaInicio).toISOString().slice(0, 10);
  const fin = new Date(periodo.fechaFin).toISOString().slice(0, 10);

  return {
    content,
    filename: `contpaqi_prenomina_${inicio}_${fin}.csv`,
    registros: rows.length
  };
}

module.exports = { id: 'contpaqi', exportPayroll };

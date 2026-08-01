'use strict';

const { DEFAULT_FIELD_MAPPING } = require('../../../config/integraciones');
const { buildCsv, resolveMapping, mapPayrollRow } = require('../csvUtils');

function exportPayroll({ empleados, detalles, periodo, fieldMapping }) {
  const mapping = resolveMapping(fieldMapping, DEFAULT_FIELD_MAPPING);
  const headers = [...Object.values(mapping), 'PERIODO_INICIO', 'PERIODO_FIN'];
  const detMap = new Map(detalles.map((d) => [String(d.empleadoId), d]));
  const rows = [];

  for (const emp of empleados) {
    const det = detMap.get(String(emp._id));
    if (!det) continue;
    rows.push(mapPayrollRow(emp, det, periodo, mapping));
  }

  const content = buildCsv(headers, rows);
  const inicio = new Date(periodo.fechaInicio).toISOString().slice(0, 10);
  const fin = new Date(periodo.fechaFin).toISOString().slice(0, 10);

  return {
    content,
    filename: `prenomina_${inicio}_${fin}.csv`,
    registros: rows.length
  };
}

module.exports = { id: 'csv', exportPayroll };

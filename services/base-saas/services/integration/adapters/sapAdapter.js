'use strict';

const { buildCsv } = require('../csvUtils');

const SAP_HEADERS = [
  'PERNR',
  'STCD1',
  'VORNA',
  'NACHN',
  'BETRG_SD',
  'ANZHL',
  'BETRG_PER',
  'BETRG_DED',
  'BETRG_NET',
  'BEGDA',
  'ENDDA'
];

function exportPayroll({ empleados, detalles, periodo }) {
  const detMap = new Map(detalles.map((d) => [String(d.empleadoId), d]));
  const rows = [];
  const inicio = new Date(periodo.fechaInicio).toISOString().slice(0, 10).replace(/-/g, '');
  const fin = new Date(periodo.fechaFin).toISOString().slice(0, 10).replace(/-/g, '');

  for (const emp of empleados) {
    const det = detMap.get(String(emp._id));
    if (!det) continue;
    rows.push({
      PERNR: emp.numEmpleado,
      STCD1: emp.rfc || '',
      VORNA: emp.firstName,
      NACHN: emp.lastName,
      BETRG_SD: det.salarioDiario ?? 0,
      ANZHL: det.diasTrabajados ?? 0,
      BETRG_PER: det.totalPercepciones ?? 0,
      BETRG_DED: det.totalDeducciones ?? 0,
      BETRG_NET: det.netoPagar ?? 0,
      BEGDA: inicio,
      ENDDA: fin
    });
  }

  const content = buildCsv(SAP_HEADERS, rows);
  const fnameInicio = new Date(periodo.fechaInicio).toISOString().slice(0, 10);

  return {
    content,
    filename: `sap_hcm_prenomina_${fnameInicio}.csv`,
    registros: rows.length
  };
}

module.exports = { id: 'sap', exportPayroll };

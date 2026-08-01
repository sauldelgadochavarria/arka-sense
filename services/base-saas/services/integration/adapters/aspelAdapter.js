'use strict';

const { DEFAULT_FIELD_MAPPING } = require('../../../config/integraciones');
const { buildCsv, resolveMapping, mapPayrollRow } = require('../csvUtils');

const ASPel_HEADERS = [
  'NOI_EMP',
  'RFC_EMP',
  'NOM_EMP',
  'AP_PATERNO',
  'AP_MATERNO',
  'SDI',
  'DIAS_LAB',
  'TOT_PER',
  'TOT_DED',
  'NETO',
  'F_INI',
  'F_FIN'
];

function exportPayroll({ empleados, detalles, periodo, fieldMapping }) {
  const mapping = resolveMapping(fieldMapping, {
    ...DEFAULT_FIELD_MAPPING,
    numEmpleado: 'NOI_EMP',
    rfc: 'RFC_EMP',
    nombre: 'NOM_EMP',
    apellidos: 'AP_PATERNO',
    salarioDiario: 'SDI',
    diasTrabajados: 'DIAS_LAB',
    totalPercepciones: 'TOT_PER',
    totalDeducciones: 'TOT_DED',
    netoPagar: 'NETO'
  });

  const detMap = new Map(detalles.map((d) => [String(d.empleadoId), d]));
  const rows = [];

  for (const emp of empleados) {
    const det = detMap.get(String(emp._id));
    if (!det) continue;
    const base = mapPayrollRow(emp, det, periodo, mapping);
    rows.push({
      NOI_EMP: emp.numEmpleado,
      RFC_EMP: emp.rfc || '',
      NOM_EMP: emp.firstName,
      AP_PATERNO: emp.lastName,
      AP_MATERNO: '',
      SDI: det.salarioDiario ?? 0,
      DIAS_LAB: det.diasTrabajados ?? 0,
      TOT_PER: det.totalPercepciones ?? 0,
      TOT_DED: det.totalDeducciones ?? 0,
      NETO: det.netoPagar ?? 0,
      F_INI: base.PERIODO_INICIO,
      F_FIN: base.PERIODO_FIN
    });
  }

  const content = buildCsv(ASPel_HEADERS, rows);
  const inicio = new Date(periodo.fechaInicio).toISOString().slice(0, 10);
  const fin = new Date(periodo.fechaFin).toISOString().slice(0, 10);

  return {
    content,
    filename: `aspel_noi_${inicio}_${fin}.csv`,
    registros: rows.length
  };
}

module.exports = { id: 'aspel', exportPayroll };

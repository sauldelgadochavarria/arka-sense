'use strict';

/**
 * Catálogo de cargas iniciales / onboarding de empresa.
 * Cada tipo tiene plantilla CSV y un handler en services/cargas/handlers.
 */
const CARGAS_INICIALES = [
  {
    codigo: 'empleados',
    titulo: 'Empleados',
    descripcion: 'Alta masiva de personal (número, nombre, RFC, sueldo, ingreso).',
    fase: 1,
    aplica: true,
    columnas: [
      'numEmpleado',
      'firstName',
      'lastName',
      'rfc',
      'curp',
      'nss',
      'email',
      'salarioDiario',
      'fechaIngreso',
      'tipoContrato',
      'tipoEmpleado',
      'estatus'
    ],
    ejemploFilas: [
      ['1001', 'Ana', 'García López', 'GALA850101XXX', 'GALA850101MDFRRN09', '12345678901', 'ana@empresa.com', '850', '2024-01-15', 'indefinido', 'confianza', 'activo']
    ]
  },
  {
    codigo: 'historial_laboral',
    titulo: 'Historial laboral / movimientos',
    descripcion: 'Altas, cambios de sueldo, bajas y demás movimientos por empleado.',
    fase: 1,
    aplica: true,
    columnas: [
      'numEmpleado',
      'tipoMovimientoCodigo',
      'fechaMovimiento',
      'salarioDiario',
      'observaciones'
    ],
    ejemploFilas: [
      ['1001', 'ALTA', '2024-01-15', '850', 'Alta inicial migrada']
    ]
  },
  {
    codigo: 'acumulados',
    titulo: 'Acumulados de nómina',
    descripcion: 'Saldos anuales por concepto (ISR, gravado, etc.) para continuidad fiscal.',
    fase: 1,
    aplica: true,
    columnas: [
      'numEmpleado',
      'anio',
      'conceptoCodigo',
      'importeAnual',
      'gravadoAnual',
      'exentoAnual',
      'mes01',
      'mes02',
      'mes03',
      'mes04',
      'mes05',
      'mes06',
      'mes07',
      'mes08',
      'mes09',
      'mes10',
      'mes11',
      'mes12'
    ],
    ejemploFilas: [
      ['1001', '2026', 'SUELDO', '45000', '45000', '0', '7500', '7500', '7500', '7500', '7500', '7500', '0', '0', '0', '0', '0', '0']
    ]
  },
  {
    codigo: 'historico_recibos',
    titulo: 'Histórico de recibos',
    descripcion: 'Recibos cerrados de períodos anteriores (migración completa). Apply parcial en v1.',
    fase: 2,
    aplica: true,
    columnas: [
      'numEmpleado',
      'anio',
      'numeroPeriodo',
      'tipoPeriodo',
      'fechaInicio',
      'fechaFin',
      'netoPagar',
      'percepciones',
      'deducciones',
      'diasLaborados',
      'diasPagados'
    ],
    ejemploFilas: [
      ['1001', '2026', '1', 'semanal', '2026-01-01', '2026-01-07', '5200', '5950', '750', '5', '7']
    ]
  },
  {
    codigo: 'creditos_saldos',
    titulo: 'Créditos y saldos',
    descripcion: 'Infonavit, préstamos, fondo de ahorro (saldo inicial). Próximamente.',
    fase: 2,
    aplica: false,
    /** No mostrar en el hub de cargas; solo recordatorio en menú. */
    soloMenu: true,
    columnas: ['numEmpleado', 'tipo', 'saldo', 'referencia'],
    ejemploFilas: [['1001', 'infonavit', '12500', 'CR-001']]
  }
];

function getCargaByCodigo(codigo) {
  return CARGAS_INICIALES.find((c) => c.codigo === String(codigo || '').toLowerCase()) || null;
}

function listCargasParaHub() {
  return CARGAS_INICIALES.filter((c) => !c.soloMenu);
}

function buildCsvTemplate(carga) {
  const header = carga.columnas.join(',');
  const rows = (carga.ejemploFilas || []).map((r) =>
    r
      .map((cell) => {
        const s = String(cell ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(',')
  );
  return [header, ...rows].join('\n') + '\n';
}

module.exports = {
  CARGAS_INICIALES,
  getCargaByCodigo,
  listCargasParaHub,
  buildCsvTemplate
};

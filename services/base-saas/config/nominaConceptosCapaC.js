'use strict';

/**
 * Capa C — oleada 2: INFONAVIT, fondo de ahorro, prima vacacional, finiquito.
 */

const VIGENCIA_CAPA_C = new Date('2026-07-01');

const MAPEO_CANONICO_CAPA_C = {
  54: 'FONDO_AHORRO_EMPRESA',
  55: 'FONDO_AHORRO_TRABAJADOR',
  402: 'DED_FONDO_AHORRO',
  2146: 'INFONAVIT',
  2147: 'INFONAVIT',
  2149: 'INFONAVIT',
  22: 'PRIMA_VACACIONAL',
  83: 'FINIQUITO_AGUINALDO',
  87: 'FINIQUITO_FONDO_AHORRO',
  82: 'INDEMNIZACION_90_DIAS'
};

const PRIORIDAD_CAPA_C_IDS = [
  54, 55, 402, 2026, 2027, 2146, 2147, 2149, 22, 38, 39, 83, 87, 82, 81, 80, 156, 2110, 2130
];

const CONCEPTOS_CAPA_C = [
  {
    codigo: 'FONDO_AHORRO_EMPRESA',
    nombre: 'Fondo de ahorro empresa',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    ordenCalculo: 36,
    sat: { tipo: 'percepcion', clave: '038', descripcion: 'Otros ingresos por salarios' },
    metadata: { legadoClaPerded: 54 }
  },
  {
    codigo: 'FONDO_AHORRO_TRABAJADOR',
    nombre: 'Fondo de ahorro trabajador',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    ordenCalculo: 37,
    sat: { tipo: 'percepcion', clave: '038', descripcion: 'Otros ingresos por salarios' },
    metadata: { legadoClaPerded: 55, esAportacionTrabajador: true }
  },
  {
    codigo: 'DED_FONDO_AHORRO',
    nombre: 'Deducción fondo de ahorro trabajador',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    ordenCalculo: 57,
    sat: { tipo: 'deduccion', clave: '004', descripcion: 'Otros' },
    metadata: { legadoClaPerded: 402 }
  },
  {
    codigo: 'INFONAVIT',
    nombre: 'Descuento INFONAVIT',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    ordenCalculo: 56,
    sat: { tipo: 'deduccion', clave: '010', descripcion: 'Pago por crédito de vivienda' },
    metadata: { legadoClaPerded: 2146 }
  },
  {
    codigo: 'FINIQUITO_AGUINALDO',
    nombre: 'Aguinaldo finiquito',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    ordenCalculo: 8,
    aplicaTipoNomina: ['finiquito'],
    sat: { tipo: 'percepcion', clave: '002', descripcion: 'Aguinaldo' },
    metadata: { legadoClaPerded: 83 }
  },
  {
    codigo: 'FINIQUITO_FONDO_AHORRO',
    nombre: 'Fondo de ahorro finiquito',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    ordenCalculo: 38,
    aplicaTipoNomina: ['finiquito'],
    sat: { tipo: 'percepcion', clave: '038', descripcion: 'Otros ingresos por salarios' },
    metadata: { legadoClaPerded: 87 }
  },
  {
    codigo: 'INDEMNIZACION_90_DIAS',
    nombre: 'Indemnización 90 días',
    tipo: 'percepcion',
    naturaleza: 'exento',
    ordenCalculo: 12,
    aplicaTipoNomina: ['finiquito'],
    sat: { tipo: 'percepcion', clave: '025', descripcion: 'Indemnizaciones' },
    metadata: { legadoClaPerded: 82, pendienteMotor: true }
  }
];

const TIPOS_PERIODO_FORMULA = ['semanal', 'quincenal', 'catorcenal', 'mensual'];

function percepcionesGravadasCapaC(tipoPeriodo) {
  const base = [
    'SUELDO',
    'PRIMA_DOMINICAL',
    'FONDO_AHORRO_EMPRESA',
    'FONDO_AHORRO_TRABAJADOR',
    'HORAS_EXTRA_DOBLES',
    'HORAS_EXTRA_TRIPLES'
  ];
  if (tipoPeriodo === 'semanal') base.splice(1, 0, 'SEPTIMO_DIA');
  return {
    formula: base.join(' + '),
    dependencias: [...base]
  };
}

function deduccionesTotalesCapaC() {
  return {
    formula: 'ISR + IMSS_OBRERO + INFONAVIT + DED_FONDO_AHORRO',
    dependencias: ['ISR', 'IMSS_OBRERO', 'INFONAVIT', 'DED_FONDO_AHORRO']
  };
}

function buildCapaCFormulasForPeriodo(tipoPeriodo) {
  const pg = percepcionesGravadasCapaC(tipoPeriodo);
  const dt = deduccionesTotalesCapaC();

  return [
    {
      conceptoCodigo: 'FONDO_AHORRO_EMPRESA',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'fondoAhorroEmpresa',
      dependencias: [],
      condicion: 'fondoAhorroEmpresa > 0'
    },
    {
      conceptoCodigo: 'FONDO_AHORRO_TRABAJADOR',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'fondoAhorroTrabajador',
      dependencias: [],
      condicion: 'fondoAhorroTrabajador > 0'
    },
    {
      conceptoCodigo: 'DED_FONDO_AHORRO',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'fondoAhorroTrabajador',
      dependencias: [],
      condicion: 'fondoAhorroTrabajador > 0'
    },
    {
      conceptoCodigo: 'INFONAVIT',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'infonavitDescuento',
      dependencias: [],
      condicion: 'infonavitDescuento > 0'
    },
    {
      conceptoCodigo: 'PRIMA_VACACIONAL',
      tipoPeriodo,
      tipoNomina: 'extraordinaria',
      formula: 'sueldoDiario * diasPrimaVacacional * 0.25',
      dependencias: [],
      condicion: 'diasPrimaVacacional > 0'
    },
    {
      conceptoCodigo: 'PERCEPCIONES_GRAVADAS',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: pg.formula,
      dependencias: pg.dependencias,
      condicion: ''
    },
    {
      conceptoCodigo: 'DEDUCCIONES_TOTALES',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: dt.formula,
      dependencias: dt.dependencias,
      condicion: ''
    },
    {
      conceptoCodigo: 'FINIQUITO_AGUINALDO',
      tipoPeriodo,
      tipoNomina: 'finiquito',
      formula: 'proporcionAguinaldoFiniquito',
      dependencias: [],
      condicion: 'proporcionAguinaldoFiniquito > 0'
    },
    {
      conceptoCodigo: 'FINIQUITO_FONDO_AHORRO',
      tipoPeriodo,
      tipoNomina: 'finiquito',
      formula: 'fondoAhorroSaldoFiniquito',
      dependencias: [],
      condicion: 'fondoAhorroSaldoFiniquito > 0'
    }
  ];
}

const FORMULAS_CAPA_C = TIPOS_PERIODO_FORMULA.flatMap((tp) => buildCapaCFormulasForPeriodo(tp));

module.exports = {
  MAPEO_CANONICO_CAPA_C,
  PRIORIDAD_CAPA_C_IDS,
  CONCEPTOS_CAPA_C,
  FORMULAS_CAPA_C,
  VIGENCIA_CAPA_C,
  buildCapaCFormulasForPeriodo
};

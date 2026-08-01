'use strict';

/**
 * Capa B: conceptos prioritarios del catálogo legado con fórmulas mathjs.
 * MAPEO_CANONICO_LEGADO vincula CLA_PERDED → código del motor PayPilot.
 */

const { VIGENCIA_FISCAL_V2 } = require('./nominaDefaults');

const VIGENCIA_CAPA_B = VIGENCIA_FISCAL_V2;

/** IDs legado → código canónico PayPilot (metadatos en concepto L####) */
const MAPEO_CANONICO_LEGADO = {
  1: 'SUELDO',
  2: 'SEPTIMO_DIA',
  6: 'PRIMA_DOMINICAL',
  27: 'PTU',
  66: 'AGUINALDO',
  1210: 'AGUINALDO',
  1050: 'HORAS_EXTRA_DOBLES',
  403: 'ISR',
  406: 'IMSS_OBRERO',
  2020: 'SUBSIDIO_EMPLEO'
};

/** ~30 conceptos prioritarios para traducción a mathjs (oleada 1) */
const PRIORIDAD_CAPA_B_IDS = [
  1, 2, 6, 1050, 16, 17, 27, 66, 1210, 1215, 1430, 20, 22, 30, 54, 55, 403, 406, 2020, 177,
  2146, 2147, 2149, 156, 2110, 5, 19, 83, 87, 1051
];

const CONCEPTOS_CAPA_B = [
  {
    codigo: 'PRIMA_DOMINICAL',
    nombre: 'Prima dominical',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    ordenCalculo: 18,
    sat: { tipo: 'percepcion', clave: '020', descripcion: 'Prima dominical' },
    metadata: { legadoClaPerded: 6 }
  },
  {
    codigo: 'PTU',
    nombre: 'Participación de utilidades (PTU)',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    ordenCalculo: 35,
    sat: { tipo: 'percepcion', clave: '003', descripcion: 'PTU' },
    metadata: { legadoClaPerded: 27, requiereCapturaManual: true }
  },
  {
    codigo: 'AGUINALDO',
    nombre: 'Aguinaldo',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    ordenCalculo: 5,
    sat: { tipo: 'percepcion', clave: '002', descripcion: 'Aguinaldo' },
    metadata: { legadoClaPerded: 1210, topeExentoUMA: 30 }
  },
  {
    codigo: 'PRIMA_VACACIONAL',
    nombre: 'Prima vacacional',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    ordenCalculo: 25,
    sat: { tipo: 'percepcion', clave: '021', descripcion: 'Prima vacacional' },
    metadata: { legadoClaPerded: 22, pendienteMotor: true }
  },
  {
    codigo: 'SUBSIDIO_EMPLEO',
    nombre: 'Subsidio al empleo',
    tipo: 'otro_pago',
    naturaleza: 'fiscal',
    ordenCalculo: 52,
    sat: { tipo: 'otro_pago', clave: '002', descripcion: 'Subsidio para el empleo' },
    metadata: { legadoClaPerded: 2020, pendienteMotor: true }
  },
  {
    codigo: 'DEDUCCIONES_TOTALES',
    nombre: 'Total deducciones',
    tipo: 'deduccion',
    naturaleza: 'informativo',
    ordenCalculo: 58,
    metadata: { informativo: true }
  },
  {
    codigo: 'NETO_PAGAR',
    nombre: 'Neto a pagar',
    tipo: 'percepcion',
    naturaleza: 'informativo',
    ordenCalculo: 90,
    metadata: { informativo: true, esNeto: true }
  }
];

const TIPOS_PERIODO_FORMULA = ['semanal', 'quincenal', 'catorcenal', 'mensual'];

function percepcionesGravadasCapaB(tipoPeriodo) {
  const base = ['SUELDO', 'PRIMA_DOMINICAL', 'HORAS_EXTRA_DOBLES', 'HORAS_EXTRA_TRIPLES'];
  if (tipoPeriodo === 'semanal') {
    base.splice(1, 0, 'SEPTIMO_DIA');
  }
  return {
    formula: base.join(' + '),
    dependencias: [...base]
  };
}

function buildCapaBFormulasForPeriodo(tipoPeriodo) {
  const pg = percepcionesGravadasCapaB(tipoPeriodo);
  const formulas = [
    {
      conceptoCodigo: 'PRIMA_DOMINICAL',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'sueldoDiario * 2 * 0.125',
      dependencias: [],
      condicion: tipoPeriodo === 'semanal' ? 'diasLaborados >= 6' : 'false'
    },
    {
      conceptoCodigo: 'PTU',
      tipoPeriodo,
      tipoNomina: 'extraordinaria',
      formula: '0',
      dependencias: [],
      condicion: 'false'
    },
    {
      conceptoCodigo: 'AGUINALDO',
      tipoPeriodo,
      tipoNomina: 'aguinaldo',
      formula: 'sueldoDiario * min(15, diasPeriodo)',
      dependencias: [],
      condicion: 'sueldoDiario > 0'
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
      formula: 'ISR + IMSS_OBRERO',
      dependencias: ['ISR', 'IMSS_OBRERO'],
      condicion: ''
    },
    {
      conceptoCodigo: 'NETO_PAGAR',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'PERCEPCIONES_GRAVADAS - DEDUCCIONES_TOTALES',
      dependencias: ['PERCEPCIONES_GRAVADAS', 'DEDUCCIONES_TOTALES'],
      condicion: ''
    }
  ];

  if (tipoPeriodo === 'semanal') {
    formulas.push({
      conceptoCodigo: 'AGUINALDO',
      tipoPeriodo,
      tipoNomina: 'aguinaldo',
      formula: 'sueldoDiario * min(15, diasPeriodo)',
      dependencias: [],
      condicion: 'sueldoDiario > 0'
    });
  }

  return formulas;
}

const FORMULAS_CAPA_B = TIPOS_PERIODO_FORMULA.flatMap((tp) => buildCapaBFormulasForPeriodo(tp));

module.exports = {
  MAPEO_CANONICO_LEGADO,
  PRIORIDAD_CAPA_B_IDS,
  CONCEPTOS_CAPA_B,
  FORMULAS_CAPA_B,
  VIGENCIA_CAPA_B,
  buildCapaBFormulasForPeriodo
};

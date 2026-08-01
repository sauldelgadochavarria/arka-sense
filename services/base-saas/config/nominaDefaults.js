'use strict';

/**
 * Conceptos y fórmulas base para sembrar un tenant nuevo.
 * Funciones fiscales: isrPeriodo(), imssObrero(), variables de pre-nómina.
 */

const CONCEPTOS_BASE = [
  {
    codigo: 'SUELDO',
    nombre: 'Sueldo base del período',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    ordenCalculo: 10,
    sat: { tipo: 'percepcion', clave: '001', descripcion: 'Sueldos, salarios y rayas' }
  },
  {
    codigo: 'SEPTIMO_DIA',
    nombre: 'Séptimo día',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    ordenCalculo: 15,
    sat: { tipo: 'percepcion', clave: '001', descripcion: 'Sueldos, salarios y rayas' }
  },
  {
    codigo: 'HORAS_EXTRA_DOBLES',
    nombre: 'Horas extra dobles',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    ordenCalculo: 20,
    sat: { tipo: 'percepcion', clave: '019', descripcion: 'Horas extra', tipoHoraExtra: 'DO' }
  },
  {
    codigo: 'HORAS_EXTRA_TRIPLES',
    nombre: 'Horas extra triples',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    ordenCalculo: 21,
    sat: { tipo: 'percepcion', clave: '019', descripcion: 'Horas extra', tipoHoraExtra: 'TE' }
  },
  {
    codigo: 'PERCEPCIONES_GRAVADAS',
    nombre: 'Total percepciones gravadas',
    tipo: 'percepcion',
    naturaleza: 'informativo',
    ordenCalculo: 40,
    metadata: { informativo: true }
  },
  {
    codigo: 'ISR',
    nombre: 'Impuesto Sobre la Renta',
    tipo: 'deduccion',
    naturaleza: 'fiscal',
    ordenCalculo: 50,
    metadata: { requiereTablaFiscal: 'ISR_MENSUAL' },
    sat: { tipo: 'deduccion', clave: '002', descripcion: 'ISR' }
  },
  {
    codigo: 'IMSS_OBRERO',
    nombre: 'IMSS obrero',
    tipo: 'deduccion',
    naturaleza: 'fiscal',
    ordenCalculo: 55,
    sat: { tipo: 'deduccion', clave: '001', descripcion: 'Seguridad social' }
  }
];

const TIPOS_PERIODO_FORMULA = ['semanal', 'quincenal', 'catorcenal', 'mensual'];

function percepcionesGravadasFormula(tipoPeriodo) {
  if (tipoPeriodo === 'semanal') {
    return {
      formula: 'SUELDO + SEPTIMO_DIA + HORAS_EXTRA_DOBLES + HORAS_EXTRA_TRIPLES',
      dependencias: ['SUELDO', 'SEPTIMO_DIA', 'HORAS_EXTRA_DOBLES', 'HORAS_EXTRA_TRIPLES']
    };
  }
  return {
    formula: 'SUELDO + HORAS_EXTRA_DOBLES + HORAS_EXTRA_TRIPLES',
    dependencias: ['SUELDO', 'HORAS_EXTRA_DOBLES', 'HORAS_EXTRA_TRIPLES']
  };
}

function buildFormulasForPeriodo(tipoPeriodo) {
  const pg = percepcionesGravadasFormula(tipoPeriodo);
  return [
    {
      conceptoCodigo: 'SUELDO',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'sueldoDiario * diasLaborados',
      dependencias: [],
      condicion: ''
    },
    {
      conceptoCodigo: 'SEPTIMO_DIA',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'sueldoDiario * 1',
      dependencias: [],
      condicion: tipoPeriodo === 'semanal' ? 'diasLaborados >= 6' : 'false'
    },
    {
      conceptoCodigo: 'HORAS_EXTRA_DOBLES',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'sueldoDiario / 8 * horasExtraDobles * 2',
      dependencias: [],
      condicion: 'horasExtraDobles > 0'
    },
    {
      conceptoCodigo: 'HORAS_EXTRA_TRIPLES',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'sueldoDiario / 8 * horasExtraTriples * 3',
      dependencias: [],
      condicion: 'horasExtraTriples > 0'
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
      conceptoCodigo: 'ISR',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'isrPeriodo(PERCEPCIONES_GRAVADAS)',
      dependencias: ['PERCEPCIONES_GRAVADAS'],
      condicion: 'PERCEPCIONES_GRAVADAS > 0'
    },
    {
      conceptoCodigo: 'IMSS_OBRERO',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'imssObrero(sueldoDiario, diasLaborados)',
      dependencias: [],
      condicion: 'diasLaborados > 0'
    }
  ];
}

const FORMULAS_BASE = TIPOS_PERIODO_FORMULA.flatMap((tp) => buildFormulasForPeriodo(tp));

/** Fórmulas ISR/IMSS v2 para actualizar tenants existentes */
const FORMULAS_FISCALES_V2 = FORMULAS_BASE.filter((f) =>
  ['ISR', 'IMSS_OBRERO', 'HORAS_EXTRA_TRIPLES', 'PERCEPCIONES_GRAVADAS', 'HORAS_EXTRA_DOBLES'].includes(
    f.conceptoCodigo
  )
);

const VIGENCIA_INICIAL = new Date('2025-01-01');
const VIGENCIA_FISCAL_V2 = new Date('2026-06-01');

module.exports = {
  CONCEPTOS_BASE,
  FORMULAS_BASE,
  FORMULAS_FISCALES_V2,
  VIGENCIA_INICIAL,
  VIGENCIA_FISCAL_V2,
  buildFormulasForPeriodo
};

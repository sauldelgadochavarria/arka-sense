'use strict';

/**
 * Conceptos y fórmulas base para sembrar un tenant nuevo.
 * Set limpio: sueldo, impuestos, acumuladores. Premios y fondo van en capas B/C.
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
    metadata: { requiereTablaFiscal: 'IMSS_CUOTAS' },
    sat: { tipo: 'deduccion', clave: '001', descripcion: 'Seguridad social' }
  },
  {
    codigo: 'IMSS_PATRONAL',
    nombre: 'IMSS patronal (informativo)',
    tipo: 'deduccion',
    naturaleza: 'informativo',
    ordenCalculo: 56,
    metadata: { informativo: true, requiereTablaFiscal: 'IMSS_CUOTAS' }
  },
  {
    codigo: 'ISR_SAT',
    nombre: 'ISR Motor SAT (oficial / CFDI)',
    tipo: 'deduccion',
    naturaleza: 'informativo',
    ordenCalculo: 57,
    metadata: { informativo: true, motorIsr: 'sat' }
  },
  {
    codigo: 'ISR_PROYECTADO',
    nombre: 'ISR Motor Inteligente (proyección anual)',
    tipo: 'deduccion',
    naturaleza: 'informativo',
    ordenCalculo: 58,
    metadata: { informativo: true, motorIsr: 'inteligente' }
  },
  {
    codigo: 'ISR_AJUSTADO',
    nombre: 'ISR ajustado (referencia uniforme)',
    tipo: 'deduccion',
    naturaleza: 'informativo',
    ordenCalculo: 59,
    metadata: { informativo: true, motorIsr: 'inteligente' }
  },
  {
    codigo: 'ISR_DIFERENCIA',
    nombre: 'Diferencia ISR proyectado − SAT',
    tipo: 'deduccion',
    naturaleza: 'informativo',
    ordenCalculo: 60,
    metadata: { informativo: true, motorIsr: 'inteligente' }
  }
];

const TIPOS_PERIODO_FORMULA = ['semanal', 'quincenal', 'catorcenal', 'mensual'];

function buildFormulasForPeriodo(tipoPeriodo) {
  return [
    {
      conceptoCodigo: 'SUELDO',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'sueldoDiario * diasPagados',
      dependencias: [],
      condicion: ''
    },
    {
      conceptoCodigo: 'PERCEPCIONES_GRAVADAS',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'SUELDO',
      dependencias: ['SUELDO'],
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
      formula: 'imssObrero(sueldoDiario, diasCotizacion)',
      dependencias: [],
      condicion: 'diasCotizacion > 0'
    },
    {
      conceptoCodigo: 'IMSS_PATRONAL',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'imssPatronal(sueldoDiario, diasCotizacion)',
      dependencias: [],
      condicion: 'diasCotizacion > 0'
    }
  ];
}

const FORMULAS_BASE = TIPOS_PERIODO_FORMULA.flatMap((tp) => buildFormulasForPeriodo(tp));

/** Fórmulas ISR/IMSS v2 para actualizar tenants existentes */
const FORMULAS_FISCALES_V2 = FORMULAS_BASE.filter((f) =>
  ['ISR', 'IMSS_OBRERO', 'IMSS_PATRONAL', 'PERCEPCIONES_GRAVADAS'].includes(f.conceptoCodigo)
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

'use strict';

/**
 * Capa B: premios + acumuladores de neto.
 * MAPEO_CANONICO_LEGADO vincula CLA_PERDED → código del motor PayPilot.
 */

const { VIGENCIA_FISCAL_V2 } = require('./nominaDefaults');

const VIGENCIA_CAPA_B = VIGENCIA_FISCAL_V2;

/** IDs legado → código canónico PayPilot (metadatos en concepto L####) */
const MAPEO_CANONICO_LEGADO = {
  1: 'SUELDO',
  16: 'PREMIO_ASISTENCIA',
  17: 'PREMIO_PUNTUALIDAD',
  403: 'ISR',
  406: 'IMSS_OBRERO'
};

/** IDs legado prioritarios (referencia; el set activo es CONCEPTOS_CAPA_B) */
const PRIORIDAD_CAPA_B_IDS = [1, 16, 17, 54, 55, 402, 403, 406];

const CONCEPTOS_CAPA_B = [
  {
    codigo: 'PREMIO_PUNTUALIDAD',
    nombre: 'Premio de puntualidad',
    tipo: 'percepcion',
    naturaleza: 'exento',
    ordenCalculo: 30,
    sat: { tipo: 'percepcion', clave: '010', descripcion: 'Premios por puntualidad' },
    metadata: { legadoClaPerded: 17 }
  },
  {
    codigo: 'PREMIO_ASISTENCIA',
    nombre: 'Premio de asistencia',
    tipo: 'percepcion',
    naturaleza: 'exento',
    ordenCalculo: 31,
    sat: { tipo: 'percepcion', clave: '049', descripcion: 'Premios por asistencia' },
    metadata: { legadoClaPerded: 16 }
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

function buildCapaBFormulasForPeriodo(tipoPeriodo) {
  return [
    {
      conceptoCodigo: 'PREMIO_PUNTUALIDAD',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: '500',
      dependencias: [],
      condicion: 'INCIDENCIAS.sinRetardo == 1'
    },
    {
      conceptoCodigo: 'PREMIO_ASISTENCIA',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: '500',
      dependencias: [],
      condicion: 'diasLaborados >= diasProgramados'
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
      conceptoCodigo: 'DEDUCCIONES_TOTALES',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'ISR + IMSS_OBRERO + DED_FONDO_AHORRO',
      dependencias: ['ISR', 'IMSS_OBRERO', 'DED_FONDO_AHORRO'],
      condicion: ''
    },
    {
      conceptoCodigo: 'NETO_PAGAR',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula:
        'SUELDO + PREMIO_PUNTUALIDAD + PREMIO_ASISTENCIA + FONDO_AHORRO_EMPRESA - DEDUCCIONES_TOTALES',
      dependencias: [
        'SUELDO',
        'PREMIO_PUNTUALIDAD',
        'PREMIO_ASISTENCIA',
        'FONDO_AHORRO_EMPRESA',
        'DEDUCCIONES_TOTALES'
      ],
      condicion: ''
    }
  ];
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

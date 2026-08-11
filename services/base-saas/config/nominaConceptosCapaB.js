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
    fiscal: {
      naturaleza: 'exento',
      integraISR: false,
      integraIMSS: true,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_exento', codigoRegla: '' },
      imss: {
        naturalezaSdi: 'variable',
        desglose: {
          modo: 'regla_ley',
          topeNoIntegraPctSbc: 10,
          codigoRegla: 'premio_10_sbc'
        }
      }
    },
    metadata: { legadoClaPerded: 17 }
  },
  {
    codigo: 'PREMIO_ASISTENCIA',
    nombre: 'Premio de asistencia',
    tipo: 'percepcion',
    naturaleza: 'exento',
    ordenCalculo: 31,
    sat: { tipo: 'percepcion', clave: '049', descripcion: 'Premios por asistencia' },
    fiscal: {
      naturaleza: 'exento',
      integraISR: false,
      integraIMSS: true,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_exento', codigoRegla: '' },
      imss: {
        naturalezaSdi: 'variable',
        desglose: {
          modo: 'regla_ley',
          topeNoIntegraPctSbc: 10,
          codigoRegla: 'premio_10_sbc'
        }
      }
    },
    metadata: { legadoClaPerded: 16 }
  },
  {
    codigo: 'DEDUCCIONES_TOTALES',
    nombre: 'Total deducciones',
    tipo: 'deduccion',
    naturaleza: 'informativo',
    ordenCalculo: 58,
    fiscal: {
      naturaleza: 'informativo',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_exento' },
      imss: { naturalezaSdi: 'excluido', desglose: { modo: 'todo_excluye' } }
    },
    metadata: { informativo: true }
  },
  {
    codigo: 'NETO_PAGAR',
    nombre: 'Neto a pagar',
    tipo: 'percepcion',
    naturaleza: 'informativo',
    ordenCalculo: 90,
    fiscal: {
      naturaleza: 'informativo',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_exento' },
      imss: { naturalezaSdi: 'excluido', desglose: { modo: 'todo_excluye' } }
    },
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
      formula: 'si(INCIDENCIAS.sinRetardo == 1, 500, 0)',
      dependencias: [],
      condicion: ''
    },
    {
      conceptoCodigo: 'PREMIO_ASISTENCIA',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'si(diasLaborados >= diasProgramados, 500, 0)',
      dependencias: [],
      condicion: ''
    },
    {
      conceptoCodigo: 'PERCEPCIONES_GRAVADAS',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      // Fallback; el motor sobrescribe con suma de campos gravado (desglose fiscal).
      // No usar importes crudos de HE: una parte puede ser exenta (p.ej. dobles).
      formula: '0',
      dependencias: [],
      condicion: ''
    },
    {
      conceptoCodigo: 'DEDUCCIONES_TOTALES',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      // Fallback; el motor sobrescribe con suma de deducciones no informativas (config.tipo).
      formula:
        'ISR + IMSS_OBRERO + DED_FONDO_AHORRO + DED_FONDO_AHORRO_EMPRESA + DED_SEGURO_VIDA + DED_SGMM',
      dependencias: [
        'ISR',
        'IMSS_OBRERO',
        'DED_FONDO_AHORRO',
        'DED_FONDO_AHORRO_EMPRESA',
        'DED_SEGURO_VIDA',
        'DED_SGMM'
      ],
      condicion: ''
    },
    {
      conceptoCodigo: 'NETO_PAGAR',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      // Fallback; el motor sobrescribe con percepciones − deducciones según config.
      formula:
        'SUELDO + HORAS_EXTRA_DOBLES + HORAS_EXTRA_TRIPLES + PREMIO_PUNTUALIDAD + PREMIO_ASISTENCIA + DESPENSA + SEGURO_VIDA + SGMM + FONDO_AHORRO_EMPRESA - DEDUCCIONES_TOTALES',
      dependencias: [
        'SUELDO',
        'HORAS_EXTRA_DOBLES',
        'HORAS_EXTRA_TRIPLES',
        'PREMIO_PUNTUALIDAD',
        'PREMIO_ASISTENCIA',
        'DESPENSA',
        'SEGURO_VIDA',
        'SGMM',
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

'use strict';

const mongoose = require('mongoose');

const fiscalDesgloseSubSchema = new mongoose.Schema(
  {
    modo: {
      type: String,
      enum: ['todo_gravado', 'todo_exento', 'tope_uma', 'tope_monto', 'formula', 'regla_ley'],
      default: 'todo_gravado'
    },
    topeExentoUMA: { type: Number, default: 0 },
    topeExentoMonto: { type: Number, default: 0 },
    formulaExento: { type: String, trim: true, default: '' },
    formulaGravado: { type: String, trim: true, default: '' },
    codigoRegla: { type: String, trim: true, lowercase: true, default: '' }
  },
  { _id: false }
);

/** Desglose IMSS: parte que integra SBC vs parte que no integra. */
const imssDesgloseSubSchema = new mongoose.Schema(
  {
    modo: {
      type: String,
      enum: [
        'todo_integra',
        'todo_excluye',
        'tope_uma',
        'tope_monto',
        'tope_pct_sbc',
        'regla_ley',
        'formula'
      ],
      default: 'todo_integra'
    },
    /** Tope que NO integra, en veces UMA (p.ej. despensa 0.4 × UMA × días). */
    topeNoIntegraUMA: { type: Number, default: 0 },
    topeNoIntegraMonto: { type: Number, default: 0 },
    /** % del SBC del período que no integra (p.ej. premios 10). */
    topeNoIntegraPctSbc: { type: Number, default: 0 },
    formulaIntegra: { type: String, trim: true, default: '' },
    formulaNoIntegra: { type: String, trim: true, default: '' },
    codigoRegla: { type: String, trim: true, lowercase: true, default: '' }
  },
  { _id: false }
);

const imssSubSchema = new mongoose.Schema(
  {
    /** Cómo aporta al SDI/SBC: fijo (paquete/factor), variable (bimestre) o excluido. */
    naturalezaSdi: {
      type: String,
      enum: ['fijo', 'variable', 'excluido'],
      default: 'variable'
    },
    desglose: { type: imssDesgloseSubSchema, default: () => ({ modo: 'todo_integra' }) }
  },
  { _id: false }
);

const fiscalSubSchema = new mongoose.Schema(
  {
    naturaleza: {
      type: String,
      enum: ['gravado', 'exento', 'mixto', 'informativo', 'fiscal'],
      default: 'gravado'
    },
    integraISR: { type: Boolean, default: true },
    integraIMSS: { type: Boolean, default: true },
    integraINFONAVIT: { type: Boolean, default: false },
    desglose: { type: fiscalDesgloseSubSchema, default: () => ({ modo: 'todo_gravado' }) },
    imss: { type: imssSubSchema, default: () => ({ naturalezaSdi: 'variable', desglose: { modo: 'todo_integra' } }) }
  },
  { _id: false }
);

const satSubSchema = new mongoose.Schema(
  {
    tipo: { type: String, enum: ['percepcion', 'deduccion', 'otro_pago', ''], default: '' },
    clave: { type: String, trim: true, default: '' },
    descripcion: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

function emptyImssDesglose(overrides = {}) {
  return {
    modo: 'todo_integra',
    topeNoIntegraUMA: 0,
    topeNoIntegraMonto: 0,
    topeNoIntegraPctSbc: 0,
    formulaIntegra: '',
    formulaNoIntegra: '',
    codigoRegla: '',
    ...overrides
  };
}

/**
 * Config IMSS por defecto a partir del flag integraIMSS / naturaleza SDI.
 */
function defaultImssConfig({ integraIMSS = true, naturalezaSdi } = {}) {
  if (integraIMSS === false || naturalezaSdi === 'excluido') {
    return {
      naturalezaSdi: 'excluido',
      desglose: emptyImssDesglose({ modo: 'todo_excluye' })
    };
  }
  const nat = ['fijo', 'variable'].includes(naturalezaSdi) ? naturalezaSdi : 'variable';
  return {
    naturalezaSdi: nat,
    desglose: emptyImssDesglose({ modo: 'todo_integra' })
  };
}

function defaultFiscalFromNaturaleza(naturaleza = 'gravado') {
  const n = String(naturaleza || 'gravado').toLowerCase();
  if (n === 'exento') {
    return {
      naturaleza: 'exento',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: {
        modo: 'todo_exento',
        topeExentoUMA: 0,
        topeExentoMonto: 0,
        formulaExento: '',
        formulaGravado: '',
        codigoRegla: ''
      },
      imss: defaultImssConfig({ integraIMSS: false })
    };
  }
  if (n === 'mixto') {
    return {
      naturaleza: 'mixto',
      integraISR: true,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: {
        modo: 'regla_ley',
        topeExentoUMA: 5,
        topeExentoMonto: 0,
        formulaExento: '',
        formulaGravado: '',
        codigoRegla: 'horas_extra'
      },
      imss: defaultImssConfig({ integraIMSS: false })
    };
  }
  if (n === 'informativo') {
    return {
      naturaleza: 'informativo',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: {
        modo: 'todo_exento',
        topeExentoUMA: 0,
        topeExentoMonto: 0,
        formulaExento: '',
        formulaGravado: '',
        codigoRegla: ''
      },
      imss: defaultImssConfig({ integraIMSS: false })
    };
  }
  if (n === 'fiscal') {
    return {
      naturaleza: 'fiscal',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: {
        modo: 'todo_gravado',
        topeExentoUMA: 0,
        topeExentoMonto: 0,
        formulaExento: '',
        formulaGravado: '',
        codigoRegla: ''
      },
      imss: defaultImssConfig({ integraIMSS: false })
    };
  }
  return {
    naturaleza: 'gravado',
    integraISR: true,
    integraIMSS: true,
    integraINFONAVIT: false,
    desglose: {
      modo: 'todo_gravado',
      topeExentoUMA: 0,
      topeExentoMonto: 0,
      formulaExento: '',
      formulaGravado: '',
      codigoRegla: ''
    },
    imss: defaultImssConfig({ integraIMSS: true, naturalezaSdi: 'variable' })
  };
}

const IMSS_DESGLOSE_MODOS = [
  { value: 'todo_integra', label: 'Todo integra SBC' },
  { value: 'todo_excluye', label: 'Nada integra (excluido)' },
  { value: 'tope_uma', label: 'Tope no integra (UMAs)' },
  { value: 'tope_monto', label: 'Tope no integra (monto)' },
  { value: 'tope_pct_sbc', label: 'Tope no integra (% SBC)' },
  { value: 'regla_ley', label: 'Regla de ley IMSS' },
  { value: 'formula', label: 'Fórmula integra / no integra' }
];

const NATURALEZA_SDI_OPTS = [
  { value: 'fijo', label: 'Fijo (SDI desde el día 1 / factor)' },
  { value: 'variable', label: 'Variable (promedio bimestre)' },
  { value: 'excluido', label: 'Excluido (no integra SBC)' }
];

module.exports = {
  fiscalSubSchema,
  satSubSchema,
  fiscalDesgloseSubSchema,
  imssDesgloseSubSchema,
  imssSubSchema,
  defaultFiscalFromNaturaleza,
  defaultImssConfig,
  emptyImssDesglose,
  IMSS_DESGLOSE_MODOS,
  NATURALEZA_SDI_OPTS
};

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
    desglose: { type: fiscalDesgloseSubSchema, default: () => ({ modo: 'todo_gravado' }) }
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

function defaultFiscalFromNaturaleza(naturaleza = 'gravado') {
  const n = String(naturaleza || 'gravado').toLowerCase();
  if (n === 'exento') {
    return {
      naturaleza: 'exento',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_exento', topeExentoUMA: 0, topeExentoMonto: 0, formulaExento: '', formulaGravado: '', codigoRegla: '' }
    };
  }
  if (n === 'mixto') {
    return {
      naturaleza: 'mixto',
      integraISR: true,
      integraIMSS: true,
      integraINFONAVIT: false,
      desglose: { modo: 'regla_ley', topeExentoUMA: 0, topeExentoMonto: 0, formulaExento: '', formulaGravado: '', codigoRegla: 'horas_extra' }
    };
  }
  if (n === 'informativo') {
    return {
      naturaleza: 'informativo',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_exento', topeExentoUMA: 0, topeExentoMonto: 0, formulaExento: '', formulaGravado: '', codigoRegla: '' }
    };
  }
  if (n === 'fiscal') {
    return {
      naturaleza: 'fiscal',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado', topeExentoUMA: 0, topeExentoMonto: 0, formulaExento: '', formulaGravado: '', codigoRegla: '' }
    };
  }
  return {
    naturaleza: 'gravado',
    integraISR: true,
    integraIMSS: true,
    integraINFONAVIT: false,
    desglose: { modo: 'todo_gravado', topeExentoUMA: 0, topeExentoMonto: 0, formulaExento: '', formulaGravado: '', codigoRegla: '' }
  };
}

module.exports = {
  fiscalSubSchema,
  satSubSchema,
  fiscalDesgloseSubSchema,
  defaultFiscalFromNaturaleza
};

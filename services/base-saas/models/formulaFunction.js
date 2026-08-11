'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_FORMULA_FUNCTIONS } = require('../config/constants');

/**
 * Catálogo de funciones usables en fórmulas de conceptos (flujo tipo NetSuite).
 * - nativa: implementación fija en código
 * - expresion: cuerpo mathjs
 * - javascript: cuerpo JS restringido (sandbox)
 *
 * estado: borrador (editable, no entra al cálculo) | publicado (activo en scope)
 */
const formulaFunctionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      match: [/^[a-z][a-zA-Z0-9_]*$/, 'Nombre inválido (empieza con minúscula; a-zA-Z0-9_)']
    },
    nameKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    signature: { type: String, trim: true, default: '' },
    descripcion: { type: String, trim: true, default: '' },
    ejemplo: { type: String, trim: true, default: '' },
    tipo: {
      type: String,
      enum: ['nativa', 'expresion', 'javascript'],
      default: 'expresion'
    },
    args: { type: [String], default: [] },
    /** Cuerpo mathjs o JS (según tipo) */
    cuerpo: { type: String, trim: true, default: '' },
    /** Snapshot publicado (si hay borrador distinto) */
    cuerpoPublicado: { type: String, trim: true, default: '' },
    estado: {
      type: String,
      enum: ['borrador', 'publicado'],
      default: 'borrador'
    },
    esSistema: { type: Boolean, default: false },
    activo: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
    ultimaPrueba: {
      ok: { type: Boolean, default: false },
      resultado: { type: mongoose.Schema.Types.Mixed, default: null },
      mensaje: { type: String, default: '' },
      at: { type: Date, default: null }
    },
    tenantId: { type: String, default: null, index: true }
  },
  { timestamps: true, collection: COLLECTION_FORMULA_FUNCTIONS }
);

formulaFunctionSchema.index({ nameKey: 1, tenantId: 1 }, { unique: true });
formulaFunctionSchema.index({ activo: 1, estado: 1, name: 1 });

async function getFormulaFunctionModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.FormulaFunction ||
    conn.model('FormulaFunction', formulaFunctionSchema, COLLECTION_FORMULA_FUNCTIONS)
  );
}

module.exports = getFormulaFunctionModel;

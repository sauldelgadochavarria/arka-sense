'use strict';

const mongoose = require('mongoose');

/**
 * Misma colección que base-saas (nomina_formula_functions).
 * En admin solo se gestionan scripts tipo javascript.
 */
const formulaFunctionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true, trim: true, lowercase: true },
    signature: { type: String, default: '' },
    descripcion: { type: String, default: '' },
    ejemplo: { type: String, default: '' },
    tipo: { type: String, enum: ['nativa', 'expresion', 'javascript'], default: 'javascript' },
    args: { type: [String], default: [] },
    cuerpo: { type: String, default: '' },
    cuerpoPublicado: { type: String, default: '' },
    estado: { type: String, enum: ['borrador', 'publicado'], default: 'borrador' },
    esSistema: { type: Boolean, default: false },
    activo: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
    ultimaPrueba: {
      ok: { type: Boolean, default: false },
      resultado: { type: mongoose.Schema.Types.Mixed, default: null },
      mensaje: { type: String, default: '' },
      at: { type: Date, default: null }
    },
    tenantId: { type: String, default: null }
  },
  { timestamps: true, collection: 'nomina_formula_functions' }
);

formulaFunctionSchema.index({ nameKey: 1, tenantId: 1 }, { unique: true });

module.exports =
  mongoose.models.FormulaFunctionAdmin ||
  mongoose.model('FormulaFunctionAdmin', formulaFunctionSchema);

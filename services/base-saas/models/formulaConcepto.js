const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_NOMINA_FORMULAS } = require('../config/constants');

/**
 * formula_rules — reglas de cálculo.
 * empresaId null = plantilla / default global.
 * empresaId set = override de la empresa.
 */
const formulaConceptoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', default: null, index: true },
    conceptoCodigo: { type: String, required: true, trim: true, uppercase: true },
    tipoPeriodo: {
      type: String,
      enum: ['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'],
      required: true
    },
    tipoNomina: {
      type: String,
      enum: [
        'ordinaria',
        'extraordinaria',
        'finiquito',
        'aguinaldo',
        'ptu',
        'primas',
        'comisiones',
        'indemnizacion',
        'otro'
      ],
      default: 'ordinaria'
    },
    fase: { type: Number, required: true, min: 1, max: 4, default: 1, index: true },
    tipoAplicacion: {
      type: String,
      enum: ['FIJO', 'EVENTUAL'],
      default: 'FIJO'
    },
    vigenciaDesde: { type: Date, required: true },
    vigenciaHasta: { type: Date, default: null },
    condicion: { type: String, trim: true, default: '' },
    formula: { type: String, required: true, trim: true },
    dependencias: { type: [String], default: [] },
    redondeo: { type: Number, default: 2, min: 0, max: 6 },
    version: { type: Number, default: 1 },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_NOMINA_FORMULAS }
);

formulaConceptoSchema.index({
  tenantId: 1,
  empresaId: 1,
  conceptoCodigo: 1,
  tipoPeriodo: 1,
  tipoNomina: 1,
  vigenciaDesde: -1
});

async function getFormulaConceptoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.FormulaConcepto ||
    conn.model('FormulaConcepto', formulaConceptoSchema, COLLECTION_NOMINA_FORMULAS)
  );
}

module.exports = getFormulaConceptoModel;

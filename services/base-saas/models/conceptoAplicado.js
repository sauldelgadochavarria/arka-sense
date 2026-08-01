const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_NOMINA_APLICADOS } = require('../config/constants');

const conceptoAplicadoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    reciboId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReciboNomina', required: true, index: true },
    conceptoCodigo: { type: String, required: true, trim: true, uppercase: true },
    formulaUsada: { type: String, default: '' },
    condicionUsada: { type: String, default: '' },
    variablesUsadas: { type: mongoose.Schema.Types.Mixed, default: {} },
    importe: { type: Number, default: 0 },
    gravado: { type: Number, default: 0 },
    exento: { type: Number, default: 0 },
    desgloseModo: { type: String, default: '' },
    claveSAT: { type: String, default: '' },
    requiereRevision: { type: Boolean, default: false },
    errorCalculo: { type: String, default: '' },
    versionFormula: { type: Number, default: 1 }
  },
  { timestamps: true, collection: COLLECTION_NOMINA_APLICADOS }
);

conceptoAplicadoSchema.index({ reciboId: 1, conceptoCodigo: 1 });
conceptoAplicadoSchema.index({ tenantId: 1, conceptoCodigo: 1 });

async function getConceptoAplicadoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.ConceptoAplicado ||
    conn.model('ConceptoAplicado', conceptoAplicadoSchema, COLLECTION_NOMINA_APLICADOS)
  );
}

module.exports = getConceptoAplicadoModel;

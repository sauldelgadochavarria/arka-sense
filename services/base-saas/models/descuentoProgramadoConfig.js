'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_DESCUENTO_PROGRAMADO_CONFIG } = require('../config/constants');

/**
 * Configuración del módulo de descuentos programados por subsidiaria
 * (subsidiariaId null = default de empresa).
 */
const conceptoConfigSubSchema = new mongoose.Schema(
  {
    conceptoCodigo: { type: String, required: true, trim: true, uppercase: true },
    activo: { type: Boolean, default: true },
    generaSaldo: { type: Boolean, default: true },
    aplicaAutomatico: { type: Boolean, default: true },
    permiteParcial: { type: Boolean, default: true },
    reglas: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
  },
  { _id: false }
);

const descuentoProgramadoConfigSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    /** null = configuración default de la empresa */
    subsidiariaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subsidiaria',
      default: null,
      index: true
    },
    moduloActivo: { type: Boolean, default: false },
    conceptos: { type: [conceptoConfigSubSchema], default: [] },
    notas: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_DESCUENTO_PROGRAMADO_CONFIG }
);

descuentoProgramadoConfigSchema.index(
  { tenantId: 1, empresaId: 1, subsidiariaId: 1 },
  { unique: true }
);

async function getDescuentoProgramadoConfigModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.DescuentoProgramadoConfig ||
    conn.model(
      'DescuentoProgramadoConfig',
      descuentoProgramadoConfigSchema,
      COLLECTION_DESCUENTO_PROGRAMADO_CONFIG
    )
  );
}

module.exports = getDescuentoProgramadoConfigModel;

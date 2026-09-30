'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_CARGA_CFDI_STAGING } = require('../config/constants');

const cargaCfdiStagingSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    jobId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    uuid: { type: String, required: true, trim: true, uppercase: true },
    anio: { type: Number, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    bitacora: { type: [mongoose.Schema.Types.Mixed], default: [] },
    estatus: {
      type: String,
      enum: ['ok', 'omitido', 'error'],
      default: 'ok'
    }
  },
  { timestamps: true, collection: COLLECTION_CARGA_CFDI_STAGING }
);

cargaCfdiStagingSchema.index({ jobId: 1, uuid: 1 }, { unique: true });

async function getCargaCfdiStagingModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.CargaCfdiStaging ||
    conn.model('CargaCfdiStaging', cargaCfdiStagingSchema, COLLECTION_CARGA_CFDI_STAGING)
  );
}

module.exports = getCargaCfdiStagingModel;

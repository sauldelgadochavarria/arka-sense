'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_NOMINA_CFDI_ARCHIVOS } = require('../config/constants');

/**
 * Binarios CFDI (XML / PDF-HTML) fuera del histórico para no inflar listados.
 * Solo se leen en descarga puntual.
 */
const nominaCfdiArchivoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', default: null, index: true },
    periodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PeriodoNomina', default: null, index: true },
    loteId: { type: mongoose.Schema.Types.ObjectId, ref: 'TimbradoLote', default: null, index: true },
    historicoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NominaHistoricoRecibo',
      default: null,
      index: true
    },
    reciboId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReciboNomina', default: null, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', default: null, index: true },
    uuid: { type: String, trim: true, uppercase: true, default: '', index: true },
    tipo: {
      type: String,
      enum: ['xml', 'pdf'],
      required: true,
      index: true
    },
    contentType: { type: String, trim: true, default: 'application/octet-stream' },
    nombreArchivo: { type: String, trim: true, default: '' },
    tamanio: { type: Number, default: 0 },
    sha256: { type: String, trim: true, lowercase: true, default: '' },
    contenido: { type: Buffer, required: true }
  },
  { timestamps: true, collection: COLLECTION_NOMINA_CFDI_ARCHIVOS }
);

nominaCfdiArchivoSchema.index(
  { tenantId: 1, historicoId: 1, tipo: 1 },
  {
    unique: true,
    partialFilterExpression: { historicoId: { $type: 'objectId' } }
  }
);
nominaCfdiArchivoSchema.index(
  { tenantId: 1, reciboId: 1, tipo: 1 },
  {
    unique: true,
    partialFilterExpression: { reciboId: { $type: 'objectId' }, historicoId: null }
  }
);
nominaCfdiArchivoSchema.index({ tenantId: 1, uuid: 1, tipo: 1 });

async function getNominaCfdiArchivoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.NominaCfdiArchivo ||
    conn.model('NominaCfdiArchivo', nominaCfdiArchivoSchema, COLLECTION_NOMINA_CFDI_ARCHIVOS)
  );
}

module.exports = getNominaCfdiArchivoModel;

'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_NOMINA_AUDITORIA } = require('../config/constants');

const ACCIONES_AUDITORIA = [
  'PERIODO_CREAR',
  'PERIODO_VINCULAR_PRENOMINA',
  'PERIODO_CALCULAR',
  'PERIODO_CALCULAR_OK',
  'PERIODO_CALCULAR_ERROR',
  'PERIODO_CERRAR',
  'PERIODO_CERRAR_ERROR',
  'RECIBO_VER',
  'OTRO'
];

const nominaAuditoriaSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    accion: { type: String, required: true, trim: true, uppercase: true },
    entidad: { type: String, default: 'periodo', trim: true },
    entidadId: { type: String, default: '', trim: true, index: true },
    periodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PeriodoNomina', default: null, index: true },
    userId: { type: String, default: '', trim: true, index: true },
    userLabel: { type: String, default: '', trim: true },
    mensaje: { type: String, default: '' },
    detalle: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_NOMINA_AUDITORIA }
);

nominaAuditoriaSchema.index({ tenantId: 1, createdAt: -1 });
nominaAuditoriaSchema.index({ tenantId: 1, periodoId: 1, createdAt: -1 });

async function getNominaAuditoriaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.NominaAuditoria ||
    conn.model('NominaAuditoria', nominaAuditoriaSchema, COLLECTION_NOMINA_AUDITORIA)
  );
}

module.exports = getNominaAuditoriaModel;
module.exports.ACCIONES_AUDITORIA = ACCIONES_AUDITORIA;

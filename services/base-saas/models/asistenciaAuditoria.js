'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_ASISTENCIA_AUDITORIA } = require('../config/constants');

/** Bitácora append-only de marcaciones / jornada (REJL corto plazo). */
const ACCIONES = [
  'MARCACION_CREAR',
  'MARCACION_AJUSTAR',
  'MARCACION_ANULAR',
  'MARCACION_BORRAR_BLOQUEADO',
  'JORNADA_CONSULTAR',
  'OTRO'
];

const asistenciaAuditoriaSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    accion: { type: String, required: true, trim: true, uppercase: true },
    entidad: { type: String, default: 'marcacion', trim: true },
    entidadId: { type: String, default: '', trim: true, index: true },
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empleado',
      default: null,
      index: true
    },
    fechaJornada: { type: Date, default: null, index: true },
    userId: { type: String, default: '', trim: true, index: true },
    userLabel: { type: String, default: '', trim: true },
    mensaje: { type: String, default: '' },
    motivo: { type: String, default: '' },
    antes: { type: mongoose.Schema.Types.Mixed, default: null },
    despues: { type: mongoose.Schema.Types.Mixed, default: null },
    detalle: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_ASISTENCIA_AUDITORIA }
);

asistenciaAuditoriaSchema.index({ tenantId: 1, createdAt: -1 });
asistenciaAuditoriaSchema.index({ tenantId: 1, empleadoId: 1, createdAt: -1 });

async function getAsistenciaAuditoriaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.AsistenciaAuditoria ||
    conn.model('AsistenciaAuditoria', asistenciaAuditoriaSchema, COLLECTION_ASISTENCIA_AUDITORIA)
  );
}

module.exports = getAsistenciaAuditoriaModel;
module.exports.ACCIONES_ASISTENCIA_AUDITORIA = ACCIONES;

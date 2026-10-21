'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_VACACION_SOLICITUDES } = require('../config/constants');

const ESTADOS_VACACION = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

const vacacionSolicitudSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria', default: null },
    supervisorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', default: null, index: true },
    fechaInicio: { type: Date, required: true, index: true },
    fechaFin: { type: Date, required: true },
    /** Días laborables descontables (sin fines de semana / inhábiles según reglas). */
    diasSolicitados: { type: Number, required: true, min: 0 },
    anioSaldo: { type: Number, required: true },
    motivo: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: ESTADOS_VACACION,
      default: 'PENDING',
      index: true
    },
    motivoRechazo: { type: String, default: '', trim: true },
    solicitadoPorUserId: { type: String, default: '' },
    resueltoPorUserId: { type: String, default: '' },
    fechaResolucion: { type: Date },
    /** Incidencia VAC vinculada al aprobar (prenómina / legado). */
    incidenciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incidencia', default: null },
    /** Fechas YMD laborables incluidas en el descuento. */
    diasDetalle: [{ type: String }]
  },
  { timestamps: true, collection: COLLECTION_VACACION_SOLICITUDES }
);

vacacionSolicitudSchema.index({ tenantId: 1, empleadoId: 1, status: 1, fechaInicio: 1 });
vacacionSolicitudSchema.index({ tenantId: 1, supervisorId: 1, status: 1 });

async function getVacacionSolicitudModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.VacacionSolicitud ||
    conn.model('VacacionSolicitud', vacacionSolicitudSchema, COLLECTION_VACACION_SOLICITUDES)
  );
}

module.exports = getVacacionSolicitudModel;
module.exports.ESTADOS_VACACION = ESTADOS_VACACION;

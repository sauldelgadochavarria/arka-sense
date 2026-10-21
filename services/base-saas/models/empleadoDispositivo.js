'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');

/**
 * Dispositivo móvil confiable del empleado (registro tipo WhatsApp + UUID estable).
 */
const empleadoDispositivoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empleado',
      required: true,
      index: true
    },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria', default: null },
    /** UUID persistente generado por la app (no es IMEI). */
    deviceUuid: { type: String, required: true, trim: true, index: true },
    telefono: { type: String, default: '', trim: true },
    plataforma: { type: String, default: '' },
    modelo: { type: String, default: '' },
    appVersion: { type: String, default: '' },
    activo: { type: Boolean, default: true, index: true },
    verificadoEn: { type: Date, default: null },
    ultimoUsoAt: { type: Date, default: null },
    notas: { type: String, default: '' }
  },
  { timestamps: true, collection: 'empleado_dispositivos' }
);

empleadoDispositivoSchema.index(
  { tenantId: 1, empleadoId: 1, deviceUuid: 1 },
  { unique: true }
);

async function getEmpleadoDispositivoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.EmpleadoDispositivo ||
    conn.model('EmpleadoDispositivo', empleadoDispositivoSchema, 'empleado_dispositivos')
  );
}

module.exports = getEmpleadoDispositivoModel;

'use strict';

/**
 * Asignación temporal empleado ↔ punto de acceso (rotación programada).
 * Preparado para turnos semanales/diarios; el validador ya lo consulta.
 */

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_ASIGNACIONES_PUNTO_ACCESO } = require('../config/constants');

const asignacionPuntoAccesoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empleado',
      required: true,
      index: true
    },
    puntoAccesoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PuntoAcceso',
      required: true,
      index: true
    },
    validFrom: { type: Date, required: true },
    /** null = sin fin (vigente indefinidamente desde validFrom) */
    validTo: { type: Date, default: null },
    notas: { type: String, trim: true, default: '' },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_ASIGNACIONES_PUNTO_ACCESO }
);

asignacionPuntoAccesoSchema.index({ tenantId: 1, empleadoId: 1, validFrom: 1, validTo: 1 });

async function getAsignacionPuntoAccesoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.AsignacionPuntoAcceso ||
    conn.model(
      'AsignacionPuntoAcceso',
      asignacionPuntoAccesoSchema,
      COLLECTION_ASIGNACIONES_PUNTO_ACCESO
    )
  );
}

module.exports = getAsignacionPuntoAccesoModel;

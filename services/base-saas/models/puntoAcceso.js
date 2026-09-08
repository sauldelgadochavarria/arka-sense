'use strict';

/**
 * Catálogo de puntos de acceso / geocercas (POI).
 * Independiente de la subsidiaria fiscal; puede vincularse opcionalmente.
 */

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_PUNTOS_ACCESO } = require('../config/constants');

const puntoAccesoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    subsidiariaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subsidiaria',
      default: null,
      index: true
    },
    codigo: { type: String, trim: true, uppercase: true, default: '' },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true, default: '' },
    /** Coordenadas del centro de la geocerca */
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    /** Radio en metros (80–150 típico en interiores) */
    radioMetros: { type: Number, required: true, min: 10, max: 5000, default: 120 },
    /**
     * GeoJSON Point [lng, lat] para $near / $geoWithin futuros.
     * Se sincroniza en pre-save desde lat/lng.
     */
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: undefined }
    },
    activo: { type: Boolean, default: true, index: true }
  },
  { timestamps: true, collection: COLLECTION_PUNTOS_ACCESO }
);

puntoAccesoSchema.index({ tenantId: 1, nombre: 1 });
puntoAccesoSchema.index({ tenantId: 1, codigo: 1 }, {
  unique: true,
  partialFilterExpression: { codigo: { $type: 'string', $ne: '' } }
});
puntoAccesoSchema.index({ location: '2dsphere' });

puntoAccesoSchema.pre('validate', function syncGeo(next) {
  if (typeof this.lat === 'number' && typeof this.lng === 'number') {
    this.location = {
      type: 'Point',
      coordinates: [this.lng, this.lat]
    };
  }
  next();
});

async function getPuntoAccesoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.PuntoAcceso ||
    conn.model('PuntoAcceso', puntoAccesoSchema, COLLECTION_PUNTOS_ACCESO)
  );
}

module.exports = getPuntoAccesoModel;

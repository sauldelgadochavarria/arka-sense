'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_RECIBO_PDF_PLANTILLAS } = require('../config/constants');

/**
 * Plantilla HTML de recibo PDF, vinculada a tipo de período y opcionalmente a RFC emisor.
 * Varios formatos por RFC / razón social sin hardcode.
 */
const reciboPdfPlantillaSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    codigo: { type: String, required: true, trim: true, uppercase: true },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true, default: '' },
    /** Si null → aplica a todos los tipos de período */
    tipoPeriodoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TipoPeriodoNomina',
      default: null,
      index: true
    },
    /** RFC emisor para multi-empresa / varios formatos (vacío = default) */
    rfcEmisor: { type: String, trim: true, uppercase: true, default: '' },
    razonSocialEmisor: { type: String, trim: true, default: '' },
    /** HTML con placeholders {{empleado.nombre}}, {{recibo.neto}}, {{#conceptos}}…{{/conceptos}} */
    plantillaHtml: { type: String, required: true, default: '' },
    cssExtra: { type: String, default: '' },
    activo: { type: Boolean, default: true },
    esDefault: { type: Boolean, default: false },
    orden: { type: Number, default: 100 }
  },
  { timestamps: true, collection: COLLECTION_RECIBO_PDF_PLANTILLAS }
);

reciboPdfPlantillaSchema.index({ tenantId: 1, empresaId: 1, codigo: 1 }, { unique: true });
reciboPdfPlantillaSchema.index({ tenantId: 1, tipoPeriodoId: 1, rfcEmisor: 1, activo: 1 });

async function getReciboPdfPlantillaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.ReciboPdfPlantilla ||
    conn.model('ReciboPdfPlantilla', reciboPdfPlantillaSchema, COLLECTION_RECIBO_PDF_PLANTILLAS)
  );
}

module.exports = getReciboPdfPlantillaModel;

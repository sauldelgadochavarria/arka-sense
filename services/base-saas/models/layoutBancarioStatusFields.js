'use strict';

const mongoose = require('mongoose');

/**
 * Subdocumento reutilizable: estatus de dispersión / layout bancario.
 */
function layoutBancarioStatusFields() {
  return {
    /** pendiente | generado */
    estatus: {
      type: String,
      enum: ['pendiente', 'generado'],
      default: 'pendiente'
    },
    layoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'LayoutBancario', default: null },
    layoutCodigo: { type: String, trim: true, default: '' },
    layoutNombre: { type: String, trim: true, default: '' },
    fechaPago: { type: Date, default: null },
    fechaGeneracion: { type: Date, default: null },
    archivoNombre: { type: String, trim: true, default: '' },
    cantidadRecibos: { type: Number, default: 0 },
    totalPagar: { type: Number, default: 0 },
    generadoPorUserId: { type: String, default: '' },
    generadoPorLabel: { type: String, default: '' }
  };
}

module.exports = { layoutBancarioStatusFields };

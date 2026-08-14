'use strict';

const mongoose = require('mongoose');

/** Estatus de timbrado CFDI en recibo / histórico / lote. */
function timbradoStatusFields() {
  return {
    estatus: {
      type: String,
      enum: ['pendiente', 'en_proceso', 'timbrado', 'error', 'cancelado', 'omitido'],
      default: 'pendiente'
    },
    loteId: { type: mongoose.Schema.Types.ObjectId, ref: 'TimbradoLote', default: null },
    pacConfigId: { type: mongoose.Schema.Types.ObjectId, ref: 'PacConfig', default: null },
    uuid: { type: String, trim: true, default: '' },
    serie: { type: String, trim: true, default: '' },
    folio: { type: String, trim: true, default: '' },
    fechaTimbrado: { type: Date, default: null },
    xmlNombre: { type: String, trim: true, default: '' },
    pdfNombre: { type: String, trim: true, default: '' },
    /** Refs a `nomina_cfdi_archivos` (BinData aparte del histórico). */
    archivoXmlId: { type: mongoose.Schema.Types.ObjectId, ref: 'NominaCfdiArchivo', default: null },
    archivoPdfId: { type: mongoose.Schema.Types.ObjectId, ref: 'NominaCfdiArchivo', default: null },
    errorMensaje: { type: String, trim: true, default: '' },
    intentos: { type: Number, default: 0 },
    modo: { type: String, enum: ['simulacion', 'real', ''], default: '' }
  };
}

module.exports = { timbradoStatusFields };

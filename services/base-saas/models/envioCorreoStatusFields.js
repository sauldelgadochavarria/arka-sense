'use strict';

/** Estatus de envío de recibo CFDI por correo (recibo / histórico). */
function envioCorreoReciboFields() {
  return {
    estatus: {
      type: String,
      enum: ['pendiente', 'enviado', 'error', 'omitido'],
      default: 'pendiente'
    },
    destinatario: { type: String, trim: true, lowercase: true, default: '' },
    enviadoAt: { type: Date, default: null },
    enviadoPorUserId: { type: String, default: '' },
    enviadoPorLabel: { type: String, default: '' },
    intentos: { type: Number, default: 0 },
    errorMensaje: { type: String, trim: true, default: '' },
    modo: { type: String, enum: ['simulacion', 'real', ''], default: '' }
  };
}

/** Resumen de envío a nivel período. */
function envioCorreoPeriodoFields() {
  return {
    estatus: {
      type: String,
      enum: ['pendiente', 'enviado', 'parcial', 'error'],
      default: 'pendiente'
    },
    enviadoAt: { type: Date, default: null },
    ultimoAlcance: { type: String, enum: ['', 'pendientes', 'todos'], default: '' },
    enviados: { type: Number, default: 0 },
    errores: { type: Number, default: 0 },
    omitidos: { type: Number, default: 0 },
    pendientes: { type: Number, default: 0 },
    enviadoPorUserId: { type: String, default: '' },
    enviadoPorLabel: { type: String, default: '' },
    modo: { type: String, enum: ['simulacion', 'real', ''], default: '' }
  };
}

module.exports = { envioCorreoReciboFields, envioCorreoPeriodoFields };

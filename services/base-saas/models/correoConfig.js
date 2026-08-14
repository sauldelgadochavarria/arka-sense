'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_CORREO_CONFIGS } = require('../config/constants');

const correoConfigSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    codigo: { type: String, required: true, trim: true, uppercase: true },
    nombre: { type: String, required: true, trim: true },
    proveedor: {
      type: String,
      enum: ['simulacion', 'smtp', 'gmail', 'office365', 'sendgrid', 'mailgun', 'amazon_ses'],
      default: 'smtp'
    },
    activo: { type: Boolean, default: true },
    esDefault: { type: Boolean, default: false, index: true },
    fromNombre: { type: String, trim: true, default: '' },
    fromEmail: { type: String, trim: true, lowercase: true, default: '' },
    replyTo: { type: String, trim: true, lowercase: true, default: '' },
    host: { type: String, trim: true, default: '' },
    port: { type: Number, default: 587 },
    seguridad: {
      type: String,
      enum: ['starttls', 'ssl', 'ninguna'],
      default: 'starttls'
    },
    usuario: { type: String, trim: true, default: '' },
    password: { type: String, default: '' },
    notas: { type: String, trim: true, default: '' },
    ultimaPruebaAt: { type: Date, default: null },
    ultimaPruebaOk: { type: Boolean, default: null },
    ultimaPruebaError: { type: String, default: '' },
    ultimaFechaUso: { type: Date, default: null },
    totalEnviados: { type: Number, default: 0 }
  },
  { timestamps: true, collection: COLLECTION_CORREO_CONFIGS }
);

correoConfigSchema.index({ tenantId: 1, empresaId: 1, codigo: 1 }, { unique: true });
correoConfigSchema.index({ tenantId: 1, empresaId: 1, esDefault: 1 });

async function getCorreoConfigModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.CorreoConfig || conn.model('CorreoConfig', correoConfigSchema, COLLECTION_CORREO_CONFIGS)
  );
}

module.exports = getCorreoConfigModel;

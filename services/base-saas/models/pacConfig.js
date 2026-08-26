'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_PAC_CONFIGS } = require('../config/constants');

/**
 * Configuración PAC (Proveedor Autorizado de Certificación).
 * Compatible con campos legado pac_* (SW Sapien / similares).
 */
const pacConfigSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    subsidiariaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subsidiaria',
      default: null,
      index: true
    },
    /** Código amigable (ej. SW-PROD, SW-TEST) */
    codigo: { type: String, required: true, trim: true, uppercase: true },
    nombre: { type: String, required: true, trim: true },
    /** T = activo (legado pac_activo) */
    activo: { type: Boolean, default: true },
    /**
     * Ambiente legado: "1" producción, "0"/otro prueba.
     * También acepta prod | test.
     */
    ambiente: { type: String, trim: true, default: '1' },
    proveedor: { type: String, trim: true, default: 'SW Sapien' },
    formato: {
      type: String,
      enum: ['JSON', 'XML'],
      default: 'JSON'
    },
    /** pac_layout: generar layout/XML local antes de enviar */
    generarLayout: { type: Boolean, default: true },
    usuario: { type: String, trim: true, default: '' },
    /** Guardado en claro por compat legado; no exponer en logs */
    password: { type: String, default: '' },
    urlAuth: { type: String, trim: true, default: '' },
    urlTimbrado: { type: String, trim: true, default: '' },
    /** URL emisión/timbrado XML (multipart). Si vacío se deriva de urlTimbrado. */
    urlTimbradoXml: { type: String, trim: true, default: '' },
    urlCancelacion: { type: String, trim: true, default: '' },
    urlConsulta: { type: String, trim: true, default: '' },
    timeout: { type: Number, default: 30, min: 5, max: 300 },
    reintentos: { type: Number, default: 3, min: 0, max: 10 },
    emailErrores: { type: String, trim: true, default: '' },
    carpetaXml: { type: String, trim: true, default: '' },
    serieDefault: { type: String, trim: true, uppercase: true, default: '' },
    /** Templates del PAC (IDs legado) */
    templateIngreso: { type: String, trim: true, default: '' },
    templateEgreso: { type: String, trim: true, default: '' },
    templatePago: { type: String, trim: true, default: '' },
    templateTraslado: { type: String, trim: true, default: '' },
    /** Datos de prueba SAT */
    rfcSatTest: { type: String, trim: true, uppercase: true, default: '' },
    nombreSatTest: { type: String, trim: true, default: '' },
    notas: { type: String, trim: true, default: '' },
    totalTimbrados: { type: Number, default: 0, min: 0 },
    ultimaFechaUso: { type: Date, default: null },
    /**
     * false = solo arma lote / valida / simula (no llama al PAC).
     * true = intenta autenticar y timbrar vía HTTP.
     */
    modoReal: { type: Boolean, default: false }
  },
  { timestamps: true, collection: COLLECTION_PAC_CONFIGS }
);

pacConfigSchema.index({ tenantId: 1, empresaId: 1, codigo: 1 }, { unique: true });
pacConfigSchema.index({ tenantId: 1, empresaId: 1, activo: 1 });

async function getPacConfigModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.PacConfig || conn.model('PacConfig', pacConfigSchema, COLLECTION_PAC_CONFIGS);
}

module.exports = getPacConfigModel;

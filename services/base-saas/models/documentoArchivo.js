'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_DOCUMENTOS_ARCHIVO } = require('../config/constants');

/**
 * Índice documental: metadatos en Mongo; binario en carpeta local o bucket S3.
 */
const documentoArchivoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    /** Código del catálogo TIPOS_DOCUMENTO */
    tipoCodigo: { type: String, required: true, trim: true, uppercase: true, index: true },
    ambito: { type: String, enum: ['periodo', 'mes', 'empleado'], required: true, index: true },
    anio: { type: Number, default: null, index: true },
    mes: { type: Number, default: null, min: 1, max: 12, index: true },
    periodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PeriodoNomina', default: null, index: true },
    periodoLabel: { type: String, trim: true, default: '' },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', default: null, index: true },
    numEmpleado: { type: String, trim: true, default: '' },
    empleadoNombre: { type: String, trim: true, default: '' },
    /** Ruta relativa lógica (sin root/bucket). */
    storageKey: { type: String, required: true, trim: true },
    nombreOriginal: { type: String, trim: true, default: '' },
    contentType: { type: String, trim: true, default: 'application/octet-stream' },
    extension: { type: String, trim: true, default: '' },
    tamanio: { type: Number, default: 0 },
    sha256: { type: String, trim: true, default: '' },
    proveedor: { type: String, enum: ['local', 's3'], default: 'local' },
    vigenteDesde: { type: Date, default: null },
    vigenteHasta: { type: Date, default: null },
    notas: { type: String, trim: true, default: '' },
    origen: {
      type: String,
      enum: ['upload', 'timbrado', 'sua', 'layout', 'reindex', 'sistema'],
      default: 'upload'
    },
    /** Si versionado: apunta al documento reemplazado. */
    reemplazaId: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentoArchivo', default: null },
    version: { type: Number, default: 1 },
    activo: { type: Boolean, default: true, index: true },
    uploadedByUserId: { type: String, trim: true, default: '' },
    uploadedByLabel: { type: String, trim: true, default: '' }
  },
  { timestamps: true, collection: COLLECTION_DOCUMENTOS_ARCHIVO }
);

documentoArchivoSchema.index({ tenantId: 1, empresaId: 1, tipoCodigo: 1, anio: 1, mes: 1 });
documentoArchivoSchema.index({ tenantId: 1, empleadoId: 1, tipoCodigo: 1, activo: 1 });
documentoArchivoSchema.index({ tenantId: 1, periodoId: 1, tipoCodigo: 1, activo: 1 });
documentoArchivoSchema.index({ tenantId: 1, storageKey: 1 }, { unique: true });

async function getDocumentoArchivoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.DocumentoArchivo ||
    conn.model('DocumentoArchivo', documentoArchivoSchema, COLLECTION_DOCUMENTOS_ARCHIVO)
  );
}

module.exports = getDocumentoArchivoModel;

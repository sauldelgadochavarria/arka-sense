'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_GESTION_DOCUMENTAL_CONFIG } = require('../config/constants');

/**
 * Configuración de almacenamiento documental por empresa.
 * local = carpeta en disco; s3 = Linode Object Storage / AWS / MinIO.
 */
const gestionDocumentalConfigSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    activo: { type: Boolean, default: true },
    /** local | s3 */
    proveedor: { type: String, enum: ['local', 's3'], default: 'local' },
    /** Prefijo lógico de la empresa en el árbol (ej. Ingenios_XYZ). */
    empresaSlug: { type: String, trim: true, default: '' },
    local: {
      /** Raíz absoluta o relativa al cwd del contenedor. */
      rootPath: { type: String, trim: true, default: '/data/documentos' },
      crearSubcarpetas: { type: Boolean, default: true }
    },
    s3: {
      endpoint: { type: String, trim: true, default: 'https://us-east-1.linodeobjects.com' },
      region: { type: String, trim: true, default: 'us-east-1' },
      bucket: { type: String, trim: true, default: '' },
      accessKeyId: { type: String, trim: true, default: '' },
      secretAccessKey: { type: String, trim: true, default: '' },
      forcePathStyle: { type: Boolean, default: true },
      /** Prefijo dentro del bucket (opcional). */
      prefix: { type: String, trim: true, default: '' }
    },
    /** Conservar versiones al reemplazar un documento. */
    versionado: { type: Boolean, default: true },
    /** Días de aviso antes de vencimiento (INE, contrato…). */
    diasAvisoVencimiento: { type: Number, default: 30, min: 0 },
    notas: { type: String, trim: true, default: '' },
    updatedByUserId: { type: String, trim: true, default: '' },
    updatedByLabel: { type: String, trim: true, default: '' }
  },
  { timestamps: true, collection: COLLECTION_GESTION_DOCUMENTAL_CONFIG }
);

gestionDocumentalConfigSchema.index({ tenantId: 1, empresaId: 1 }, { unique: true });

async function getGestionDocumentalConfigModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.GestionDocumentalConfig ||
    conn.model('GestionDocumentalConfig', gestionDocumentalConfigSchema, COLLECTION_GESTION_DOCUMENTAL_CONFIG)
  );
}

module.exports = getGestionDocumentalConfigModel;

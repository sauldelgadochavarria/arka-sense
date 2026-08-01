const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_TIPOS_MOVIMIENTO_LABORAL } = require('../config/constants');

const tipoMovimientoLaboralSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    codigo: { type: String, required: true, trim: true, uppercase: true },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true, default: '' },
    claveLegado: { type: Number, default: null },
    afectaSalario: { type: Boolean, default: false },
    afectaOrganizacion: { type: Boolean, default: false },
    afectaEstatus: { type: Boolean, default: false },
    orden: { type: Number, default: 100 },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_TIPOS_MOVIMIENTO_LABORAL }
);

tipoMovimientoLaboralSchema.index({ tenantId: 1, codigo: 1 }, { unique: true });

async function getTipoMovimientoLaboralModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.TipoMovimientoLaboral ||
    conn.model('TipoMovimientoLaboral', tipoMovimientoLaboralSchema, COLLECTION_TIPOS_MOVIMIENTO_LABORAL)
  );
}

module.exports = getTipoMovimientoLaboralModel;

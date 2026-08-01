const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_VACACION_SALDOS } = require('../config/constants');

const vacacionSaldoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true },
    anio: { type: Number, required: true },
    diasCorresponden: { type: Number, default: 0, min: 0 },
    diasTomados: { type: Number, default: 0, min: 0 },
    diasPendientes: { type: Number, default: 0, min: 0 },
    primaVacacionalPct: { type: Number, default: 25 }
  },
  { timestamps: true, collection: COLLECTION_VACACION_SALDOS }
);

vacacionSaldoSchema.index({ tenantId: 1, empleadoId: 1, anio: 1 }, { unique: true });

async function getVacacionSaldoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.VacacionSaldo ||
    conn.model('VacacionSaldo', vacacionSaldoSchema, COLLECTION_VACACION_SALDOS)
  );
}

module.exports = getVacacionSaldoModel;

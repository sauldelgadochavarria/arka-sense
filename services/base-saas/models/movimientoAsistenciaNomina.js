const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_MOVIMIENTOS_ASISTENCIA_NOMINA } = require('../config/constants');

const movimientoAsistenciaNominaSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', default: null, index: true },
    payrollPeriodId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollPeriod', default: null },
    periodoNominaId: { type: mongoose.Schema.Types.ObjectId, ref: 'PeriodoNomina', default: null },
    conceptoClave: { type: String, trim: true, default: '' },
    tipoMovimiento: { type: String, trim: true, default: '' },
    monto: { type: Number, default: 0 },
    fechaMovimiento: { type: Date, default: null, index: true },
    fechaNomina: { type: Date, default: null },
    referencia: { type: String, trim: true, default: '' },
    origenMovimiento: { type: String, trim: true, default: 'asistencia' },
    claTrab: { type: String, trim: true, default: '' },
    claPerded: { type: String, trim: true, default: '' },
    folioAuto: { type: Number, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, collection: COLLECTION_MOVIMIENTOS_ASISTENCIA_NOMINA }
);

movimientoAsistenciaNominaSchema.index({ tenantId: 1, empresaId: 1, fechaMovimiento: -1 });
movimientoAsistenciaNominaSchema.index(
  { tenantId: 1, folioAuto: 1, claPerded: 1 },
  { unique: true, sparse: true }
);

async function getMovimientoAsistenciaNominaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.MovimientoAsistenciaNomina ||
    conn.model(
      'MovimientoAsistenciaNomina',
      movimientoAsistenciaNominaSchema,
      COLLECTION_MOVIMIENTOS_ASISTENCIA_NOMINA
    )
  );
}

module.exports = getMovimientoAsistenciaNominaModel;


const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_HISTORIAL_LABORAL } = require('../config/constants');

const snapshotSchema = new mongoose.Schema(
  {
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria', default: null },
    departamentoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Departamento', default: null },
    puestoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Puesto', default: null },
    salarioDiario: { type: Number, default: null },
    salarioSemanal: { type: Number, default: null },
    salarioMensual: { type: Number, default: null },
    sueldoIntegrado: { type: Number, default: null },
    tipoContrato: { type: String, trim: true, default: '' },
    tipoSalario: { type: String, trim: true, default: '' },
    estatus: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

const historialLaboralSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    tipoMovimientoCodigo: { type: String, required: true, trim: true, uppercase: true },
    fechaMovimiento: { type: Date, required: true, index: true },
    folio: { type: Number, default: null },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria', default: null },
    departamentoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Departamento', default: null },
    puestoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Puesto', default: null },
    salarioDiario: { type: Number, default: null },
    salarioSemanal: { type: Number, default: null },
    salarioMensual: { type: Number, default: null },
    sueldoIntegrado: { type: Number, default: null },
    tipoContrato: { type: String, trim: true, default: '' },
    tipoSalario: { type: String, trim: true, default: '' },
    estatus: { type: String, trim: true, default: '' },
    diasContrato: { type: Number, default: null },
    terminoContrato: { type: Number, default: null },
    observaciones: { type: String, trim: true, default: '' },
    anterior: { type: snapshotSchema, default: () => ({}) },
    origen: {
      type: String,
      enum: ['sistema', 'manual', 'importacion'],
      default: 'sistema'
    },
    registradoPor: { type: String, trim: true, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, collection: COLLECTION_HISTORIAL_LABORAL }
);

historialLaboralSchema.index({ tenantId: 1, empleadoId: 1, fechaMovimiento: -1 });
historialLaboralSchema.index({ tenantId: 1, folio: -1 });

async function getHistorialLaboralModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.HistorialLaboral ||
    conn.model('HistorialLaboral', historialLaboralSchema, COLLECTION_HISTORIAL_LABORAL)
  );
}

module.exports = getHistorialLaboralModel;

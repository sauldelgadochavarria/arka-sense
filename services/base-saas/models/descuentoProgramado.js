'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_DESCUENTOS_PROGRAMADOS } = require('../config/constants');

const ESTATUS_DESCUENTO = ['activo', 'suspendido', 'cancelado', 'liquidado'];
const MODALIDADES = ['monto_fijo', 'porcentaje', 'liquidacion', 'monto_variable'];
const PERIODICIDADES = ['cada_periodo', 'quincenal', 'semanal', 'mensual', 'unica'];

const descuentoProgramadoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    subsidiariaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subsidiaria',
      default: null,
      index: true
    },
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empleado',
      required: true,
      index: true
    },
    conceptoCodigo: { type: String, required: true, trim: true, uppercase: true, index: true },
    fechaInicio: { type: Date, required: true },
    fechaTermino: { type: Date, default: null },
    montoOriginal: { type: Number, default: 0 },
    saldoPendiente: { type: Number, default: 0 },
    importePorPeriodo: { type: Number, default: 0 },
    modalidad: {
      type: String,
      enum: MODALIDADES,
      default: 'monto_fijo'
    },
    /** Para modalidad porcentaje: % sobre base (sueldo del periodo / sujeto). */
    porcentaje: { type: Number, default: 0 },
    basePorcentaje: {
      type: String,
      enum: ['sueldo_periodo', 'percepciones_gravadas', 'neto_provisional'],
      default: 'sueldo_periodo'
    },
    /** Importe manual para monto_variable (opcional, se puede fijar en proceso). */
    importeVariable: { type: Number, default: null },
    periodicidad: {
      type: String,
      enum: PERIODICIDADES,
      default: 'cada_periodo'
    },
    numeroPagos: { type: Number, default: null },
    pagosAplicados: { type: Number, default: 0 },
    estatus: {
      type: String,
      enum: ESTATUS_DESCUENTO,
      default: 'activo',
      index: true
    },
    observaciones: { type: String, default: '' },
    creadoPor: { type: String, default: '' },
    creadoPorLabel: { type: String, default: '' },
    modificadoPor: { type: String, default: '' },
    modificadoPorLabel: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
  },
  { timestamps: true, collection: COLLECTION_DESCUENTOS_PROGRAMADOS }
);

descuentoProgramadoSchema.index({ tenantId: 1, empleadoId: 1, estatus: 1 });
descuentoProgramadoSchema.index({ tenantId: 1, conceptoCodigo: 1, estatus: 1 });
descuentoProgramadoSchema.index({ tenantId: 1, subsidiariaId: 1, estatus: 1 });

async function getDescuentoProgramadoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.DescuentoProgramado ||
    conn.model('DescuentoProgramado', descuentoProgramadoSchema, COLLECTION_DESCUENTOS_PROGRAMADOS)
  );
}

module.exports = getDescuentoProgramadoModel;
module.exports.ESTATUS_DESCUENTO = ESTATUS_DESCUENTO;
module.exports.MODALIDADES = MODALIDADES;
module.exports.PERIODICIDADES = PERIODICIDADES;

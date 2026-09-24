'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_DESCUENTO_PROGRAMADO_MOVIMIENTOS } = require('../config/constants');

const TIPOS_MOVIMIENTO = [
  'ALTA',
  'MODIFICACION',
  'SUSPENSION',
  'REACTIVACION',
  'CANCELACION',
  'APLICACION',
  'APLICACION_PARCIAL',
  'AJUSTE_SALDO',
  'REVERSION'
];

const descuentoProgramadoMovimientoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    descuentoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DescuentoProgramado',
      required: true,
      index: true
    },
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empleado',
      default: null,
      index: true
    },
    conceptoCodigo: { type: String, trim: true, uppercase: true, default: '' },
    tipo: {
      type: String,
      enum: TIPOS_MOVIMIENTO,
      required: true,
      index: true
    },
    periodoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PeriodoNomina',
      default: null,
      index: true
    },
    /** Denormalizado para historial (evita join en UI). */
    numeroPeriodo: { type: Number, default: null },
    reciboId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ReciboNomina',
      default: null
    },
    importeSolicitado: { type: Number, default: 0 },
    importeAplicado: { type: Number, default: 0 },
    saldoAnterior: { type: Number, default: null },
    saldoPosterior: { type: Number, default: null },
    usuarioId: { type: String, default: '' },
    usuarioLabel: { type: String, default: '' },
    valoresAnteriores: { type: mongoose.Schema.Types.Mixed, default: null },
    valoresNuevos: { type: mongoose.Schema.Types.Mixed, default: null },
    mensaje: { type: String, default: '' },
    detalle: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
  },
  { timestamps: true, collection: COLLECTION_DESCUENTO_PROGRAMADO_MOVIMIENTOS }
);

descuentoProgramadoMovimientoSchema.index({ tenantId: 1, createdAt: -1 });
descuentoProgramadoMovimientoSchema.index({ tenantId: 1, periodoId: 1, tipo: 1 });

async function getDescuentoProgramadoMovimientoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.DescuentoProgramadoMovimiento ||
    conn.model(
      'DescuentoProgramadoMovimiento',
      descuentoProgramadoMovimientoSchema,
      COLLECTION_DESCUENTO_PROGRAMADO_MOVIMIENTOS
    )
  );
}

module.exports = getDescuentoProgramadoMovimientoModel;
module.exports.TIPOS_MOVIMIENTO = TIPOS_MOVIMIENTO;

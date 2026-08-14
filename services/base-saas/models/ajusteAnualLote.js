'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_AJUSTE_ANUAL_LOTES } = require('../config/constants');
const { ESTATUS_LOTE } = require('../config/ajusteAnualCatalog');

const autorizacionSchema = new mongoose.Schema(
  {
    etapa: { type: String, required: true, trim: true },
    nombre: { type: String, default: '' },
    estatus: {
      type: String,
      enum: ['pendiente', 'autorizado', 'rechazado'],
      default: 'pendiente'
    },
    userId: { type: String, default: '' },
    userLabel: { type: String, default: '' },
    fecha: { type: Date, default: null },
    comentario: { type: String, default: '' }
  },
  { _id: false }
);

const itemSchema = new mongoose.Schema(
  {
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true },
    numEmpleado: { type: String, default: '' },
    nombre: { type: String, default: '' },
    departamentoNombre: { type: String, default: '' },
    puestoNombre: { type: String, default: '' },
    tipoEmpleado: { type: String, default: '' },
    tipoSalario: { type: String, default: '' },
    desempeno: { type: Number, default: null },
    compaRatio: { type: Number, default: null },
    porcentaje: { type: Number, default: 0 },
    salarioDiarioAntes: { type: Number, default: 0 },
    salarioDiarioDespues: { type: Number, default: 0 },
    sdiAntes: { type: Number, default: 0 },
    sdiDespues: { type: Number, default: 0 },
    sbcAntes: { type: Number, default: 0 },
    sbcDespues: { type: Number, default: 0 },
    pisoSm: { type: Boolean, default: false },
    topeSbc: { type: Boolean, default: false },
    omitido: { type: Boolean, default: false },
    omitidoMotivo: { type: String, default: '' },
    alertas: { type: [String], default: [] }
  },
  { _id: true }
);

const ajusteAnualLoteSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    nombre: { type: String, trim: true, default: '' },
    proposito: {
      type: String,
      enum: ['inflacion', 'mercado', 'retencion', 'combinacion'],
      default: 'inflacion'
    },
    modo: {
      type: String,
      enum: ['porcentaje', 'presupuesto', 'matriz', 'carga_empleado'],
      default: 'porcentaje'
    },
    vigenciaDesde: { type: Date, default: null },
    vigenciaHasta: { type: Date, default: null },
    fechaAplicacion: { type: Date, default: null },
    retroactivo: { type: Boolean, default: false },
    fechaRetroactiva: { type: Date, default: null },
    filtros: { type: mongoose.Schema.Types.Mixed, default: {} },
    regla: { type: mongoose.Schema.Types.Mixed, default: {} },
    parametrosFiscales: {
      uma: { type: Number, default: 0 },
      salarioMinimo: { type: Number, default: 0 },
      topeUmaImss: { type: Number, default: 25 },
      topeSbc: { type: Number, default: 0 }
    },
    totales: { type: mongoose.Schema.Types.Mixed, default: {} },
    autorizaciones: { type: [autorizacionSchema], default: [] },
    items: { type: [itemSchema], default: [] },
    estatus: {
      type: String,
      enum: ESTATUS_LOTE,
      default: 'borrador',
      index: true
    },
    aplicadoAt: { type: Date, default: null },
    aplicadoPorUserId: { type: String, default: '' },
    aplicadoPorLabel: { type: String, default: '' },
    creadoPorUserId: { type: String, default: '' },
    creadoPorLabel: { type: String, default: '' },
    notas: { type: String, default: '' },
    errorMensaje: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_AJUSTE_ANUAL_LOTES }
);

ajusteAnualLoteSchema.index({ tenantId: 1, empresaId: 1, createdAt: -1 });

async function getAjusteAnualLoteModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.AjusteAnualLote ||
    conn.model('AjusteAnualLote', ajusteAnualLoteSchema, COLLECTION_AJUSTE_ANUAL_LOTES)
  );
}

module.exports = getAjusteAnualLoteModel;

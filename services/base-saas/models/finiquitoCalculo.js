'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_FINIQUITO_CALCULOS } = require('../config/constants');

const conceptoSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, trim: true, uppercase: true },
    descripcion: { type: String, default: '' },
    origen: { type: String, default: 'LEY' },
    tipo: { type: String, enum: ['percepcion', 'deduccion'], default: 'percepcion' },
    tipoFiscal: { type: String, enum: ['ORDINARIO', 'SEPARACION'], default: 'ORDINARIO' },
    grupo: { type: String, default: 'finiquito' },
    claveSAT: { type: String, default: '' },
    aplicaExencion90Uma: { type: Boolean, default: false },
    aplica: { type: Boolean, default: true },
    base: { type: Number, default: 0 },
    unidades: { type: Number, default: 0 },
    tasa: { type: Number, default: 1 },
    importeLegal: { type: Number, default: 0 },
    ajuste: { type: Number, default: 0 },
    importeFinal: { type: Number, default: 0 },
    gravadoISR: { type: Number, default: 0 },
    exentoISR: { type: Number, default: 0 },
    isrEstimado: { type: Number, default: null },
    reglaFiscal: { type: String, default: '' },
    integraSBC: { type: Boolean, default: false },
    detalle: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { _id: false }
);

const auditoriaSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    userId: { type: String, default: '' },
    userLabel: { type: String, default: '' },
    campo: { type: String, default: '' },
    valorAnterior: { type: mongoose.Schema.Types.Mixed },
    valorNuevo: { type: mongoose.Schema.Types.Mixed },
    motivo: { type: String, default: '' }
  },
  { _id: false }
);

const finiquitoCalculoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    numEmpleado: { type: String, default: '' },
    nombreEmpleado: { type: String, default: '' },
    /** Período especial (tipoNomina finiquito/indemnizacion). Sin período no se puede timbrar. */
    periodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PeriodoNomina', default: null, index: true },
    /** Recibo operativo generado al emitir el finiquito al período. */
    reciboId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReciboNomina', default: null },
    fechaIngreso: { type: Date, required: true },
    fechaBaja: { type: Date, required: true, index: true },
    causaTerminacion: { type: String, required: true, trim: true, uppercase: true, index: true },
    estatus: {
      type: String,
      enum: ['borrador', 'calculado', 'revisado', 'autorizado', 'pagado', 'timbrado', 'cancelado'],
      default: 'borrador',
      index: true
    },
    /** Parámetros del cálculo (overrides). */
    parametros: { type: mongoose.Schema.Types.Mixed, default: {} },
    negociacion: {
      activa: { type: Boolean, default: false },
      gratificacion: { type: Number, default: 0 },
      ajustes: { type: [mongoose.Schema.Types.Mixed], default: [] },
      notas: { type: String, default: '' }
    },
    antiguedad: {
      aniosCompletos: { type: Number, default: 0 },
      meses: { type: Number, default: 0 },
      dias: { type: Number, default: 0 },
      aniosProporcionales: { type: Number, default: 0 },
      diasTotales: { type: Number, default: 0 }
    },
    conceptos: { type: [conceptoSchema], default: [] },
    totales: {
      finiquitoLegal: { type: Number, default: 0 },
      liquidacionLegal: { type: Number, default: 0 },
      ajustesNegociacion: { type: Number, default: 0 },
      totalBruto: { type: Number, default: 0 },
      gravadoISR: { type: Number, default: 0 },
      exentoISR: { type: Number, default: 0 },
      isr: { type: Number, default: 0 },
      deducciones: { type: Number, default: 0 },
      netoPagar: { type: Number, default: 0 }
    },
    notas: { type: String, default: '' },
    auditoria: { type: [auditoriaSchema], default: [] },
    creadoPorUserId: { type: String, default: '' },
    creadoPorLabel: { type: String, default: '' },
    autorizadoPorUserId: { type: String, default: '' },
    autorizadoPorLabel: { type: String, default: '' },
    autorizadoAt: { type: Date, default: null }
  },
  { timestamps: true, collection: COLLECTION_FINIQUITO_CALCULOS }
);

finiquitoCalculoSchema.index({ tenantId: 1, empresaId: 1, createdAt: -1 });
finiquitoCalculoSchema.index({ tenantId: 1, empleadoId: 1, fechaBaja: -1 });

module.exports = async function getFiniquitoCalculoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.FiniquitoCalculo ||
    conn.model('FiniquitoCalculo', finiquitoCalculoSchema, COLLECTION_FINIQUITO_CALCULOS)
  );
};

'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');

const reglaConceptoSchema = new mongoose.Schema(
  {
    codigo: { type: String, trim: true, uppercase: true, required: true },
    tratamiento: { type: String, enum: ['gravado', 'exento', 'especial'], default: 'gravado' },
    porcentajeGravado: { type: Number, min: 0, max: 100, default: 100 }
  },
  { _id: false }
);

const registroPatronalSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria', default: null },
    numero: { type: String, required: true, trim: true, uppercase: true },
    claseRiesgo: { type: String, trim: true, default: '' },
    fraccion: { type: String, trim: true, default: '' },
    primaRiesgo: { type: Number, default: null },
    fechaInicio: { type: Date, default: null },
    fechaFin: { type: Date, default: null },
    esRpu: { type: Boolean, default: false },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: 'registros_patronales_imss' }
);
registroPatronalSchema.index({ tenantId: 1, empresaId: 1, numero: 1 }, { unique: true });

const registroIsnSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    entidad: { type: String, required: true, trim: true, uppercase: true },
    cuentaEstatal: { type: String, trim: true, default: '' },
    fechaAlta: { type: Date, default: null },
    fechaBaja: { type: Date, default: null },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: 'registros_isn' }
);
registroIsnSchema.index({ tenantId: 1, empresaId: 1, entidad: 1, cuentaEstatal: 1 }, { unique: true });

const configIsnSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    entidad: { type: String, required: true, trim: true, uppercase: true },
    tasa: { type: Number, required: true },
    periodicidad: { type: String, enum: ['mensual'], default: 'mensual' },
    diaLimite: { type: Number, default: 17, min: 1, max: 31 },
    reglaAtribucion: {
      type: String,
      enum: ['lugar_servicio', 'domicilio_trabajador_si_fuera'],
      default: 'lugar_servicio'
    },
    fundamentoLegal: { type: String, trim: true, default: '' },
    reglasConcepto: { type: [reglaConceptoSchema], default: [] },
    fechaInicio: { type: Date, required: true },
    fechaFin: { type: Date, default: null },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: 'config_isn' }
);
configIsnSchema.index({ tenantId: 1, empresaId: 1, entidad: 1, fechaInicio: -1 });

const detalleConceptoSchema = new mongoose.Schema(
  {
    codigo: { type: String, default: '' },
    importe: { type: Number, default: 0 },
    tratamiento: { type: String, default: '' }
  },
  { _id: false }
);

const detalleIsnSchema = new mongoose.Schema(
  {
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado' },
    numEmpleado: { type: String, default: '' },
    nombre: { type: String, default: '' },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria', default: null },
    establecimiento: { type: String, default: '' },
    registroPatronal: { type: String, default: '' },
    entidad: { type: String, default: '' },
    regla: { type: String, default: '' },
    nota: { type: String, default: '' },
    baseGravable: { type: Number, default: 0 },
    baseExenta: { type: Number, default: 0 },
    impuesto: { type: Number, default: 0 },
    conceptos: { type: [detalleConceptoSchema], default: [] }
  },
  { _id: false }
);

const entidadIsnSchema = new mongoose.Schema(
  {
    entidad: { type: String, default: '' },
    trabajadores: { type: Number, default: 0 },
    baseGravable: { type: Number, default: 0 },
    baseExenta: { type: Number, default: 0 },
    tasa: { type: Number, default: null },
    impuesto: { type: Number, default: 0 },
    cuentaEstatal: { type: String, default: '' },
    sinTasa: { type: Boolean, default: false }
  },
  { _id: false }
);

const declaracionIsnSchema = new mongoose.Schema(
  {
    entidad: { type: String, trim: true, uppercase: true, default: '' },
    tipo: { type: String, enum: ['normal', 'complementaria'], default: 'normal' },
    folio: { type: String, trim: true, default: '' },
    fecha: { type: Date, default: null },
    referenciaPago: { type: String, trim: true, default: '' },
    importe: { type: Number, default: 0 },
    registroPatronal: { type: String, trim: true, uppercase: true, default: '' },
    documentoId: { type: mongoose.Schema.Types.ObjectId, default: null },
    nombreArchivo: { type: String, trim: true, default: '' },
    notas: { type: String, trim: true, default: '' },
    registradoPor: { type: String, trim: true, default: '' }
  },
  { timestamps: true }
);

const determinacionIsnSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    anio: { type: Number, required: true },
    mes: { type: Number, required: true, min: 1, max: 12 },
    version: { type: Number, default: 1 },
    estatus: { type: String, enum: ['borrador', 'cerrado', 'reemplazado'], default: 'borrador' },
    fuente: { type: String, enum: ['historico', 'timbrado'], default: 'historico' },
    porEntidad: { type: [entidadIsnSchema], default: [] },
    detalle: { type: [detalleIsnSchema], default: [] },
    totalBaseGravable: { type: Number, default: 0 },
    totalImpuesto: { type: Number, default: 0 },
    advertencias: { type: [String], default: [] },
    calculadoPor: { type: String, trim: true, default: '' },
    cerradoPor: { type: String, trim: true, default: '' },
    cerradoAt: { type: Date, default: null },
    declaraciones: { type: [declaracionIsnSchema], default: [] }
  },
  { timestamps: true, collection: 'determinaciones_isn' }
);
determinacionIsnSchema.index({ tenantId: 1, empresaId: 1, anio: 1, mes: 1, version: 1 }, { unique: true });

async function models() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return {
    RegistroPatronal:
      conn.models.RegistroPatronalImss ||
      conn.model('RegistroPatronalImss', registroPatronalSchema, 'registros_patronales_imss'),
    RegistroIsn: conn.models.RegistroIsn || conn.model('RegistroIsn', registroIsnSchema, 'registros_isn'),
    ConfigIsn: conn.models.ConfigIsn || conn.model('ConfigIsn', configIsnSchema, 'config_isn'),
    DeterminacionIsn:
      conn.models.DeterminacionIsn ||
      conn.model('DeterminacionIsn', determinacionIsnSchema, 'determinaciones_isn')
  };
}

module.exports = { models };

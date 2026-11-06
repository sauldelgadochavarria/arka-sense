'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');

const TIPOS_AFILIATORIOS = ['ALTA', 'BAJA', 'REINGRESO', 'MODIFICACION_SALARIAL'];
const NATURALEZAS_SALARIO = ['fijo', 'variable', 'mixto'];
const ESTATUS_AFILIATORIO = ['pendiente', 'generado', 'enviado', 'aceptado', 'rechazado', 'cancelado'];

const INSTITUCIONES_CREDITO = ['INFONAVIT', 'FONACOT'];
const TIPOS_DESCUENTO_CREDITO = ['cuota_fija', 'porcentaje', 'factor', 'cuota_periodica'];
const PERIODICIDADES_CREDITO = ['cada_periodo', 'semanal', 'quincenal', 'mensual', 'bimestral'];
const RUBROS_EBA = [
  'trabajadores',
  'salarios',
  'dias_cotizados',
  'aportaciones',
  'amortizaciones',
  'creditos_activos',
  'descuentos_aplicados'
];
const ESTATUS_CREDITO = ['activo', 'suspendido', 'liquidado', 'cancelado'];
const AVISOS_INFONAVIT = ['RETENCION', 'MODIFICACION', 'SUSPENSION', 'LIQUIDACION', 'REINICIO'];
const AVISOS_FONACOT = [
  'FONACOT_ALTA_CREDITO',
  'FONACOT_MODIFICACION',
  'FONACOT_SUSPENSION',
  'FONACOT_BAJA',
  'FONACOT_LIQUIDACION'
];

const OBLIGACIONES = ['IMSS', 'INFONAVIT', 'FONACOT', 'ISN'];
const ESTATUS_CONCILIACION = ['pendiente', 'en_revision', 'resuelta'];

const movimientoAfiliatorioSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria', default: null, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    registroPatronalId: { type: mongoose.Schema.Types.ObjectId, ref: 'RegistroPatronalImss', default: null },
    /** Opcional. Un movimiento laboral no crea este aviso por sí solo. */
    historialLaboralId: { type: mongoose.Schema.Types.ObjectId, ref: 'HistorialLaboral', default: null },
    tipo: { type: String, enum: TIPOS_AFILIATORIOS, required: true },
    naturalezaSalario: { type: String, enum: ['', ...NATURALEZAS_SALARIO], default: '' },
    fechaEfectiva: { type: Date, required: true },
    sbcAnterior: { type: Number, default: null },
    sbcNuevo: { type: Number, default: null },
    estatus: { type: String, enum: ESTATUS_AFILIATORIO, default: 'pendiente', index: true },
    fechaEnvio: { type: Date, default: null },
    resultado: { type: String, trim: true, default: '' },
    acuseReferencia: { type: String, trim: true, default: '' },
    notas: { type: String, trim: true, default: '' },
    registradoPor: { type: String, trim: true, default: '' }
  },
  { timestamps: true, collection: 'movimientos_afiliatorios_imss' }
);
movimientoAfiliatorioSchema.index({ tenantId: 1, empresaId: 1, fechaEfectiva: -1 });

const creditoTrabajadorSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria', default: null, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    institucion: { type: String, enum: INSTITUCIONES_CREDITO, required: true, index: true },
    numeroCredito: { type: String, required: true, trim: true },
    tipoDescuento: { type: String, enum: TIPOS_DESCUENTO_CREDITO, required: true },
    valorDescuento: { type: Number, default: 0 },
    fechaInicio: { type: Date, required: true },
    fechaFin: { type: Date, default: null },
    periodicidad: { type: String, trim: true, default: 'cada_periodo' },
    documentoOrigen: { type: String, trim: true, default: '' },
    fechaVigencia: { type: Date, default: null },
    estatus: { type: String, enum: ESTATUS_CREDITO, default: 'activo', index: true },
    importeRetenido: { type: Number, default: 0 },
    importeDeterminado: { type: Number, default: 0 },
    importeEnterado: { type: Number, default: 0 },
    notas: { type: String, trim: true, default: '' },
    registradoPor: { type: String, trim: true, default: '' },
    /** Descuento de nómina vigente. Los periodos ya cerrados no se reescriben. */
    descuentoProgramadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'DescuentoProgramado', default: null },
    conceptoCodigo: { type: String, trim: true, uppercase: true, default: '' }
  },
  { timestamps: true, collection: 'creditos_trabajador' }
);
creditoTrabajadorSchema.index(
  { tenantId: 1, empresaId: 1, institucion: 1, numeroCredito: 1 },
  { unique: true }
);

const creditoAvisoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    creditoId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditoTrabajador', required: true, index: true },
    institucion: { type: String, enum: INSTITUCIONES_CREDITO, required: true },
    tipoAviso: { type: String, required: true, trim: true },
    fechaRecepcion: { type: Date, default: null },
    fechaAplicacion: { type: Date, default: null },
    valorAnterior: { type: Number, default: null },
    valorNuevo: { type: Number, default: null },
    documentoReferencia: { type: String, trim: true, default: '' },
    numeroCedula: { type: String, trim: true, default: '' },
    periodoCedula: { type: String, trim: true, default: '' },
    importeCedula: { type: Number, default: null },
    notas: { type: String, trim: true, default: '' },
    registradoPor: { type: String, trim: true, default: '' }
  },
  { timestamps: true, collection: 'creditos_trabajador_avisos' }
);

const conciliacionObligacionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    obligacion: { type: String, enum: OBLIGACIONES, required: true, index: true },
    anio: { type: Number, required: true },
    mes: { type: Number, required: true, min: 1, max: 12 },
    registroPatronal: { type: String, trim: true, uppercase: true, default: '' },
    entidad: { type: String, trim: true, uppercase: true, default: '' },
    importeCalculado: { type: Number, default: 0 },
    importeOficial: { type: Number, default: 0 },
    diferencia: { type: Number, default: 0 },
    importeEnterado: { type: Number, default: null },
    referencia: { type: String, trim: true, default: '' },
    motivo: { type: String, trim: true, default: '' },
    origen: { type: String, enum: ['manual', 'automatica'], default: 'manual' },
    estatus: { type: String, enum: ESTATUS_CONCILIACION, default: 'pendiente', index: true },
    responsable: { type: String, trim: true, default: '' },
    fechaResolucion: { type: Date, default: null }
  },
  { timestamps: true, collection: 'conciliaciones_obligacion' }
);
conciliacionObligacionSchema.index({ tenantId: 1, empresaId: 1, obligacion: 1, anio: 1, mes: 1 });

const centroTrabajoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria', default: null },
    registroPatronalId: { type: mongoose.Schema.Types.ObjectId, ref: 'RegistroPatronalImss', default: null },
    clave: { type: String, required: true, trim: true, uppercase: true },
    nombre: { type: String, required: true, trim: true },
    entidadFederativa: { type: String, trim: true, uppercase: true, default: '' },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: 'centros_trabajo' }
);
centroTrabajoSchema.index({ tenantId: 1, empresaId: 1, clave: 1 }, { unique: true });

const trabajadorAsignacionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    centroTrabajoId: { type: mongoose.Schema.Types.ObjectId, ref: 'CentroTrabajo', default: null },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria', default: null },
    registroPatronalId: { type: mongoose.Schema.Types.ObjectId, ref: 'RegistroPatronalImss', default: null },
    entidad: { type: String, trim: true, uppercase: true, default: '' },
    porcentajeAsignacion: { type: Number, default: 100, min: 0, max: 100 },
    fechaInicio: { type: Date, required: true },
    fechaFin: { type: Date, default: null },
    criterioAsignacion: { type: String, trim: true, default: 'lugar_servicio' },
    observaciones: { type: String, trim: true, default: '' },
    registradoPor: { type: String, trim: true, default: '' }
  },
  { timestamps: true, collection: 'trabajador_asignaciones' }
);
trabajadorAsignacionSchema.index({ tenantId: 1, empresaId: 1, empleadoId: 1, fechaInicio: -1 });

const auditoriaCumplimientoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    entidad: { type: String, required: true, trim: true },
    entidadId: { type: String, trim: true, default: '' },
    campo: { type: String, required: true, trim: true },
    valorAnterior: { type: mongoose.Schema.Types.Mixed, default: null },
    valorNuevo: { type: mongoose.Schema.Types.Mixed, default: null },
    motivo: { type: String, trim: true, default: '' },
    usuario: { type: String, trim: true, default: '' }
  },
  { timestamps: true, collection: 'auditoria_cumplimiento' }
);
auditoriaCumplimientoSchema.index({ tenantId: 1, empresaId: 1, createdAt: -1 });

const comparacionEbaSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    anio: { type: Number, required: true },
    bimestre: { type: Number, required: true, min: 1, max: 6 },
    registroPatronal: { type: String, trim: true, uppercase: true, default: '' },
    rubro: { type: String, enum: RUBROS_EBA, required: true },
    calculado: { type: Number, default: 0 },
    eba: { type: Number, default: 0 },
    diferencia: { type: Number, default: 0 },
    registradoPor: { type: String, trim: true, default: '' }
  },
  { timestamps: true, collection: 'comparaciones_eba' }
);
comparacionEbaSchema.index(
  { tenantId: 1, empresaId: 1, anio: 1, bimestre: 1, registroPatronal: 1, rubro: 1 },
  { unique: true }
);

async function models() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return {
    MovimientoAfiliatorio:
      conn.models.MovimientoAfiliatorioImss ||
      conn.model('MovimientoAfiliatorioImss', movimientoAfiliatorioSchema, 'movimientos_afiliatorios_imss'),
    CreditoTrabajador:
      conn.models.CreditoTrabajador ||
      conn.model('CreditoTrabajador', creditoTrabajadorSchema, 'creditos_trabajador'),
    CreditoAviso:
      conn.models.CreditoAviso ||
      conn.model('CreditoAviso', creditoAvisoSchema, 'creditos_trabajador_avisos'),
    ConciliacionObligacion:
      conn.models.ConciliacionObligacion ||
      conn.model('ConciliacionObligacion', conciliacionObligacionSchema, 'conciliaciones_obligacion'),
    CentroTrabajo:
      conn.models.CentroTrabajo || conn.model('CentroTrabajo', centroTrabajoSchema, 'centros_trabajo'),
    TrabajadorAsignacion:
      conn.models.TrabajadorAsignacion ||
      conn.model('TrabajadorAsignacion', trabajadorAsignacionSchema, 'trabajador_asignaciones'),
    AuditoriaCumplimiento:
      conn.models.AuditoriaCumplimiento ||
      conn.model('AuditoriaCumplimiento', auditoriaCumplimientoSchema, 'auditoria_cumplimiento'),
    ComparacionEba:
      conn.models.ComparacionEba ||
      conn.model('ComparacionEba', comparacionEbaSchema, 'comparaciones_eba')
  };
}

module.exports = {
  models,
  TIPOS_AFILIATORIOS,
  NATURALEZAS_SALARIO,
  ESTATUS_AFILIATORIO,
  INSTITUCIONES_CREDITO,
  TIPOS_DESCUENTO_CREDITO,
  PERIODICIDADES_CREDITO,
  RUBROS_EBA,
  ESTATUS_CREDITO,
  AVISOS_INFONAVIT,
  AVISOS_FONACOT,
  OBLIGACIONES,
  ESTATUS_CONCILIACION
};

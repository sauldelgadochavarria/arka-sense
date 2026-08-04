const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_EMPLEADOS } = require('../config/constants');

const empleadoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria' },
    numEmpleado: { type: String, required: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    curp: { type: String, trim: true, uppercase: true, default: '' },
    rfc: { type: String, trim: true, uppercase: true, default: '' },
    nss: { type: String, trim: true, default: '' },
    fechaNacimiento: { type: Date },
    sexo: { type: String, enum: ['', 'M', 'F', 'X'], default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    emailPersonal: { type: String, trim: true, lowercase: true, default: '' },
    telefono: { type: String, trim: true, default: '' },
    telefonoFijo: { type: String, trim: true, default: '' },
    departamentoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Departamento' },
    puestoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Puesto' },
    turnoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turno' },
    /** Tipo de período de pago (catálogo tipos_periodo_nomina: semanal, quincenal, etc.) */
    tipoPeriodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'TipoPeriodoNomina', default: null },
    supervisorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado' },
    tipoContrato: { type: String, trim: true, default: 'indefinido' },
    /** Clasificación laboral (enum sistema: tipo_empleado) */
    tipoEmpleado: { type: String, trim: true, default: '' },
    salarioDiario: { type: Number, min: 0 },
    fechaIngreso: { type: Date },
    fechaBaja: { type: Date },
    motivoBaja: { type: String, trim: true, default: '' },
    estatus: {
      type: String,
      enum: ['activo', 'baja', 'suspendido'],
      default: 'activo'
    },
    activo: { type: Boolean, default: true },
    codigoExterno: { type: String, trim: true, default: '' },
    tipoRegistro: {
      type: String,
      enum: ['ninguno', 'rol_turnos', 'planilla'],
      default: 'rol_turnos'
    },
    grupoDispositivosId: { type: mongoose.Schema.Types.ObjectId, ref: 'GrupoDispositivos' },
    exportarFaltas: { type: Boolean, default: true },
    exportarRetardos: { type: Boolean, default: true },
    exportarHorasExtra: { type: Boolean, default: true },
    nominaConfig: {
      aplicaFondoAhorro: { type: Boolean, default: false },
      porcentajeFondoAhorro: { type: Number, default: 0, min: 0, max: 100 },
      tipoCreditoInfonavit: {
        type: String,
        enum: ['', 'porcentaje', 'vsm', 'cuota_fija'],
        default: ''
      },
      tasaInfonavit: { type: Number, default: 0, min: 0 },
      infonavitDescuento: { type: Number, default: 0, min: 0 },
      diasCotizacionImss: { type: Number, default: 0, min: 0 },
      sueldoIntegrado: { type: Number, default: 0, min: 0 },
      diasPrimaVacacional: { type: Number, default: 0, min: 0 },
      proporcionAguinaldoFiniquito: { type: Number, default: 0, min: 0 },
      fondoAhorroSaldoFiniquito: { type: Number, default: 0, min: 0 }
    }
  },
  { timestamps: true, collection: COLLECTION_EMPLEADOS }
);

empleadoSchema.index({ tenantId: 1, numEmpleado: 1 }, { unique: true });
empleadoSchema.index({ tenantId: 1, tipoPeriodoId: 1 });
empleadoSchema.index(
  { tenantId: 1, codigoExterno: 1 },
  { unique: true, partialFilterExpression: { codigoExterno: { $type: 'string', $ne: '' } } }
);

async function getEmpleadoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.Empleado || conn.model('Empleado', empleadoSchema, COLLECTION_EMPLEADOS);
}

module.exports = getEmpleadoModel;

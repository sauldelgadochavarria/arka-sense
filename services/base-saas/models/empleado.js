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
    /** Compat: apellido(s) concatenados. Preferir apellidoPaterno / apellidoMaterno. */
    lastName: { type: String, required: true, trim: true },
    apellidoPaterno: { type: String, trim: true, default: '' },
    apellidoMaterno: { type: String, trim: true, default: '' },
    curp: { type: String, trim: true, uppercase: true, default: '' },
    rfc: { type: String, trim: true, uppercase: true, default: '' },
    nss: { type: String, trim: true, default: '' },
    fechaNacimiento: { type: Date },
    sexo: { type: String, enum: ['', 'M', 'F', 'X'], default: '' },
    estadoCivil: { type: String, trim: true, default: '' },
    entidadNacimiento: { type: String, trim: true, uppercase: true, default: '' },
    ciudadNacimiento: { type: String, trim: true, default: '' },
    /** IMSS */
    registroPatronal: { type: String, trim: true, uppercase: true, default: '' },
    umf: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    emailPersonal: { type: String, trim: true, lowercase: true, default: '' },
    telefono: { type: String, trim: true, default: '' },
    telefonoFijo: { type: String, trim: true, default: '' },
    /** Domicilio (CP obligatorio para CFDI de nómina) */
    domicilio: {
      calle: { type: String, trim: true, default: '' },
      numeroExt: { type: String, trim: true, default: '' },
      numeroInt: { type: String, trim: true, default: '' },
      colonia: { type: String, trim: true, default: '' },
      poblacion: { type: String, trim: true, default: '' },
      entidad: { type: String, trim: true, default: '' },
      codigoPostal: { type: String, trim: true, default: '' }
    },
    departamentoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Departamento' },
    centroCostoId: { type: mongoose.Schema.Types.ObjectId, ref: 'CentroCosto', default: null },
    puestoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Puesto' },
    /**
     * Override explícito de tabla de prestaciones.
     * Si vacío → cascada puesto > depto > tipo_empleado > global.
     */
    tablaPrestacionesId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TablaPrestaciones',
      default: null
    },
    turnoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turno' },
    /** Tipo de período de pago (catálogo tipos_periodo_nomina: semanal, quincenal, etc.) */
    tipoPeriodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'TipoPeriodoNomina', default: null },
    supervisorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado' },
    tipoContrato: { type: String, trim: true, default: 'indefinido' },
    /** Clasificación laboral (enum sistema: tipo_empleado) */
    tipoEmpleado: { type: String, trim: true, default: '' },
    /** Salario diario contratado (parte fija). */
    salarioDiario: { type: Number, min: 0 },
    /**
     * Base de cotización IMSS: fijo | variable | mixto.
     * Variable/mixto: capturar SDI (promedio de variables + fijo según política).
     */
    tipoSalario: {
      type: String,
      enum: ['fijo', 'variable', 'mixto', ''],
      default: 'fijo'
    },
    /** Salario Diario Integrado (SDI). Si vacío, el motor usa salarioDiario. */
    sdi: { type: Number, min: 0, default: 0 },
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
    /**
     * Política de geocerca en app móvil.
     * @see config/asistencia.js POLITICAS_MARCAJE_GEO
     */
    marcajePoliticaGeo: {
      type: String,
      enum: [
        'subsidiaria_default',
        'strict_assignment',
        'any_catalog_site',
        'open_with_flag',
        'disabled',
        ''
      ],
      default: 'open_with_flag'
    },
    /** Puntos de acceso fijos autorizados (además de asignaciones temporales). */
    puntoAccesoIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PuntoAcceso' }],
      default: []
    },
    nominaConfig: {
      aplicaFondoAhorro: { type: Boolean, default: false },
      porcentajeFondoAhorro: { type: Number, default: 0, min: 0, max: 100 },
      /**
       * Despensa / vales (política del empleado).
       * fijo → despensaMontoMensual; porcentaje → % del sueldo mensual × tope.
       * despensaMonto se mantiene como alias del monto fijo mensual (compat).
       */
      despensaModalidad: {
        type: String,
        enum: ['ninguna', 'fijo', 'porcentaje'],
        default: 'ninguna'
      },
      despensaMonto: { type: Number, default: 0, min: 0 },
      despensaMontoMensual: { type: Number, default: 0, min: 0 },
      despensaPorcentaje: { type: Number, default: 0, min: 0, max: 100 },
      /** imss_40_uma | uma_mensual | monto | sin_tope */
      despensaTopeModo: {
        type: String,
        enum: ['imss_40_uma', 'uma_mensual', 'monto', 'sin_tope'],
        default: 'imss_40_uma'
      },
      despensaTopeMonto: { type: Number, default: 0, min: 0 },
      seguroVidaMonto: { type: Number, default: 0, min: 0 },
      sgmmMonto: { type: Number, default: 0, min: 0 },
      tipoCreditoInfonavit: {
        type: String,
        enum: ['', 'porcentaje', 'vsm', 'cuota_fija'],
        default: ''
      },
      tasaInfonavit: { type: Number, default: 0, min: 0 },
      infonavitDescuento: { type: Number, default: 0, min: 0 },
      /** Número de crédito INFONAVIT (10 chars; requerido para CRED.TXT / ASEG). */
      infonavitNumeroCredito: { type: String, trim: true, default: '' },
      /** Fecha inicio descuento (aviso retención). */
      infonavitFechaInicio: { type: Date, default: null },
      /**
       * FONACOT (cédula de descuentos):
       * monto_fijo → fonacotMonto por período
       * porcentaje → fonacotPorcentaje (10/15/20; SM máx 10) sobre bruto
       * fonacotDescuento → override fijo del período (anula cálculo)
       */
      tipoCreditoFonacot: {
        type: String,
        enum: ['', 'monto_fijo', 'porcentaje'],
        default: ''
      },
      fonacotMonto: { type: Number, default: 0, min: 0 },
      fonacotPorcentaje: { type: Number, default: 0, min: 0, max: 20 },
      fonacotDescuento: { type: Number, default: 0, min: 0 },
      /**
       * Cuota sindical (CCT / contrato):
       * monto_fijo | porcentaje; base bruto|neto_fiscal;
       * enTope30: ''=empresa | si | no
       */
      tipoCuotaSindical: {
        type: String,
        enum: ['', 'monto_fijo', 'porcentaje'],
        default: ''
      },
      cuotaSindicalMonto: { type: Number, default: 0, min: 0 },
      cuotaSindicalPorcentaje: { type: Number, default: 0, min: 0, max: 100 },
      cuotaSindicalDescuento: { type: Number, default: 0, min: 0 },
      cuotaSindicalBase: {
        type: String,
        enum: ['', 'bruto', 'neto_fiscal'],
        default: ''
      },
      cuotaSindicalEnTope30: {
        type: String,
        enum: ['', 'empresa', 'si', 'no'],
        default: ''
      },
      diasCotizacionImss: { type: Number, default: 0, min: 0 },
      sueldoIntegrado: { type: Number, default: 0, min: 0 },
      diasPrimaVacacional: { type: Number, default: 0, min: 0 },
      /** Override opcional del % de prima (vacío/0 = usar tabla de prestaciones). */
      primaVacacionalPct: { type: Number, default: 0, min: 0, max: 100 },
      proporcionAguinaldoFiniquito: { type: Number, default: 0, min: 0 },
      fondoAhorroSaldoFiniquito: { type: Number, default: 0, min: 0 }
    },
    /** Datos para dispersión / layouts bancarios */
    datosBancarios: {
      bancoCodigo: { type: String, trim: true, default: '' },
      bancoNombre: { type: String, trim: true, default: '' },
      cuenta: { type: String, trim: true, default: '' },
      clabe: { type: String, trim: true, default: '' }
    },
    /**
     * Plantilla facial 1:1 (FaceNet 128-d). Solo RRHH enrolla;
     * la app móvil verifica liveness + match.
     */
    biometriaFacial: {
      enrolled: { type: Boolean, default: false },
      enrolledAt: { type: Date, default: null },
      enrolledBy: { type: String, trim: true, default: null },
      modelVersion: { type: String, trim: true, default: '' },
      embedding: { type: [Number], default: undefined },
      distanceThreshold: { type: Number, default: 0.62 },
      detectionScore: { type: Number, default: 0 }
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

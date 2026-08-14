const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_NOMINA_RECIBOS } = require('../config/constants');

const reciboNominaSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    periodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PeriodoNomina', required: true, index: true },
    diasLaborados: { type: Number, default: 0 },
    faltas: { type: Number, default: 0 },
    /** Desglose del motor de días pagados / descanso. */
    diasPago: { type: mongoose.Schema.Types.Mixed, default: null },
    totalPercepciones: { type: Number, default: 0 },
    totalDeducciones: { type: Number, default: 0 },
    netoPagar: { type: Number, default: 0 },
    basesFiscales: {
      PERCEPCIONES_GRAVADAS: { type: Number, default: 0 },
      PERCEPCIONES_EXENTAS: { type: Number, default: 0 },
      BASE_ISR: { type: Number, default: 0 },
      BASE_IMSS: { type: Number, default: 0 }
    },
    /** Origen de días/HE/faltas: prenomina | prenomina_sin_detalle | default */
    insumosFuente: { type: String, trim: true, default: 'default' },
    insumosResumen: {
      diasTrabajados: { type: Number, default: null },
      faltas: { type: Number, default: 0 },
      minutosRetardo: { type: Number, default: 0 },
      horasExtraDobles: { type: Number, default: 0 },
      horasExtraTriples: { type: Number, default: 0 },
      sueldoDiario: { type: Number, default: 0 },
      payrollPeriodId: { type: mongoose.Schema.Types.ObjectId, default: null }
    },
    fechaCalculo: { type: Date, default: Date.now },
    /** ID único de este recibo en la corrida de cálculo (auditoría). */
    calculoId: { type: String, trim: true, default: '', index: true },
    /** ID de la corrida de cálculo del período (agrupa todos los recibos de un click). */
    calculoLoteId: { type: String, trim: true, default: '', index: true },
    fechaCierre: { type: Date, default: null },
    cerrado: { type: Boolean, default: false },
    /** Motor SAT + Inteligente (proyección). CFDI siempre usa isrMotor.isrRetenidoCfdi = ISR SAT. */
    isrMotor: { type: mongoose.Schema.Types.Mixed, default: null },
    errorCalculo: { type: String, default: '' },
    layoutBancario: require('./layoutBancarioStatusFields').layoutBancarioStatusFields(),
    timbrado: require('./timbradoStatusFields').timbradoStatusFields(),
    correo: require('./envioCorreoStatusFields').envioCorreoReciboFields()
  },
  { timestamps: true, collection: COLLECTION_NOMINA_RECIBOS }
);

reciboNominaSchema.index({ tenantId: 1, empleadoId: 1, periodoId: 1 }, { unique: true });
reciboNominaSchema.index({ tenantId: 1, calculoId: 1 }, { sparse: true });
reciboNominaSchema.index({ tenantId: 1, calculoLoteId: 1 });

async function getReciboNominaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.ReciboNomina ||
    conn.model('ReciboNomina', reciboNominaSchema, COLLECTION_NOMINA_RECIBOS)
  );
}

module.exports = getReciboNominaModel;

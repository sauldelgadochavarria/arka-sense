const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_PAYROLL_DETAILS } = require('../config/constants');

const lineaConceptoSchema = new mongoose.Schema(
  {
    clave: String,
    nombre: String,
    tipo: { type: String, enum: ['percepcion', 'deduccion'] },
    monto: { type: Number, default: 0 }
  },
  { _id: false }
);

const ajusteManualSchema = new mongoose.Schema(
  {
    concepto: String,
    monto: Number,
    nota: String,
    userId: String,
    fecha: { type: Date, default: Date.now }
  },
  { _id: false }
);

const payrollDetailSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    periodId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollPeriod', required: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    diasTrabajados: { type: Number, default: 0 },
    /** Descansos del turno dentro del período (sábado y domingo, si el turno descansa ambos). */
    diasDescanso: { type: Number, default: 0 },
    /** Descansos que sí se pagan como séptimo día, según la política de la empresa. */
    diasDescansoPagados: { type: Number, default: 0 },
    diasProgramadosTurno: { type: Number, default: 0 },
    diasFalta: { type: Number, default: 0 },
    diasConRetardo: { type: Number, default: 0 },
    minutosRetardo: { type: Number, default: 0 },
    minutosHorasExtra: { type: Number, default: 0 },
    /** Excedente bajo el mínimo de la subsidiaria: se anota y no se paga. */
    minutosHorasExtraNota: { type: Number, default: 0 },
    /** Excedente que alcanza el mínimo y sigue sin autorización de asistencia. */
    minutosHorasExtraSinAutorizar: { type: Number, default: 0 },
    minutosHEOrdinaria: { type: Number, default: 0 },
    minutosHEDoble: { type: Number, default: 0 },
    minutosHETriple: { type: Number, default: 0 },
    /** Horas completas de la semana que sí se pagan y se envían a nómina. */
    horasExtraDobles: { type: Number },
    horasExtraTriples: { type: Number },
    /** Minutos que no alcanzan otra hora completa. Quedan en el historial. */
    minutosHESobrantesDobles: { type: Number, default: 0 },
    minutosHESobrantesTriples: { type: Number, default: 0 },
    minutosSalidaAnticipada: { type: Number, default: 0 },
    salarioDiario: { type: Number, default: 0 },
    /** Snapshot jornada / valor hora al calcular (Sprint 1 reforma 2027). */
    horasJornada: { type: Number, default: 8 },
    valorHora: { type: Number, default: 0 },
    maxHorasOrdinariasSemana: { type: Number, default: 46 },
    tipoJornadaCfdi: { type: String, default: '01' },
    excedeLimiteDiario: { type: Boolean, default: false },
    percepciones: [lineaConceptoSchema],
    deducciones: [lineaConceptoSchema],
    totalPercepciones: { type: Number, default: 0 },
    totalDeducciones: { type: Number, default: 0 },
    netoPagar: { type: Number, default: 0 },
    ajustesManuales: [ajusteManualSchema],
    estatus: { type: String, enum: ['calculado', 'ajustado'], default: 'calculado' }
  },
  { timestamps: true, collection: COLLECTION_PAYROLL_DETAILS }
);

payrollDetailSchema.index({ tenantId: 1, periodId: 1, empleadoId: 1 }, { unique: true });

async function getPayrollDetailModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.PayrollDetail ||
    conn.model('PayrollDetail', payrollDetailSchema, COLLECTION_PAYROLL_DETAILS)
  );
}

module.exports = getPayrollDetailModel;

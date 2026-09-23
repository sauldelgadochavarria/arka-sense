const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_DAILY_ATTENDANCE } = require('../config/constants');

const dailyAttendanceSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true },
    turnoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turno' },
    fecha: { type: Date, required: true, index: true },
    entradaProgramada: { type: Date },
    salidaProgramada: { type: Date },
    entradaReal: { type: Date },
    salidaComida: { type: Date },
    regresoComida: { type: Date },
    salidaReal: { type: Date },
    minutosRetardo: { type: Number, default: 0, min: 0 },
    minutosSalidaAnticipada: { type: Number, default: 0, min: 0 },
    minutosHorasExtra: { type: Number, default: 0, min: 0 },
    minutosHEOrdinaria: { type: Number, default: 0, min: 0 },
    minutosHEDoble: { type: Number, default: 0, min: 0 },
    minutosHETriple: { type: Number, default: 0, min: 0 },
    estatus: {
      type: String,
      enum: [
        'presente',
        'retardo',
        'falta',
        'incompleto',
        'descanso',
        'registro_parcial',
        'fuera_de_rango'
      ],
      default: 'falta'
    },
    incidenciasAutomaticas: [{ type: String }],
    marcajesFueraDeRango: { type: Boolean, default: false },
    /** Art. 68: ordinarias programadas + HE del día > tope esquema (default 12 h). */
    excedeLimiteDiario: { type: Boolean, default: false },
    notas: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_DAILY_ATTENDANCE }
);

dailyAttendanceSchema.index({ tenantId: 1, empleadoId: 1, fecha: 1 }, { unique: true });
dailyAttendanceSchema.index({ tenantId: 1, fecha: 1 });

async function getDailyAttendanceModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.DailyAttendance ||
    conn.model('DailyAttendance', dailyAttendanceSchema, COLLECTION_DAILY_ATTENDANCE)
  );
}

module.exports = getDailyAttendanceModel;

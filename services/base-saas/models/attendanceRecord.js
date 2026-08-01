const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_ATTENDANCE_RECORDS } = require('../config/constants');

const attendanceRecordSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    turnoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turno' },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria' },
    fecha: { type: Date, required: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    tipoMarcacion: {
      type: String,
      enum: ['entrada', 'salida_comida', 'regreso_comida', 'salida'],
      required: true
    },
    metodo: {
      type: String,
      enum: ['manual', 'biometrico', 'movil', 'rfid'],
      default: 'manual'
    },
    registradoPorUserId: { type: String, default: '' },
    notas: { type: String, default: '' },
    procesado: { type: Boolean, default: false }
  },
  { timestamps: true, collection: COLLECTION_ATTENDANCE_RECORDS }
);

attendanceRecordSchema.index({ tenantId: 1, empleadoId: 1, fecha: 1 });
attendanceRecordSchema.index({ tenantId: 1, timestamp: -1 });

async function getAttendanceRecordModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.AttendanceRecord ||
    conn.model('AttendanceRecord', attendanceRecordSchema, COLLECTION_ATTENDANCE_RECORDS)
  );
}

module.exports = getAttendanceRecordModel;

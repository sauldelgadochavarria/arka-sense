const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_ATTENDANCE_RECORDS } = require('../config/constants');

/**
 * Marcación de asistencia.
 * REJL corto plazo: se conserva el evento original; ajustes/anulaciones dejan rastro
 * (nunca borrado físico en operación normal).
 */
const attendanceRecordSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    turnoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turno' },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria' },
    fecha: { type: Date, required: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    /** Marca de tiempo tal como se registró la primera vez (inalterable en espíritu). */
    timestampOriginal: { type: Date, default: null },
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
    procesado: { type: Boolean, default: false },
    /** original = primera captura; ajuste = corregida con motivo. */
    origen: {
      type: String,
      enum: ['original', 'ajuste'],
      default: 'original'
    },
    /** activa participa en el cálculo; anulada se conserva pero no computa. */
    estado: {
      type: String,
      enum: ['activa', 'anulada'],
      default: 'activa',
      index: true
    },
    motivoAjuste: { type: String, default: '' },
    ajustadoPorUserId: { type: String, default: '' },
    ajustadoEn: { type: Date, default: null },
    motivoAnulacion: { type: String, default: '' },
    anuladoPorUserId: { type: String, default: '' },
    anuladoEn: { type: Date, default: null },
    /** Captura GPS de la app móvil / kiosco. */
    ubicacion: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      accuracyMeters: { type: Number, default: null },
      capturedAt: { type: Date, default: null },
      isMocked: { type: Boolean, default: false }
    },
    /** Resultado de validación de geocerca (backend). */
    geocerca: {
      politica: { type: String, default: '' },
      skipped: { type: Boolean, default: false },
      fueraDeZona: { type: Boolean, default: false },
      allowed: { type: Boolean, default: true },
      puntoAccesoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PuntoAcceso', default: null },
      siteSource: { type: String, default: '' },
      siteNombre: { type: String, default: '' },
      distanceMeters: { type: Number, default: null },
      radioMetros: { type: Number, default: null },
      justificacionFueraZona: { type: String, default: '' }
    },
    /** Metadatos del dispositivo que registró la marcación. */
    dispositivo: {
      plataforma: { type: String, default: '' },
      modelo: { type: String, default: '' },
      appVersion: { type: String, default: '' }
    }
  },
  { timestamps: true, collection: COLLECTION_ATTENDANCE_RECORDS }
);

attendanceRecordSchema.index({ tenantId: 1, empleadoId: 1, fecha: 1 });
attendanceRecordSchema.index({ tenantId: 1, timestamp: -1 });
attendanceRecordSchema.index({ tenantId: 1, estado: 1, fecha: 1 });

async function getAttendanceRecordModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.AttendanceRecord ||
    conn.model('AttendanceRecord', attendanceRecordSchema, COLLECTION_ATTENDANCE_RECORDS)
  );
}

module.exports = getAttendanceRecordModel;

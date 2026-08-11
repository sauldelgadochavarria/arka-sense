'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_TABLAS_PRESTACIONES } = require('../config/constants');

/**
 * Tabla de prestaciones para factor de integración / SDI.
 * Prioridad de resolución: puesto > departamento > tipo_empleado > global.
 *
 * - Factor LFT: aguinaldo + vacaciones × prima (+ días_factor opcionales).
 * - Otras prestaciones (SGMM, vales, fondo…): tratamiento por renglón.
 */
const vacacionTramoSchema = new mongoose.Schema(
  {
    aniosDesde: { type: Number, required: true, min: 0 },
    aniosHasta: { type: Number, default: null }, // null = sin tope
    diasVacaciones: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const otraPrestacionSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, trim: true, uppercase: true },
    nombre: { type: String, required: true, trim: true },
    tratamiento: {
      type: String,
      enum: ['solo_nomina', 'monto_diario_sdi', 'dias_factor'],
      default: 'solo_nomina'
    },
    /** Pesos/día (monto_diario_sdi) o días/año (dias_factor). Ignorado en solo_nomina. */
    valor: { type: Number, default: 0, min: 0 },
    activo: { type: Boolean, default: true },
    notas: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

const tablaPrestacionesSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    nombre: { type: String, required: true, trim: true },
    ambito: {
      type: String,
      enum: ['global', 'tipo_empleado', 'departamento', 'puesto'],
      default: 'global',
      index: true
    },
    tipoEmpleado: { type: String, trim: true, default: '' },
    departamentoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Departamento', default: null },
    puestoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Puesto', default: null },
    diasAguinaldo: { type: Number, default: 15, min: 0 },
    primaVacacionalPct: { type: Number, default: 25, min: 0, max: 100 },
    /** Si vacío, se usa tabla LFT de vacaciones. */
    vacacionesPorAntiguedad: { type: [vacacionTramoSchema], default: [] },
    otrasPrestaciones: { type: [otraPrestacionSchema], default: [] },
    activo: { type: Boolean, default: true },
    notas: { type: String, trim: true, default: '' }
  },
  { timestamps: true, collection: COLLECTION_TABLAS_PRESTACIONES }
);

tablaPrestacionesSchema.index({ tenantId: 1, ambito: 1, activo: 1 });
tablaPrestacionesSchema.index({ tenantId: 1, puestoId: 1 });
tablaPrestacionesSchema.index({ tenantId: 1, departamentoId: 1 });
tablaPrestacionesSchema.index({ tenantId: 1, tipoEmpleado: 1 });

async function getTablaPrestacionesModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.TablaPrestaciones ||
    conn.model('TablaPrestaciones', tablaPrestacionesSchema, COLLECTION_TABLAS_PRESTACIONES)
  );
}

module.exports = getTablaPrestacionesModel;

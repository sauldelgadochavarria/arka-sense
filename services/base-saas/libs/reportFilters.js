'use strict';

const mongoose = require('mongoose');
const { parseDate } = require('./formHelpers');
const { startOfDay, endOfDay } = require('./timeHelpers');

function parseOptionalObjectId(value) {
  const id = String(value || '').trim();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return id;
}

function parseReportFilters(query = {}) {
  const hoy = new Date();
  const desde = parseDate(query.desde) || startOfDay(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const hasta = parseDate(query.hasta) || endOfDay(hoy);

  return {
    fechaInicio: startOfDay(desde),
    fechaFin: endOfDay(hasta),
    departamentoId: parseOptionalObjectId(query.departamentoId),
    turnoId: parseOptionalObjectId(query.turnoId),
    empleadoId: parseOptionalObjectId(query.empleadoId),
    tipoIncidenciaId: parseOptionalObjectId(query.tipoIncidenciaId),
    estatusIncidencia: String(query.estatusIncidencia || '').trim(),
    anio: Number(query.anio) || hoy.getFullYear(),
    periodoId: parseOptionalObjectId(query.periodoId)
  };
}

function toDateInputValue(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function buildEmpleadoQuery(tenantId, filters, extra = {}) {
  const q = { tenantId, ...extra };
  if (filters.departamentoId) q.departamentoId = filters.departamentoId;
  if (filters.turnoId) q.turnoId = filters.turnoId;
  if (filters.empleadoId) q._id = filters.empleadoId;
  return q;
}

module.exports = {
  parseReportFilters,
  toDateInputValue,
  buildEmpleadoQuery,
  parseOptionalObjectId
};

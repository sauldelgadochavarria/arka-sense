'use strict';

const getSubsidiariaModel = require('../models/subsidiaria');
const {
  DEFAULT_TZ,
  ymdInTimeZone,
  parseDateTimeLocal,
  startOfDay,
  endOfDay
} = require('../libs/timeHelpers');

/** Acepta un nombre IANA. Si no existe, cae a la zona base (Ciudad de México). */
function normalizarZona(zona) {
  const z = String(zona || '').trim();
  if (!z) return DEFAULT_TZ;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: z }).format(new Date());
    return z;
  } catch {
    return DEFAULT_TZ;
  }
}

async function zonaDeSubsidiariaId(subsidiariaId) {
  if (!subsidiariaId) return DEFAULT_TZ;
  const Subsidiaria = await getSubsidiariaModel();
  const sub = await Subsidiaria.findById(subsidiariaId).select('zonaHoraria').lean();
  return normalizarZona(sub?.zonaHoraria);
}

async function mapaZonasPorSubsidiaria(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean).map(String))];
  const map = new Map();
  if (!uniq.length) return map;
  const Subsidiaria = await getSubsidiariaModel();
  const subs = await Subsidiaria.find({ _id: { $in: uniq } }).select('zonaHoraria').lean();
  for (const s of subs) map.set(String(s._id), normalizarZona(s.zonaHoraria));
  return map;
}

function zonaDeEmpleado(empleado, mapaSubsidiarias) {
  const id = empleado?.subsidiariaId ? String(empleado.subsidiariaId) : '';
  if (id && mapaSubsidiarias?.has(id)) return mapaSubsidiarias.get(id);
  return DEFAULT_TZ;
}

function mapaZonaPorEmpleado(empleados, mapaSubsidiarias) {
  const out = new Map();
  for (const e of empleados || []) {
    out.set(String(e._id), zonaDeEmpleado(e, mapaSubsidiarias));
  }
  return out;
}

/**
 * Zona con la que se interpretó la marcación.
 * Si el registro no la trae congelada, usa la zona actual de su subsidiaria.
 */
function zonaVisible(registro, zonaPorEmpleado, fallback = DEFAULT_TZ) {
  if (registro?.zonaHoraria) return normalizarZona(registro.zonaHoraria);
  const empId = registro?.empleadoId ? String(registro.empleadoId) : '';
  if (empId && zonaPorEmpleado?.has(empId)) return zonaPorEmpleado.get(empId);
  return fallback || DEFAULT_TZ;
}

/**
 * Día que se consulta en pantalla: el query YYYY-MM-DD, o hoy en la zona de la subsidiaria.
 * El rango UTC cubre el ancla de mediodía de ese día en las zonas de México.
 */
async function contextoFecha(fechaQuery, subsidiariaId) {
  const zona = await zonaDeSubsidiariaId(subsidiariaId);
  const q = String(fechaQuery || '').trim();
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : ymdInTimeZone(new Date(), zona);
  const ancla = parseDateTimeLocal(`${ymd}T12:00`, zona) || new Date();
  return {
    zona,
    ymd,
    ancla,
    desde: startOfDay(ancla),
    hasta: endOfDay(ancla)
  };
}

module.exports = {
  normalizarZona,
  zonaDeSubsidiariaId,
  mapaZonasPorSubsidiaria,
  zonaDeEmpleado,
  mapaZonaPorEmpleado,
  zonaVisible,
  contextoFecha
};

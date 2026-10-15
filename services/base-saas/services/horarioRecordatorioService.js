'use strict';

/**
 * Horario programado + recordatorios de checada para app móvil.
 * Usa resolveTurnoVigente (override → rotación → turno fijo del empleado).
 */

const getEmpleadoModel = require('../models/empleado');
const { resolveTurnoVigente } = require('./turnoResolverService');
const { startOfDay, applyTimeToDate } = require('../libs/timeHelpers');

const MINUTOS_ANTES_ENTRADA = Number(process.env.RECORDATORIO_MINUTOS_ANTES_ENTRADA || 15);
const MINUTOS_ANTES_SALIDA = Number(process.env.RECORDATORIO_MINUTOS_ANTES_SALIDA || 10);
const DIAS_ADELANTE_DEFAULT = Number(process.env.RECORDATORIO_DIAS_ADELANTE || 7);

function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + Number(minutes || 0) * 60 * 1000);
}

function addDays(date, n) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + Number(n || 0));
  return d;
}

function ymdLocal(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Entrada/salida Date para una fecha de jornada.
 * Turno nocturno: si salida <= entrada, salida cae al día siguiente.
 */
function programacionDelDia(fechaBase, turno) {
  if (!turno?.horaEntrada || !turno?.horaSalida) {
    return { entradaProgramada: null, salidaProgramada: null };
  }
  const entradaProgramada = applyTimeToDate(fechaBase, turno.horaEntrada);
  let salidaProgramada = applyTimeToDate(fechaBase, turno.horaSalida);
  if (
    entradaProgramada &&
    salidaProgramada &&
    salidaProgramada.getTime() <= entradaProgramada.getTime()
  ) {
    salidaProgramada = addDays(salidaProgramada, 1);
    // Reaplicar hora sobre el día siguiente (addDays deja 00:00)
    salidaProgramada = applyTimeToDate(salidaProgramada, turno.horaSalida);
  }
  return { entradaProgramada, salidaProgramada };
}

function buildRecordatorios({
  fechaYmd,
  entradaProgramada,
  salidaProgramada,
  turnoNombre,
  minutosAntesEntrada,
  minutosAntesSalida,
  ahora = new Date()
}) {
  const out = [];
  const nombre = turnoNombre || 'tu turno';

  if (entradaProgramada) {
    const at = addMinutes(entradaProgramada, -minutosAntesEntrada);
    if (at.getTime() > ahora.getTime() - 60_000) {
      out.push({
        id: `entrada-${fechaYmd}`,
        tipo: 'entrada',
        at: at.toISOString(),
        programada: entradaProgramada.toISOString(),
        minutosAntes: minutosAntesEntrada,
        titulo: 'Recordatorio de entrada',
        cuerpo: `En ${minutosAntesEntrada} min inicia ${nombre} (${turnoHora(entradaProgramada)}). No olvides checar.`
      });
    }
  }

  if (salidaProgramada) {
    const at = addMinutes(salidaProgramada, -minutosAntesSalida);
    if (at.getTime() > ahora.getTime() - 60_000) {
      out.push({
        id: `salida-${fechaYmd}`,
        tipo: 'salida',
        at: at.toISOString(),
        programada: salidaProgramada.toISOString(),
        minutosAntes: minutosAntesSalida,
        titulo: 'Recordatorio de salida',
        cuerpo: `En ${minutosAntesSalida} min termina ${nombre} (${turnoHora(salidaProgramada)}). Registra tu salida.`
      });
    }
  }

  return out;
}

function turnoHora(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string|object} opts.empleadoId
 * @param {number} [opts.dias=7]
 * @param {number} [opts.minutosAntesEntrada]
 * @param {number} [opts.minutosAntesSalida]
 */
async function buildHorarioRecordatorios({
  tenantId,
  empleadoId,
  dias = DIAS_ADELANTE_DEFAULT,
  minutosAntesEntrada = MINUTOS_ANTES_ENTRADA,
  minutosAntesSalida = MINUTOS_ANTES_SALIDA
} = {}) {
  const Empleado = await getEmpleadoModel();
  const empleado = await Empleado.findOne({ _id: empleadoId, tenantId })
    .select('turnoId firstName lastName numEmpleado')
    .lean();
  if (!empleado) {
    const err = new Error('Empleado no encontrado');
    err.status = 404;
    throw err;
  }

  const ahora = new Date();
  const diasNum = Math.min(21, Math.max(1, Number(dias) || DIAS_ADELANTE_DEFAULT));
  const minEnt = Math.max(0, Number(minutosAntesEntrada) || MINUTOS_ANTES_ENTRADA);
  const minSal = Math.max(0, Number(minutosAntesSalida) || MINUTOS_ANTES_SALIDA);

  const lista = [];
  const todosRecordatorios = [];

  for (let i = 0; i < diasNum; i += 1) {
    const fecha = addDays(ahora, i);
    const fechaYmd = ymdLocal(fecha);
    const resolved = await resolveTurnoVigente(tenantId, empleado, fecha);
    const turno = resolved.turno || null;
    const esDescanso = Boolean(resolved.esDescansoForzado) || !turno;

    let entradaProgramada = null;
    let salidaProgramada = null;
    let recordatorios = [];

    if (!esDescanso && turno) {
      const prog = programacionDelDia(fecha, turno);
      entradaProgramada = prog.entradaProgramada;
      salidaProgramada = prog.salidaProgramada;
      recordatorios = buildRecordatorios({
        fechaYmd,
        entradaProgramada,
        salidaProgramada,
        turnoNombre: turno.nombre,
        minutosAntesEntrada: minEnt,
        minutosAntesSalida: minSal,
        ahora
      });
      todosRecordatorios.push(...recordatorios);
    }

    lista.push({
      fecha: fechaYmd,
      esDescanso,
      origen: resolved.origen || 'ninguno',
      turno: turno
        ? {
            id: String(turno._id),
            nombre: turno.nombre,
            tipo: turno.tipo,
            horaEntrada: turno.horaEntrada,
            horaSalida: turno.horaSalida,
            toleranciaEntradaMin: turno.toleranciaEntradaMin,
            toleranciaSalidaMin: turno.toleranciaSalidaMin
          }
        : null,
      entradaProgramada: entradaProgramada ? entradaProgramada.toISOString() : null,
      salidaProgramada: salidaProgramada ? salidaProgramada.toISOString() : null,
      recordatorios
    });
  }

  return {
    ok: true,
    generadoEn: ahora.toISOString(),
    zonaSugerida: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Mexico_City',
    preferencias: {
      minutosAntesEntrada: minEnt,
      minutosAntesSalida: minSal,
      diasAdelante: diasNum
    },
    empleado: {
      id: String(empleado._id),
      numEmpleado: empleado.numEmpleado || '',
      nombre: [empleado.firstName, empleado.lastName].filter(Boolean).join(' ').trim()
    },
    dias: lista,
    /** Lista plana para programar notificaciones locales / cola push */
    recordatorios: todosRecordatorios
  };
}

module.exports = {
  buildHorarioRecordatorios,
  programacionDelDia,
  MINUTOS_ANTES_ENTRADA,
  MINUTOS_ANTES_SALIDA,
  DIAS_ADELANTE_DEFAULT
};

'use strict';

/**
 * Horario programado + recordatorios de checada para app móvil.
 * Usa resolveTurnoVigente (override → rotación → turno fijo del empleado).
 */

const getEmpleadoModel = require('../models/empleado');
const { resolveTurnoVigente } = require('./turnoResolverService');
const { zonaDeSubsidiariaId } = require('./zonaHorariaService');
const {
  applyTimeToDate,
  ymdInTimeZone,
  ymdAncla,
  addDaysYmd,
  formatTimeHHMM,
  relojEnZona,
  DEFAULT_TZ
} = require('../libs/timeHelpers');

const MINUTOS_ANTES_ENTRADA = Number(process.env.RECORDATORIO_MINUTOS_ANTES_ENTRADA || 15);
const MINUTOS_ANTES_SALIDA = Number(process.env.RECORDATORIO_MINUTOS_ANTES_SALIDA || 10);
const DIAS_ADELANTE_DEFAULT = Number(process.env.RECORDATORIO_DIAS_ADELANTE || 7);

function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + Number(minutes || 0) * 60 * 1000);
}

/**
 * Entrada/salida Date para una fecha de jornada, en la zona de la subsidiaria.
 * Turno nocturno: si la salida de reloj es menor o igual que la entrada, cae al día siguiente.
 */
function programacionDelDia(fechaBase, turno, timeZone = DEFAULT_TZ) {
  if (!turno?.horaEntrada || !turno?.horaSalida) {
    return { entradaProgramada: null, salidaProgramada: null };
  }
  const entradaProgramada = applyTimeToDate(fechaBase, turno.horaEntrada, timeZone);
  let salidaProgramada = applyTimeToDate(fechaBase, turno.horaSalida, timeZone);
  if (
    entradaProgramada &&
    salidaProgramada &&
    salidaProgramada.getTime() <= entradaProgramada.getTime()
  ) {
    const siguiente = addDaysYmd(ymdAncla(fechaBase, timeZone), 1);
    const anclaSiguiente = new Date(`${siguiente}T12:00:00.000Z`);
    salidaProgramada = applyTimeToDate(anclaSiguiente, turno.horaSalida, timeZone);
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
  timeZone = DEFAULT_TZ,
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
        cuerpo: `En ${minutosAntesEntrada} min inicia ${nombre} (${formatTimeHHMM(entradaProgramada, timeZone)}). No olvides checar.`,
        hora: formatTimeHHMM(entradaProgramada, timeZone),
        zonaHoraria: timeZone
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
        cuerpo: `En ${minutosAntesSalida} min termina ${nombre} (${formatTimeHHMM(salidaProgramada, timeZone)}). Registra tu salida.`,
        hora: formatTimeHHMM(salidaProgramada, timeZone),
        zonaHoraria: timeZone
      });
    }
  }

  return out;
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
    .select('turnoId firstName lastName numEmpleado subsidiariaId')
    .lean();
  if (!empleado) {
    const err = new Error('Empleado no encontrado');
    err.status = 404;
    throw err;
  }

  const ahora = new Date();
  const zona = await zonaDeSubsidiariaId(empleado.subsidiariaId);
  const diasNum = Math.min(21, Math.max(1, Number(dias) || DIAS_ADELANTE_DEFAULT));
  const minEnt = Math.max(0, Number(minutosAntesEntrada) || MINUTOS_ANTES_ENTRADA);
  const minSal = Math.max(0, Number(minutosAntesSalida) || MINUTOS_ANTES_SALIDA);

  const lista = [];
  const todosRecordatorios = [];

  let fechaYmd = ymdInTimeZone(ahora, zona);
  for (let i = 0; i < diasNum; i += 1) {
    const fecha = new Date(`${fechaYmd}T12:00:00.000Z`);
    const resolved = await resolveTurnoVigente(tenantId, empleado, fecha);
    const turno = resolved.turno || null;
    const esDescanso = Boolean(resolved.esDescansoForzado) || !turno;

    let entradaProgramada = null;
    let salidaProgramada = null;
    let recordatorios = [];

    if (!esDescanso && turno) {
      const prog = programacionDelDia(fecha, turno, zona);
      entradaProgramada = prog.entradaProgramada;
      salidaProgramada = prog.salidaProgramada;
      recordatorios = buildRecordatorios({
        fechaYmd,
        entradaProgramada,
        salidaProgramada,
        turnoNombre: turno.nombre,
        minutosAntesEntrada: minEnt,
        minutosAntesSalida: minSal,
        timeZone: zona,
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
      entradaHora: entradaProgramada ? formatTimeHHMM(entradaProgramada, zona) : null,
      salidaHora: salidaProgramada ? formatTimeHHMM(salidaProgramada, zona) : null,
      recordatorios
    });
    fechaYmd = addDaysYmd(fechaYmd, 1);
  }

  return {
    ok: true,
    generadoEn: ahora.toISOString(),
    zonaHoraria: zona,
    reloj: relojEnZona(ahora, zona),
    zonaSugerida: zona,
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

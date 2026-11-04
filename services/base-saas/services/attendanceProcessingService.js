'use strict';

const getEmpleadoModel = require('../models/empleado');
const getAttendanceRecordModel = require('../models/attendanceRecord');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const { applyTimeToDate, minutesDiff, startOfDay, endOfDay, ymdAncla, ymdInTimeZone, addDaysYmd, DEFAULT_TZ } = require('../libs/timeHelpers');
const { zonaDeSubsidiariaId } = require('./zonaHorariaService');
const { isTimestampInHolgura } = require('../libs/turnoHelpers');
const { shouldQualifyAttendance } = require('../libs/empleadoHelpers');
const { syncAutomaticIncidencias } = require('./incidenciasAutoSync');
const { resolveTurnoVigente } = require('./turnoResolverService');
const { clasificarMinutosDia } = require('../libs/horasExtraClasificacion');
const { resolveEsquemaJornada } = require('../libs/esquemaJornada');

function isDiaLaborable(turno, fecha) {
  // Ancla laboral (medianoche o mediodía UTC): el día de semana UTC es el del calendario.
  const day = new Date(fecha).getUTCDay();
  if (turno.descansaDomingo && day === 0) return false;
  if (turno.descansaSabado && day === 6) return false;
  if (Array.isArray(turno.diasLaborables) && turno.diasLaborables.length > 0) {
    return turno.diasLaborables.includes(day);
  }
  return true;
}

function slotsEsperados(turno) {
  if (turno?.comidaChecada) return ['entrada', 'salida_comida', 'regreso_comida', 'salida'];
  return ['entrada', 'salida'];
}

function claveChecada(rec) {
  return String(rec._id || `${rec.tipoMarcacion}|${new Date(rec.timestamp).getTime()}`);
}

/**
 * Cruza las checadas con los huecos del turno.
 * Primero respeta el tipo (entrada, salida, comida). Si falta un hueco,
 * usa las checadas sobrantes en orden: la primera cierra la entrada y la última la salida.
 */
function asignarChecadas(records, slots) {
  const sorted = [...records].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
  const result = {};
  const used = new Set();
  const take = (slot, rec) => {
    if (!rec || result[slot]) return;
    result[slot] = rec;
    used.add(claveChecada(rec));
  };

  for (const slot of slots) {
    const ofType = sorted.filter((r) => r.tipoMarcacion === slot);
    if (ofType.length) take(slot, ofType[ofType.length - 1]);
  }

  if (
    result.entrada &&
    result.salida &&
    new Date(result.entrada.timestamp) > new Date(result.salida.timestamp)
  ) {
    used.delete(claveChecada(result.salida));
    delete result.salida;
  }

  if (!result.salida && result.entrada && sorted.length >= 2) {
    const last = sorted[sorted.length - 1];
    const first = sorted[0];
    if (claveChecada(last) === claveChecada(result.entrada) && claveChecada(first) !== claveChecada(last)) {
      used.delete(claveChecada(result.entrada));
      result.salida = last;
      result.entrada = first;
      used.add(claveChecada(first));
      used.add(claveChecada(last));
    }
  }

  const entre = sorted.filter((r) => {
    if (used.has(claveChecada(r))) return false;
    if (result.entrada && new Date(r.timestamp) <= new Date(result.entrada.timestamp)) return false;
    if (result.salida && new Date(r.timestamp) >= new Date(result.salida.timestamp)) return false;
    return true;
  });
  let cursor = 0;
  for (const slot of slots) {
    if (slot === 'entrada' || slot === 'salida' || result[slot]) continue;
    if (cursor < entre.length) take(slot, entre[cursor++]);
  }

  if (!result.salida) {
    const despues = sorted.filter(
      (r) =>
        !used.has(claveChecada(r)) &&
        (!result.entrada || new Date(r.timestamp) > new Date(result.entrada.timestamp))
    );
    if (despues.length) take('salida', despues[despues.length - 1]);
  }
  if (!result.entrada && sorted.length) {
    const antes = sorted.filter(
      (r) => !used.has(claveChecada(r)) && (!result.salida || new Date(r.timestamp) < new Date(result.salida.timestamp))
    );
    if (antes.length) take('entrada', antes[0]);
  }

  return result;
}

function minutosJornada(entrada, salida, salidaComida, regresoComida) {
  if (!entrada || !salida) return 0;
  let min = minutesDiff(salida, entrada);
  if (salidaComida && regresoComida) {
    min -= Math.max(0, minutesDiff(regresoComida, salidaComida));
  }
  return Math.max(0, min);
}

function textoJornada(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function diaLaboralEsHoy(fecha, timeZone) {
  return ymdAncla(fecha, timeZone) === ymdInTimeZone(new Date(), timeZone);
}

function computeRetardoMinutos(diffEntrada, toleranciaMin, modoTolerancia) {
  if (diffEntrada <= toleranciaMin) return 0;
  if (modoTolerancia === 'concorte') {
    return diffEntrada - toleranciaMin;
  }
  return diffEntrada;
}

/**
 * Clasifica minutos de salida tarde / HE según LFT:
 * - Offset del turno (inicioHEOrdinariaMin) no cuenta como HE.
 * - Primeras 3 h del día → dobles (pago ×2).
 * - Excedente del día → triples (pago ×3).
 * El tope semanal de 9 h se aplica al agregar el período (prenómina / bridge).
 */
function splitHorasExtra(minutosExtraTotal, turno) {
  if (minutosExtraTotal <= 0) {
    return { minutosHEOrdinaria: 0, minutosHEDoble: 0, minutosHETriple: 0, minutosHorasExtra: 0 };
  }

  const offset = turno?.inicioHEOrdinariaMin ?? 0;
  const extra = Math.max(0, minutosExtraTotal - offset);
  if (extra <= 0) {
    return { minutosHEOrdinaria: 0, minutosHEDoble: 0, minutosHETriple: 0, minutosHorasExtra: 0 };
  }

  const { minutosDobles, minutosTriples } = clasificarMinutosDia(extra, turno);
  return {
    minutosHEOrdinaria: 0,
    minutosHEDoble: minutosDobles,
    minutosHETriple: minutosTriples,
    minutosHorasExtra: extra
  };
}

function computeUnqualifiedDaily(fecha, turno, records, empleado, timeZone = DEFAULT_TZ) {
  const laborable = turno ? isDiaLaborable(turno, fecha) : true;
  const entrada = records[0]?.timestamp || null;
  const salida = records[records.length - 1]?.timestamp || null;

  let estatus = 'incompleto';
  if (!laborable) estatus = 'descanso';
  else if (!records.length) estatus = 'falta';

  return {
    entradaProgramada: turno ? applyTimeToDate(fecha, turno.horaEntrada, timeZone) : null,
    salidaProgramada: turno ? applyTimeToDate(fecha, turno.horaSalida, timeZone) : null,
    entradaReal: entrada,
    salidaComida: null,
    regresoComida: null,
    salidaReal: salida,
    minutosRetardo: 0,
    minutosSalidaAnticipada: 0,
    minutosHorasExtra: 0,
    minutosHEOrdinaria: 0,
    minutosHEDoble: 0,
    minutosHETriple: 0,
    estatus,
    incidenciasAutomaticas: [],
    marcajesFueraDeRango: false,
    excedeLimiteDiario: false,
    notas: `Sin calificación automática (tipo registro: ${empleado.tipoRegistro || 'ninguno'})`
  };
}

function computeDailyMetrics(turno, fechaInput, records, empleado, timeZone = DEFAULT_TZ) {
  const fecha = startOfDay(fechaInput);
  if (!shouldQualifyAttendance(empleado)) {
    return computeUnqualifiedDaily(fecha, turno, records, empleado, timeZone);
  }

  const slots = slotsEsperados(turno);
  const asignados = asignarChecadas(records, slots);
  const entrada = asignados.entrada || null;
  const salidaComida = asignados.salida_comida || null;
  const regresoComida = asignados.regreso_comida || null;
  const salida = asignados.salida || null;
  const faltanSlots = slots.filter((slot) => !asignados[slot]);

  const countTipo = (tipo) => records.filter((r) => r.tipoMarcacion === tipo).length;
  const multiEntrada = countTipo('entrada') > 1;
  const multiSalida = countTipo('salida') > 1;

  const entradaProgramada = turno ? applyTimeToDate(fecha, turno.horaEntrada, timeZone) : null;
  const salidaProgramada = turno ? applyTimeToDate(fecha, turno.horaSalida, timeZone) : null;
  const holguraAntes = turno?.holguraAntesMin ?? 180;
  const holguraDespues = turno?.holguraDespuesMin ?? 180;
  const modoTolerancia = turno?.modoTolerancia || 'normal';

  let minutosRetardo = 0;
  let minutosSalidaAnticipada = 0;
  let minutosHorasExtra = 0;
  let minutosHEOrdinaria = 0;
  let minutosHEDoble = 0;
  let minutosHETriple = 0;
  let incidencias = [];
  let marcajesFueraDeRango = false;

  if (multiEntrada) incidencias.push('MULT_ENT');
  if (multiSalida) incidencias.push('MULT_SAL');

  const entradaEnHolgura = Boolean(
    turno &&
      entrada?.timestamp &&
      isTimestampInHolgura(
        entrada.timestamp,
        fecha,
        turno.horaEntrada,
        holguraAntes,
        holguraDespues,
        timeZone
      )
  );
  const salidaEnHolgura = Boolean(
    turno &&
      salida?.timestamp &&
      isTimestampInHolgura(
        salida.timestamp,
        fecha,
        turno.horaSalida,
        holguraAntes,
        holguraDespues,
        timeZone
      )
  );

  if (turno && entrada?.timestamp && !entradaEnHolgura) {
    incidencias.push('FR');
    marcajesFueraDeRango = true;
  }
  if (turno && salida?.timestamp && !salidaEnHolgura) {
    if (!incidencias.includes('FR')) incidencias.push('FR');
    marcajesFueraDeRango = true;
  }

  if (turno && entradaEnHolgura && entradaProgramada) {
    const diff = minutesDiff(entrada.timestamp, entradaProgramada);
    minutosRetardo = computeRetardoMinutos(diff, turno.toleranciaEntradaMin || 0, modoTolerancia);
    if (minutosRetardo > 0) incidencias.push('RET');
  }

  if (turno && salidaEnHolgura && salidaProgramada) {
    const diffSalida = minutesDiff(salida.timestamp, salidaProgramada);
    if (diffSalida < -(turno.toleranciaSalidaMin || 0)) {
      minutosSalidaAnticipada = Math.abs(diffSalida) - (turno.toleranciaSalidaMin || 0);
      if (minutosSalidaAnticipada > 0) incidencias.push('SA');
    }
    if (diffSalida > 0) {
      const he = splitHorasExtra(diffSalida, turno);
      minutosHorasExtra = he.minutosHorasExtra;
      minutosHEOrdinaria = he.minutosHEOrdinaria;
      minutosHEDoble = he.minutosHEDoble;
      minutosHETriple = he.minutosHETriple;
      if (minutosHEOrdinaria > 0) incidencias.push('HEO');
      if (minutosHEDoble > 0) incidencias.push('HED');
      if (minutosHETriple > 0) incidencias.push('HEF');
    }
  }

  const laborable = turno ? isDiaLaborable(turno, fecha) : true;
  const enCurso = diaLaboralEsHoy(fecha, timeZone) && entrada && !salida;
  const trabajados = minutosJornada(
    entrada?.timestamp,
    salida?.timestamp,
    salidaComida?.timestamp,
    regresoComida?.timestamp
  );
  let estatus = 'falta';
  const notasChecada = [];

  if (!laborable && !records.length) {
    estatus = 'descanso';
  } else if (!records.length) {
    estatus = 'falta';
    incidencias.push('FI');
  } else if (faltanSlots.length === 0) {
    if (turno && marcajesFueraDeRango && (!entradaEnHolgura || !salidaEnHolgura)) {
      estatus = 'fuera_de_rango';
    } else {
      estatus = minutosRetardo > 0 ? 'retardo' : 'presente';
    }
  } else if (turno?.comidaChecada && entrada && salida) {
    estatus = 'registro_parcial';
    if (!incidencias.includes('RP')) incidencias.push('RP');
    minutosHorasExtra = 0;
    minutosHEOrdinaria = 0;
    minutosHEDoble = 0;
    minutosHETriple = 0;
    incidencias = incidencias.filter((c) => !['HEO', 'HED', 'HEF'].includes(c));
    notasChecada.push(`Faltan checadas de comida (el turno pide ${slots.length})`);
  } else if (entrada && !salida) {
    estatus = 'incompleto';
    notasChecada.push(enCurso ? 'En curso: falta la salida' : 'Falta la salida');
  } else if (!entrada && salida) {
    estatus = 'incompleto';
    notasChecada.push('Falta la entrada');
  } else {
    estatus = 'incompleto';
    notasChecada.push(`Faltan checadas (el turno pide ${slots.length}: ${faltanSlots.join(', ')})`);
  }

  if (!turno && records.length) {
    notasChecada.unshift('Sin turno asignado: se calificó con 2 checadas (entrada y salida)');
  }
  if (trabajados > 0 && entrada && salida) {
    notasChecada.push(`Jornada ${textoJornada(trabajados)}`);
  }

  const esquema = resolveEsquemaJornada(turno || {});
  const ordinariosProgMin = Math.round((esquema.horasJornada || 8) * 60);
  const excedeLimiteDiario =
    ordinariosProgMin + minutosHorasExtra > Math.round(esquema.maxHorasTotalesDia * 60);

  const notasMulti = [];
  if (multiSalida) {
    notasMulti.push(
      `Varias salidas activas (${countTipo('salida')}): se usa la última (${salida ? new Date(salida.timestamp).toISOString().slice(11, 16) : '—'}). Anula las demás si no aplican.`
    );
  }
  if (multiEntrada) {
    notasMulti.push(
      `Varias entradas activas (${countTipo('entrada')}): se usa la última. Anula duplicados si no aplican.`
    );
  }

  return {
    entradaProgramada,
    salidaProgramada,
    entradaReal: entrada?.timestamp || null,
    salidaComida: salidaComida?.timestamp || null,
    regresoComida: regresoComida?.timestamp || null,
    salidaReal: salida?.timestamp || null,
    minutosRetardo,
    minutosSalidaAnticipada,
    minutosHorasExtra,
    minutosHEOrdinaria,
    minutosHEDoble,
    minutosHETriple,
    estatus,
    incidenciasAutomaticas: [...new Set(incidencias)],
    marcajesFueraDeRango,
    excedeLimiteDiario,
    ...(notasMulti.length || notasChecada.length
      ? { notas: [...notasChecada, ...notasMulti].join(' · ') }
      : {})
  };
}

async function recalculateDailyAttendance(tenantId, empleadoId, fechaInput) {
  const fecha = startOfDay(fechaInput);
  const Empleado = await getEmpleadoModel();
  const AttendanceRecord = await getAttendanceRecordModel();
  const DailyAttendance = await getDailyAttendanceModel();

  const empleado = await Empleado.findOne({ _id: empleadoId, tenantId }).lean();
  if (!empleado) return null;

  const timeZone = await zonaDeSubsidiariaId(empleado.subsidiariaId);
  const resolved = await resolveTurnoVigente(tenantId, empleado, fecha);
  const { turno, esDescansoForzado, plantilla, asignacion } = resolved;

  const records = await AttendanceRecord.find({
    tenantId,
    empleadoId,
    fecha: { $gte: fecha, $lte: endOfDay(fecha) },
    // Legado sin campo estado = activa; anuladas no computan jornada
    $or: [{ estado: 'activa' }, { estado: { $exists: false } }, { estado: null }]
  })
    .sort({ timestamp: 1 })
    .lean();

  if (esDescansoForzado && !turno) {
    const daily = await DailyAttendance.findOneAndUpdate(
      { tenantId, empleadoId, fecha },
      {
        $set: {
          tenantId,
          empleadoId,
          fecha,
          turnoId: null,
          zonaHoraria: timeZone,
          estatus: 'descanso',
          incidenciasAutomaticas: [],
          minutosRetardo: 0,
          minutosSalidaAnticipada: 0,
          minutosHorasExtra: 0,
          minutosHEOrdinaria: 0,
          minutosHEDoble: 0,
          minutosHETriple: 0,
          marcajesFueraDeRango: false,
          notas: plantilla ? `Descanso — rotación: ${plantilla.nombre}` : 'Descanso por rotación'
        }
      },
      { upsert: true, new: true }
    ).lean();
    await syncAutomaticIncidencias(tenantId, empleado.empresaId, empleadoId, fecha, daily);
    return daily;
  }

  const metrics = computeDailyMetrics(turno, fecha, records, empleado, timeZone);
  if (resolved.origen === 'rotacion' && plantilla) {
    const rotNota = `Rotación: ${plantilla.nombre}${asignacion?.fechaAncla ? ` (ancla ${new Date(asignacion.fechaAncla).toLocaleDateString('es-MX')})` : ''}`;
    metrics.notas = metrics.notas ? `${rotNota} · ${metrics.notas}` : rotNota;
  }

  // Vacaciones aprobadas: no marcar falta si no checó
  if (metrics.estatus === 'falta' || metrics.incidenciasAutomaticas?.includes('FI')) {
    try {
      const { empleadoEnVacacionesAprobadas } = require('./calendarioLaboralService');
      if (await empleadoEnVacacionesAprobadas(tenantId, empleadoId, fecha)) {
        metrics.estatus = 'vacaciones';
        metrics.incidenciasAutomaticas = (metrics.incidenciasAutomaticas || []).filter(
          (c) => c !== 'FI'
        );
        if (!metrics.incidenciasAutomaticas.includes('VAC')) {
          metrics.incidenciasAutomaticas.push('VAC');
        }
        metrics.notas = metrics.notas
          ? `${metrics.notas} · De vacaciones`
          : 'De vacaciones (solicitud aprobada)';
      }
    } catch (e) {
      console.warn('[attendance] vacaciones check', e.message);
    }
  }

  // Una checada anulada no es jornada, pero tampoco es falta.
  if (!records.length && metrics.estatus === 'falta') {
    const anuladas = await AttendanceRecord.countDocuments({
      tenantId,
      empleadoId,
      fecha: { $gte: fecha, $lte: endOfDay(fecha) },
      estado: 'anulada'
    });
    if (anuladas > 0) {
      metrics.estatus = 'anulada';
      metrics.incidenciasAutomaticas = (metrics.incidenciasAutomaticas || []).filter(
        (c) => c !== 'FI'
      );
      metrics.notas = 'Checada anulada: no cuenta como falta';
    }
  }

  const daily = await DailyAttendance.findOneAndUpdate(
    { tenantId, empleadoId, fecha },
    {
      $set: {
        tenantId,
        empleadoId,
        fecha,
        turnoId: turno?._id || null,
        zonaHoraria: timeZone,
        ...metrics,
        notas: metrics.notas || ''
      }
    },
    { upsert: true, new: true }
  ).lean();

  await AttendanceRecord.updateMany(
    { tenantId, empleadoId, fecha: { $gte: fecha, $lte: endOfDay(fecha) } },
    { $set: { procesado: true } }
  );

  await syncAutomaticIncidencias(tenantId, empleado.empresaId, empleadoId, fecha, daily);

  try {
    const { syncRetardoDesdeDaily } = require('./asistenciaAutorizacionService');
    await syncRetardoDesdeDaily(tenantId, empleado, daily);
  } catch (err) {
    console.warn('[asistencia] syncRetardoDesdeDaily:', err.message);
  }

  return daily;
}

async function recalculateDayForTenant(tenantId, fechaInput, opts = {}) {
  const fecha = startOfDay(fechaInput);
  const Empleado = await getEmpleadoModel();
  const { scopeEmpleadosFilter } = require('../libs/tenantScope');
  const empQ = scopeEmpleadosFilter({
    tenantId,
    empresaId: opts.empresaId || null,
    subsidiariaId: opts.subsidiariaId || null
  });
  const empleados = await Empleado.find(empQ).lean();

  const results = [];
  for (const empleado of empleados) {
    results.push(await recalculateDailyAttendance(tenantId, empleado._id, fecha));
  }
  return results;
}

/**
 * Crea el día de descanso cuando el turno (o la rotación) no labora
 * y todavía no hay registro. No toca días que ya existen.
 */
async function completarDescansosRango(tenantId, empleadoIds, desdeYmd, hastaYmd) {
  if (!tenantId || !Array.isArray(empleadoIds) || !empleadoIds.length) return { creados: 0 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desdeYmd || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(hastaYmd || ''))) {
    return { creados: 0 };
  }
  const Empleado = await getEmpleadoModel();
  const DailyAttendance = await getDailyAttendanceModel();
  const empleados = await Empleado.find({
    tenantId,
    _id: { $in: empleadoIds },
    estatus: 'activo',
    activo: { $ne: false },
    tipoRegistro: { $ne: 'ninguno' }
  }).lean();

  let creados = 0;
  for (const empleado of empleados) {
    let ymd = desdeYmd;
    while (ymd && ymd <= hastaYmd) {
      const ancla = new Date(`${ymd}T12:00:00.000Z`);
      const existe = await DailyAttendance.exists({
        tenantId,
        empleadoId: empleado._id,
        fecha: {
          $gte: new Date(`${ymd}T00:00:00.000Z`),
          $lte: new Date(`${ymd}T23:59:59.999Z`)
        }
      });
      if (!existe) {
        const resolved = await resolveTurnoVigente(tenantId, empleado, ancla);
        const descanso = resolved.esDescansoForzado
          || (resolved.turno && !isDiaLaborable(resolved.turno, ancla));
        if (descanso) {
          await recalculateDailyAttendance(tenantId, empleado._id, ancla);
          creados += 1;
        }
      }
      ymd = addDaysYmd(ymd, 1);
    }
  }
  return { creados };
}

/** Reprocesa asistencia diaria día a día en un rango (marcaciones → daily_attendance). */
async function recalculateRangeForTenant(tenantId, fechaInicio, fechaFin, opts = {}) {
  let d = startOfDay(fechaInicio);
  const end = startOfDay(fechaFin);
  let dias = 0;
  let registros = 0;
  while (d <= end) {
    const dayResults = await recalculateDayForTenant(tenantId, d, opts);
    dias += 1;
    registros += dayResults.length;
    d = new Date(d.getTime() + 86400000);
  }
  return { dias, registros };
}

module.exports = {
  isDiaLaborable,
  computeRetardoMinutos,
  splitHorasExtra,
  computeDailyMetrics,
  recalculateDailyAttendance,
  recalculateDayForTenant,
  recalculateRangeForTenant,
  completarDescansosRango
};

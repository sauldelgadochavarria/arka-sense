'use strict';

const getEmpleadoModel = require('../models/empleado');
const getAttendanceRecordModel = require('../models/attendanceRecord');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const { applyTimeToDate, minutesDiff, startOfDay, endOfDay } = require('../libs/timeHelpers');
const { isTimestampInHolgura } = require('../libs/turnoHelpers');
const { shouldQualifyAttendance } = require('../libs/empleadoHelpers');
const { syncAutomaticIncidencias } = require('./incidenciasAutoSync');
const { resolveTurnoVigente } = require('./turnoResolverService');
const { clasificarMinutosDia } = require('../libs/horasExtraClasificacion');
const { resolveEsquemaJornada } = require('../libs/esquemaJornada');

function isDiaLaborable(turno, fecha) {
  const day = new Date(fecha).getDay();
  if (turno.descansaDomingo && day === 0) return false;
  if (turno.descansaSabado && day === 6) return false;
  if (Array.isArray(turno.diasLaborables) && turno.diasLaborables.length > 0) {
    return turno.diasLaborables.includes(day);
  }
  return true;
}

function pickLatest(records, tipo) {
  const filtered = records.filter((r) => r.tipoMarcacion === tipo);
  if (!filtered.length) return null;
  return filtered.reduce((latest, item) =>
    new Date(item.timestamp) > new Date(latest.timestamp) ? item : latest
  );
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

function computeUnqualifiedDaily(fecha, turno, records, empleado) {
  const laborable = turno ? isDiaLaborable(turno, fecha) : true;
  const entrada = records[0]?.timestamp || null;
  const salida = records[records.length - 1]?.timestamp || null;

  let estatus = 'incompleto';
  if (!laborable) estatus = 'descanso';
  else if (!records.length) estatus = 'falta';

  return {
    entradaProgramada: turno ? applyTimeToDate(fecha, turno.horaEntrada) : null,
    salidaProgramada: turno ? applyTimeToDate(fecha, turno.horaSalida) : null,
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

function computeDailyMetrics(turno, fechaInput, records, empleado) {
  const fecha = startOfDay(fechaInput);
  if (!shouldQualifyAttendance(empleado)) {
    return computeUnqualifiedDaily(fecha, turno, records, empleado);
  }

  const entrada = pickLatest(records, 'entrada');
  const salidaComida = pickLatest(records, 'salida_comida');
  const regresoComida = pickLatest(records, 'regreso_comida');
  const salida = pickLatest(records, 'salida');

  const countTipo = (tipo) => records.filter((r) => r.tipoMarcacion === tipo).length;
  const multiEntrada = countTipo('entrada') > 1;
  const multiSalida = countTipo('salida') > 1;

  const entradaProgramada = applyTimeToDate(fecha, turno.horaEntrada);
  const salidaProgramada = applyTimeToDate(fecha, turno.horaSalida);
  const holguraAntes = turno.holguraAntesMin ?? 180;
  const holguraDespues = turno.holguraDespuesMin ?? 180;
  const modoTolerancia = turno.modoTolerancia || 'normal';

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

  const entradaEnHolgura =
    entrada?.timestamp &&
    isTimestampInHolgura(entrada.timestamp, fecha, turno.horaEntrada, holguraAntes, holguraDespues);
  const salidaEnHolgura =
    salida?.timestamp &&
    isTimestampInHolgura(salida.timestamp, fecha, turno.horaSalida, holguraAntes, holguraDespues);

  if (entrada?.timestamp && !entradaEnHolgura) {
    incidencias.push('FR');
    marcajesFueraDeRango = true;
  }
  if (salida?.timestamp && !salidaEnHolgura) {
    if (!incidencias.includes('FR')) incidencias.push('FR');
    marcajesFueraDeRango = true;
  }

  if (entradaEnHolgura && entradaProgramada) {
    const diff = minutesDiff(entrada.timestamp, entradaProgramada);
    minutosRetardo = computeRetardoMinutos(diff, turno.toleranciaEntradaMin || 0, modoTolerancia);
    if (minutosRetardo > 0) incidencias.push('RET');
  }

  if (salidaEnHolgura && salidaProgramada) {
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

  const laborable = isDiaLaborable(turno, fecha);
  let estatus = 'falta';

  if (!laborable) {
    estatus = 'descanso';
  } else if (!entrada && !salida && !salidaComida && !regresoComida) {
    estatus = 'falta';
    incidencias.push('FI');
  } else if (turno.comidaChecada) {
    const completo = entrada && salidaComida && regresoComida && salida;
    const tieneAlguno = entrada || salidaComida || regresoComida || salida;
    if (tieneAlguno && !completo) {
      estatus = 'registro_parcial';
      if (!incidencias.includes('RP')) incidencias.push('RP');
      minutosHorasExtra = 0;
      minutosHEOrdinaria = 0;
      minutosHEDoble = 0;
      minutosHETriple = 0;
      incidencias = incidencias.filter((c) => !['HEO', 'HED', 'HEF'].includes(c));
    } else if (marcajesFueraDeRango && (!entradaEnHolgura || !salidaEnHolgura)) {
      estatus = 'fuera_de_rango';
    } else if (entrada && salida) {
      estatus = minutosRetardo > 0 ? 'retardo' : 'presente';
    } else {
      estatus = 'incompleto';
    }
  } else if (marcajesFueraDeRango && (!entradaEnHolgura || (salida && !salidaEnHolgura))) {
    estatus = 'fuera_de_rango';
  } else if (entrada && !salida) {
    estatus = 'incompleto';
  } else if (entrada && salida) {
    estatus = minutosRetardo > 0 ? 'retardo' : 'presente';
  } else if (entrada) {
    estatus = minutosRetardo > 0 ? 'retardo' : 'presente';
  }

  const esquema = resolveEsquemaJornada(turno);
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
    ...(notasMulti.length ? { notas: notasMulti.join(' ') } : {})
  };
}

async function recalculateDailyAttendance(tenantId, empleadoId, fechaInput) {
  const fecha = startOfDay(fechaInput);
  const Empleado = await getEmpleadoModel();
  const AttendanceRecord = await getAttendanceRecordModel();
  const DailyAttendance = await getDailyAttendanceModel();

  const empleado = await Empleado.findOne({ _id: empleadoId, tenantId }).lean();
  if (!empleado) return null;

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

  if (!turno) {
    const daily = await DailyAttendance.findOneAndUpdate(
      { tenantId, empleadoId, fecha },
      {
        $set: {
          tenantId,
          empleadoId,
          fecha,
          turnoId: null,
          estatus: records.length ? 'incompleto' : 'falta',
          incidenciasAutomaticas: records.length ? [] : ['FI'],
          notas: 'Sin turno asignado'
        }
      },
      { upsert: true, new: true }
    ).lean();
    await syncAutomaticIncidencias(tenantId, empleado.empresaId, empleadoId, fecha, daily);
    return daily;
  }

  const metrics = computeDailyMetrics(turno, fecha, records, empleado);
  if (resolved.origen === 'rotacion' && plantilla) {
    const rotNota = `Rotación: ${plantilla.nombre}${asignacion?.fechaAncla ? ` (ancla ${new Date(asignacion.fechaAncla).toLocaleDateString('es-MX')})` : ''}`;
    metrics.notas = metrics.notas ? `${rotNota} · ${metrics.notas}` : rotNota;
  }

  const daily = await DailyAttendance.findOneAndUpdate(
    { tenantId, empleadoId, fecha },
    {
      $set: {
        tenantId,
        empleadoId,
        fecha,
        turnoId: turno._id,
        ...metrics
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

async function recalculateDayForTenant(tenantId, fechaInput) {
  const fecha = startOfDay(fechaInput);
  const Empleado = await getEmpleadoModel();
  const empleados = await Empleado.find({ tenantId, estatus: 'activo', activo: true }).lean();

  const results = [];
  for (const empleado of empleados) {
    results.push(await recalculateDailyAttendance(tenantId, empleado._id, fecha));
  }
  return results;
}

/** Reprocesa asistencia diaria día a día en un rango (marcaciones → daily_attendance). */
async function recalculateRangeForTenant(tenantId, fechaInicio, fechaFin) {
  let d = startOfDay(fechaInicio);
  const end = startOfDay(fechaFin);
  let dias = 0;
  let registros = 0;
  while (d <= end) {
    const dayResults = await recalculateDayForTenant(tenantId, d);
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
  recalculateRangeForTenant
};

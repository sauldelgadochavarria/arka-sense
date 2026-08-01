'use strict';

const getEmpleadoModel = require('../models/empleado');
const getAttendanceRecordModel = require('../models/attendanceRecord');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const { applyTimeToDate, minutesDiff, startOfDay, endOfDay } = require('../libs/timeHelpers');
const { isTimestampInHolgura } = require('../libs/turnoHelpers');
const { shouldQualifyAttendance } = require('../libs/empleadoHelpers');
const { syncAutomaticIncidencias } = require('./incidenciasAutoSync');
const { resolveTurnoVigente } = require('./turnoResolverService');

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

function splitHorasExtra(minutosExtraTotal, turno) {
  if (minutosExtraTotal <= 0) {
    return { minutosHEOrdinaria: 0, minutosHEDoble: 0, minutosHETriple: 0, minutosHorasExtra: 0 };
  }

  const offset = turno.inicioHEOrdinariaMin ?? 0;
  let extra = Math.max(0, minutosExtraTotal - offset);
  if (extra <= 0) {
    return { minutosHEOrdinaria: 0, minutosHEDoble: 0, minutosHETriple: 0, minutosHorasExtra: 0 };
  }

  const umbralDoble = turno.inicioHEDobleMin;
  const umbralTriple = turno.inicioHETripleMin;

  let ordinaria = 0;
  let doble = 0;
  let triple = 0;

  if (umbralDoble == null) {
    ordinaria = extra;
  } else if (extra <= umbralDoble) {
    ordinaria = extra;
  } else {
    ordinaria = umbralDoble;
    const rest = extra - umbralDoble;
    if (umbralTriple == null) {
      doble = rest;
    } else {
      const rangoDoble = Math.max(0, umbralTriple - umbralDoble);
      doble = Math.min(rest, rangoDoble);
      triple = Math.max(0, rest - rangoDoble);
    }
  }

  return {
    minutosHEOrdinaria: ordinaria,
    minutosHEDoble: doble,
    minutosHETriple: triple,
    minutosHorasExtra: ordinaria + doble + triple
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
    marcajesFueraDeRango
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
    fecha: { $gte: fecha, $lte: endOfDay(fecha) }
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
    metrics.notas = `Rotación: ${plantilla.nombre}${asignacion?.fechaAncla ? ` (ancla ${new Date(asignacion.fechaAncla).toLocaleDateString('es-MX')})` : ''}`;
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

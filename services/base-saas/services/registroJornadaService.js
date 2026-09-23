'use strict';

const getEmpleadoModel = require('../models/empleado');
const getTurnoModel = require('../models/turno');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const getTipoPeriodoNominaModel = require('../models/tipoPeriodoNomina');
const { startOfDay, endOfDay, minutesDiff, formatTimeHHMM } = require('../libs/timeHelpers');
const { weekKey, clasificarHorasExtraPeriodo } = require('../libs/horasExtraClasificacion');
const { resolveEsquemaJornada, ESQUEMA_JORNADA_DEFAULTS } = require('../libs/esquemaJornada');
const { normalizeWeekday } = require('../libs/calendarioPeriodo');

function minutosEfectivos(daily) {
  if (!daily?.entradaReal || !daily?.salidaReal) return 0;
  let total = minutesDiff(daily.salidaReal, daily.entradaReal);
  if (daily.salidaComida && daily.regresoComida) {
    total -= minutesDiff(daily.regresoComida, daily.salidaComida);
  }
  return Math.max(0, total);
}

function minutosOrdinarios(efectivos, he) {
  return Math.max(0, (Number(efectivos) || 0) - (Number(he) || 0));
}

function semaforoOrdinarias(horasOrdinarias, maxOrdinarias) {
  const h = Number(horasOrdinarias) || 0;
  const max = Number(maxOrdinarias) || ESQUEMA_JORNADA_DEFAULTS.maxHorasOrdinariasSemana;
  if (h > max + 0.01) return 'alert';
  if (h > max * 0.95) return 'warn';
  return 'ok';
}

/**
 * Armado de registro de jornada (REJL) + semáforos 46 h / 12 h.
 */
async function buildRegistroJornada(tenantId, { fechaInicio, fechaFin, empleadoId = null } = {}) {
  const fi = startOfDay(fechaInicio);
  const ff = endOfDay(fechaFin);
  const Empleado = await getEmpleadoModel();
  const Turno = await getTurnoModel();
  const DailyAttendance = await getDailyAttendanceModel();
  const TipoPeriodo = await getTipoPeriodoNominaModel();

  const empFilter = { tenantId, estatus: 'activo' };
  if (empleadoId) empFilter._id = empleadoId;
  const empleados = await Empleado.find(empFilter).sort({ lastName: 1, firstName: 1 }).lean();
  const empIds = empleados.map((e) => e._id);
  const turnoIds = [...new Set(empleados.map((e) => e.turnoId).filter(Boolean).map(String))];
  const turnos = turnoIds.length
    ? await Turno.find({ _id: { $in: turnoIds }, tenantId }).lean()
    : [];
  const turnoMap = new Map(turnos.map((t) => [String(t._id), t]));

  const tipoIds = [...new Set(empleados.map((e) => e.tipoPeriodoId).filter(Boolean).map(String))];
  const tipos = tipoIds.length
    ? await TipoPeriodo.find({ _id: { $in: tipoIds }, tenantId }).lean()
    : [];
  const tipoMap = new Map(tipos.map((t) => [String(t._id), t]));

  const empMap = new Map(
    empleados.map((e) => {
      const turno = e.turnoId ? turnoMap.get(String(e.turnoId)) : null;
      const tipoPer = e.tipoPeriodoId ? tipoMap.get(String(e.tipoPeriodoId)) : null;
      const esquema = resolveEsquemaJornada(turno);
      const weekStartsOn = normalizeWeekday(tipoPer?.diaInicioSemana, 1);
      return [
        String(e._id),
        {
          _id: e._id,
          numEmpleado: e.numEmpleado,
          nombre: `${e.firstName || ''} ${e.lastName || ''}`.trim(),
          turnoId: e.turnoId || null,
          esquema,
          weekStartsOn,
          sinTurno: !turno
        }
      ];
    })
  );

  if (!empIds.length) {
    return {
      filas: [],
      semanas: [],
      empleados: [],
      resumenTopes: { alertas46: 0, alertas12: 0, sinTurno: 0 },
      fechaInicio: fi,
      fechaFin: ff
    };
  }

  const diarios = await DailyAttendance.find({
    tenantId,
    empleadoId: { $in: empIds },
    fecha: { $gte: fi, $lte: ff }
  })
    .sort({ fecha: 1, empleadoId: 1 })
    .lean();

  const filas = diarios.map((d) => {
    const emp = empMap.get(String(d.empleadoId)) || {
      numEmpleado: '—',
      nombre: '—',
      esquema: resolveEsquemaJornada(null),
      weekStartsOn: 1,
      sinTurno: true
    };
    const efectivos = minutosEfectivos(d);
    const he = Number(d.minutosHorasExtra) || 0;
    const ordinarios = minutosOrdinarios(efectivos, he);
    const maxDia = emp.esquema.maxHorasTotalesDia;
    const excede12 =
      Boolean(d.excedeLimiteDiario) || efectivos / 60 > maxDia + 0.01;
    return {
      empleadoId: d.empleadoId,
      numEmpleado: emp.numEmpleado,
      nombre: emp.nombre,
      fecha: d.fecha,
      week: weekKey(d.fecha, { weekStartsOn: emp.weekStartsOn }),
      weekStartsOn: emp.weekStartsOn,
      entrada: d.entradaReal || null,
      salidaComida: d.salidaComida || null,
      regresoComida: d.regresoComida || null,
      salida: d.salidaReal || null,
      entradaFmt: d.entradaReal ? formatTimeHHMM(d.entradaReal) : '—',
      salidaComidaFmt: d.salidaComida ? formatTimeHHMM(d.salidaComida) : '—',
      regresoComidaFmt: d.regresoComida ? formatTimeHHMM(d.regresoComida) : '—',
      salidaFmt: d.salidaReal ? formatTimeHHMM(d.salidaReal) : '—',
      minutosEfectivos: efectivos,
      minutosOrdinarios: ordinarios,
      minutosHE: he,
      minutosHEDoble: Number(d.minutosHEDoble) || 0,
      minutosHETriple: Number(d.minutosHETriple) || 0,
      estatus: d.estatus || '',
      excedeLimiteDiario: excede12,
      maxHorasTotalesDia: maxDia,
      sinTurno: emp.sinTurno
    };
  });

  const byEmpWeek = new Map();
  for (const f of filas) {
    const key = `${f.empleadoId}|${f.week}`;
    if (!byEmpWeek.has(key)) {
      const emp = empMap.get(String(f.empleadoId));
      byEmpWeek.set(key, {
        empleadoId: f.empleadoId,
        numEmpleado: f.numEmpleado,
        nombre: f.nombre,
        week: f.week,
        weekStartsOn: f.weekStartsOn,
        dias: [],
        minutosEfectivos: 0,
        minutosOrdinarios: 0,
        minutosHE: 0,
        diasExcede12: 0,
        maxHorasOrdinariasSemana:
          emp?.esquema?.maxHorasOrdinariasSemana ||
          ESQUEMA_JORNADA_DEFAULTS.maxHorasOrdinariasSemana,
        sinTurno: Boolean(emp?.sinTurno)
      });
    }
    const bucket = byEmpWeek.get(key);
    bucket.dias.push({
      fecha: f.fecha,
      minutosExtra: f.minutosHE,
      minutosOrdinarios: f.minutosOrdinarios
    });
    bucket.minutosEfectivos += f.minutosEfectivos;
    bucket.minutosOrdinarios += f.minutosOrdinarios;
    bucket.minutosHE += f.minutosHE;
    if (f.excedeLimiteDiario) bucket.diasExcede12 += 1;
  }

  const semanas = [...byEmpWeek.values()].map((b) => {
    const emp = empMap.get(String(b.empleadoId));
    const turno = emp?.turnoId ? turnoMap.get(String(emp.turnoId)) : null;
    const heClass = clasificarHorasExtraPeriodo(b.dias, turno, {
      weekStartsOn: b.weekStartsOn
    });
    const horasOrdinarias = Math.round((b.minutosOrdinarios / 60) * 100) / 100;
    const maxOrd = b.maxHorasOrdinariasSemana;
    const sem = semaforoOrdinarias(horasOrdinarias, maxOrd);
    return {
      ...b,
      heDoblesSemana: heClass.minutosDobles || 0,
      heTriplesSemana: heClass.minutosTriples || 0,
      horasEfectivas: Math.round((b.minutosEfectivos / 60) * 100) / 100,
      horasOrdinarias,
      horasHE: Math.round((b.minutosHE / 60) * 100) / 100,
      maxHorasOrdinariasSemana: maxOrd,
      semaforo46: sem,
      excede46: sem === 'alert',
      excedeLimiteDiario: b.diasExcede12 > 0 || Boolean(heClass.excedeLimiteDiario)
    };
  });
  semanas.sort((a, b) =>
    a.week === b.week
      ? String(a.nombre).localeCompare(String(b.nombre))
      : String(a.week).localeCompare(String(b.week))
  );

  const resumenTopes = {
    alertas46: semanas.filter((s) => s.excede46).length,
    alertas12: filas.filter((f) => f.excedeLimiteDiario).length,
    sinTurno: [...empMap.values()].filter((e) => e.sinTurno).length
  };

  return {
    filas,
    semanas,
    empleados: [...empMap.values()],
    resumenTopes,
    fechaInicio: fi,
    fechaFin: ff
  };
}

module.exports = {
  buildRegistroJornada,
  minutosEfectivos,
  semaforoOrdinarias
};

'use strict';

const getEmpleadoModel = require('../models/empleado');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const { startOfDay, endOfDay, minutesDiff, formatTimeHHMM } = require('../libs/timeHelpers');
const { weekKey, clasificarHorasExtraPeriodo } = require('../libs/horasExtraClasificacion');

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

/**
 * Armado de registro de jornada (REJL corto plazo) a partir de daily_attendance.
 */
async function buildRegistroJornada(tenantId, { fechaInicio, fechaFin, empleadoId = null } = {}) {
  const fi = startOfDay(fechaInicio);
  const ff = endOfDay(fechaFin);
  const Empleado = await getEmpleadoModel();
  const DailyAttendance = await getDailyAttendanceModel();

  const empFilter = { tenantId, estatus: 'activo' };
  if (empleadoId) empFilter._id = empleadoId;
  const empleados = await Empleado.find(empFilter).sort({ lastName: 1, firstName: 1 }).lean();
  const empIds = empleados.map((e) => e._id);
  const empMap = new Map(
    empleados.map((e) => [
      String(e._id),
      {
        _id: e._id,
        numEmpleado: e.numEmpleado,
        nombre: `${e.firstName || ''} ${e.lastName || ''}`.trim()
      }
    ])
  );

  if (!empIds.length) {
    return { filas: [], semanas: [], empleados: [], fechaInicio: fi, fechaFin: ff };
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
      nombre: '—'
    };
    const efectivos = minutosEfectivos(d);
    const he = Number(d.minutosHorasExtra) || 0;
    return {
      empleadoId: d.empleadoId,
      numEmpleado: emp.numEmpleado,
      nombre: emp.nombre,
      fecha: d.fecha,
      week: weekKey(d.fecha),
      entrada: d.entradaReal || null,
      salidaComida: d.salidaComida || null,
      regresoComida: d.regresoComida || null,
      salida: d.salidaReal || null,
      entradaFmt: d.entradaReal ? formatTimeHHMM(d.entradaReal) : '—',
      salidaComidaFmt: d.salidaComida ? formatTimeHHMM(d.salidaComida) : '—',
      regresoComidaFmt: d.regresoComida ? formatTimeHHMM(d.regresoComida) : '—',
      salidaFmt: d.salidaReal ? formatTimeHHMM(d.salidaReal) : '—',
      minutosEfectivos: efectivos,
      minutosOrdinarios: minutosOrdinarios(efectivos, he),
      minutosHE: he,
      minutosHEDoble: Number(d.minutosHEDoble) || 0,
      minutosHETriple: Number(d.minutosHETriple) || 0,
      estatus: d.estatus || ''
    };
  });

  // Acumulado semanal por empleado
  const byEmpWeek = new Map();
  for (const f of filas) {
    const key = `${f.empleadoId}|${f.week}`;
    if (!byEmpWeek.has(key)) {
      byEmpWeek.set(key, {
        empleadoId: f.empleadoId,
        numEmpleado: f.numEmpleado,
        nombre: f.nombre,
        week: f.week,
        dias: [],
        minutosEfectivos: 0,
        minutosOrdinarios: 0,
        minutosHE: 0
      });
    }
    const bucket = byEmpWeek.get(key);
    bucket.dias.push({ fecha: f.fecha, minutosExtra: f.minutosHE });
    bucket.minutosEfectivos += f.minutosEfectivos;
    bucket.minutosOrdinarios += f.minutosOrdinarios;
    bucket.minutosHE += f.minutosHE;
  }

  const semanas = [...byEmpWeek.values()].map((b) => {
    const heClass = clasificarHorasExtraPeriodo(b.dias);
    return {
      ...b,
      heDoblesSemana: heClass.minutosDobles || 0,
      heTriplesSemana: heClass.minutosTriples || 0,
      horasEfectivas: Math.round((b.minutosEfectivos / 60) * 100) / 100,
      horasOrdinarias: Math.round((b.minutosOrdinarios / 60) * 100) / 100,
      horasHE: Math.round((b.minutosHE / 60) * 100) / 100
    };
  });
  semanas.sort((a, b) =>
    a.week === b.week
      ? String(a.nombre).localeCompare(String(b.nombre))
      : String(a.week).localeCompare(String(b.week))
  );

  return {
    filas,
    semanas,
    empleados: [...empMap.values()],
    fechaInicio: fi,
    fechaFin: ff
  };
}

module.exports = {
  buildRegistroJornada,
  minutosEfectivos
};

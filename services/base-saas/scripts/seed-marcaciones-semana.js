'use strict';

/**
 * Genera marcaciones completas (entrada+salida) para demo:
 * Fernando Castillo Núñez (007), Roberto Vargas (001), María López (002)
 * Rango: 20–26 jun 2026 (lun–vie laborables según turno Matutino).
 *
 * Uso (en contenedor base-saas):
 *   node scripts/seed-marcaciones-semana.js
 */

const getEmpleadoModel = require('../models/empleado');
const getAttendanceRecordModel = require('../models/attendanceRecord');
const { recalculateDailyAttendance } = require('../services/attendanceProcessingService');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');

const TENANT_ID = '09438d66-db3a-4d7e-8d1d-0ad63357eabb';
const NUMS = ['007', '001', '002'];
const INICIO = new Date(2026, 5, 20); // 20 jun 2026
const FIN = new Date(2026, 5, 26);

/** Variaciones leves por empleado (minutos sobre 08:00 / 17:00) */
const VARIACION = {
  '007': { entradaMin: 0, salidaMin: 0 }, // puntual
  '001': { entradaMin: 12, salidaMin: 5 }, // retardo leve
  '002': { entradaMin: 3, salidaMin: 15 } // salida un poco tarde
};

function eachDay(inicio, fin, fn) {
  let d = startOfDay(inicio);
  const end = startOfDay(fin);
  while (d <= end) {
    fn(new Date(d));
    d = new Date(d.getTime() + 86400000);
  }
}

function isLaborable(date) {
  const day = date.getDay(); // 0=dom … 6=sáb
  return day >= 1 && day <= 5;
}

function atTime(fecha, hh, mm) {
  const t = new Date(fecha);
  t.setHours(hh, mm, 0, 0);
  return t;
}

async function main() {
  const Empleado = await getEmpleadoModel();
  const AttendanceRecord = await getAttendanceRecordModel();

  const empleados = await Empleado.find({
    tenantId: TENANT_ID,
    numEmpleado: { $in: NUMS },
    estatus: 'activo'
  }).lean();

  if (empleados.length < 3) {
    throw new Error(`Se esperaban 3 empleados (${NUMS.join(',')}), hallados: ${empleados.length}`);
  }

  // Asegura calificación automática y turno fijo (sin rotación) para la demo
  const getAsignacionRotacionModel = require('../models/asignacionRotacion');
  const AsignacionRotacion = await getAsignacionRotacionModel();
  await Empleado.updateMany(
    { _id: { $in: empleados.map((e) => e._id) } },
    { $set: { tipoRegistro: 'rol_turnos' } }
  );
  const rotOff = await AsignacionRotacion.updateMany(
    { tenantId: TENANT_ID, empleadoId: { $in: empleados.map((e) => e._id) }, activo: true },
    { $set: { activo: false } }
  );
  console.log(`tipoRegistro → rol_turnos; rotaciones desactivadas: ${rotOff.modifiedCount}`);

  // Releer empleados ya actualizados
  const empleadosFresh = await Empleado.find({ _id: { $in: empleados.map((e) => e._id) } }).lean();

  const rangoInicio = startOfDay(INICIO);
  const rangoFin = endOfDay(FIN);

  // Limpia marcaciones previas del rango para estos empleados
  const ids = empleadosFresh.map((e) => e._id);
  const del = await AttendanceRecord.deleteMany({
    tenantId: TENANT_ID,
    empleadoId: { $in: ids },
    fecha: { $gte: rangoInicio, $lte: rangoFin }
  });
  console.log(`Marcaciones eliminadas en rango: ${del.deletedCount}`);

  let creadas = 0;
  const diasLaborables = [];

  eachDay(INICIO, FIN, (fecha) => {
    if (isLaborable(fecha)) diasLaborables.push(fecha);
  });

  for (const emp of empleadosFresh) {
    const v = VARIACION[emp.numEmpleado] || { entradaMin: 0, salidaMin: 0 };
    for (const fecha of diasLaborables) {
      const entrada = atTime(fecha, 8, v.entradaMin);
      const salida = atTime(fecha, 17, v.salidaMin);
      const dayStart = startOfDay(fecha);

      await AttendanceRecord.create({
        tenantId: TENANT_ID,
        empleadoId: emp._id,
        turnoId: emp.turnoId || null,
        subsidiariaId: emp.subsidiariaId || null,
        fecha: dayStart,
        timestamp: entrada,
        tipoMarcacion: 'entrada',
        metodo: 'manual',
        registradoPorUserId: 'seed-script',
        notas: 'Seed demo semana 20–26 jun 2026',
        procesado: false
      });
      await AttendanceRecord.create({
        tenantId: TENANT_ID,
        empleadoId: emp._id,
        turnoId: emp.turnoId || null,
        subsidiariaId: emp.subsidiariaId || null,
        fecha: dayStart,
        timestamp: salida,
        tipoMarcacion: 'salida',
        metodo: 'manual',
        registradoPorUserId: 'seed-script',
        notas: 'Seed demo semana 20–26 jun 2026',
        procesado: false
      });
      creadas += 2;

      const daily = await recalculateDailyAttendance(TENANT_ID, emp._id, dayStart);
      console.log(
        `${emp.numEmpleado} ${emp.firstName} ${fecha.toISOString().slice(0, 10)} → ${daily?.estatus || '—'}` +
          (daily?.minutosRetardo ? ` retardo=${daily.minutosRetardo}m` : '')
      );
    }
  }

  // Sáb/dom: reprocesar para marcar descanso (sin marcaciones)
  for (const fecha of [new Date(2026, 5, 20), new Date(2026, 5, 21)]) {
    for (const emp of empleadosFresh) {
      const daily = await recalculateDailyAttendance(TENANT_ID, emp._id, startOfDay(fecha));
      console.log(
        `${emp.numEmpleado} ${emp.firstName} ${fecha.toISOString().slice(0, 10)} (finde) → ${daily?.estatus || '—'}`
      );
    }
  }

  console.log(`\nListo: ${creadas} marcaciones en ${diasLaborables.length} días laborables × ${empleadosFresh.length} empleados.`);
  console.log('Empleados:', empleadosFresh.map((e) => `${e.numEmpleado} ${e.firstName} ${e.lastName}`).join(' | '));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

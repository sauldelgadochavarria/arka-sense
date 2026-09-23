'use strict';

/**
 * Genera marcaciones de la semana actual (lun–dom) para Empresa Demo SA.
 * Escenarios variados para probar hub → diaria → autorizaciones → jornada.
 *
 * Uso (en contenedor base-saas):
 *   node scripts/seed-marcaciones-semana.js
 *   node scripts/seed-marcaciones-semana.js --desde=2026-09-21 --hasta=2026-09-27
 */

const getEmpleadoModel = require('../models/empleado');
const getAttendanceRecordModel = require('../models/attendanceRecord');
const { recalculateDailyAttendance } = require('../services/attendanceProcessingService');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');

const TENANT_ID = '09438d66-db3a-4d7e-8d1d-0ad63357eabb';
/** Empleados demo con turno (001–010) */
const NUMS = ['001', '002', '003', '004', '005', '006', '007', '008', '009', '010'];

/**
 * Perfil por empleado:
 * - entradaMin / salidaMin: offset sobre 08:00 / 17:00
 * - skipDays: 0=dom … 6=sáb → no marca (falta)
 * - incompleteDays: solo entrada
 * - longDays: salida muy tarde (HE)
 */
const PERFILES = {
  '001': { entradaMin: 18, salidaMin: 5, label: 'retardo recurrente' },
  '002': { entradaMin: 2, salidaMin: 55, longDays: [2], label: 'HE martes' },
  '003': { entradaMin: 5, salidaMin: 0, incompleteDays: [3], label: 'parcial miércoles' },
  '004': { entradaMin: 0, salidaMin: 0, skipDays: [4], label: 'falta jueves' },
  '005': { entradaMin: 8, salidaMin: 10, label: 'retardo leve' },
  '006': { entradaMin: 0, salidaMin: 0, label: 'puntual' },
  '007': { entradaMin: 0, salidaMin: 0, label: 'puntual (Fernando)' },
  '008': { entradaMin: 25, salidaMin: 0, label: 'retardo fuerte lun–vie' },
  '009': { entradaMin: 1, salidaMin: 90, longDays: [1, 5], label: 'HE lun y vie' },
  '010': { entradaMin: 4, salidaMin: 20, label: 'casi puntual + salida tarde' }
};

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

function mondayOfWeek(ref = new Date()) {
  const d = startOfDay(ref);
  const day = d.getDay(); // 0 dom
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function sundayOfWeek(ref = new Date()) {
  const mon = mondayOfWeek(ref);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return sun;
}

function parseYmd(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function eachDay(inicio, fin, fn) {
  let d = startOfDay(inicio);
  const end = startOfDay(fin);
  while (d <= end) {
    fn(new Date(d));
    d = new Date(d.getTime() + 86400000);
  }
}

function isLaborable(date) {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function atTime(fecha, hh, mm) {
  const t = new Date(fecha);
  t.setHours(hh, mm, 0, 0);
  return t;
}

async function main() {
  const desdeArg = parseYmd(argValue('desde'));
  const hastaArg = parseYmd(argValue('hasta'));
  const INICIO = desdeArg || mondayOfWeek(new Date());
  const FIN = hastaArg || sundayOfWeek(new Date());
  const nota = `Seed demo semana ${INICIO.toISOString().slice(0, 10)}–${FIN.toISOString().slice(0, 10)}`;

  console.log(`Rango: ${INICIO.toISOString().slice(0, 10)} → ${FIN.toISOString().slice(0, 10)}`);

  const Empleado = await getEmpleadoModel();
  const AttendanceRecord = await getAttendanceRecordModel();
  const getAsignacionRotacionModel = require('../models/asignacionRotacion');
  const AsignacionRotacion = await getAsignacionRotacionModel();

  const empleados = await Empleado.find({
    tenantId: TENANT_ID,
    numEmpleado: { $in: NUMS },
    estatus: 'activo',
    turnoId: { $ne: null }
  }).lean();

  if (!empleados.length) {
    throw new Error('No hay empleados demo con turno en el tenant');
  }

  await Empleado.updateMany(
    { _id: { $in: empleados.map((e) => e._id) } },
    { $set: { tipoRegistro: 'rol_turnos' } }
  );
  const rotOff = await AsignacionRotacion.updateMany(
    { tenantId: TENANT_ID, empleadoId: { $in: empleados.map((e) => e._id) }, activo: true },
    { $set: { activo: false } }
  );
  console.log(`tipoRegistro → rol_turnos; rotaciones off: ${rotOff.modifiedCount}`);

  const empleadosFresh = await Empleado.find({ _id: { $in: empleados.map((e) => e._id) } }).lean();
  const ids = empleadosFresh.map((e) => e._id);
  const rangoInicio = startOfDay(INICIO);
  const rangoFin = endOfDay(FIN);

  const del = await AttendanceRecord.deleteMany({
    tenantId: TENANT_ID,
    empleadoId: { $in: ids },
    fecha: { $gte: rangoInicio, $lte: rangoFin }
  });
  console.log(`Marcaciones previas eliminadas: ${del.deletedCount}`);

  const dias = [];
  eachDay(INICIO, FIN, (fecha) => dias.push(fecha));

  let creadas = 0;
  const resumen = { presente: 0, retardo: 0, falta: 0, registro_parcial: 0, descanso: 0, otro: 0 };

  for (const emp of empleadosFresh) {
    const p = PERFILES[emp.numEmpleado] || { entradaMin: 0, salidaMin: 0 };
    console.log(`\n— ${emp.numEmpleado} ${emp.firstName} (${p.label || 'default'})`);

    for (const fecha of dias) {
      const dayStart = startOfDay(fecha);
      const dow = fecha.getDay();

      if (isLaborable(fecha) && !(p.skipDays || []).includes(dow)) {
        const entradaMin = p.entradaMin || 0;
        let salidaMin = p.salidaMin || 0;
        if ((p.longDays || []).includes(dow)) salidaMin = Math.max(salidaMin, 75);

        const entrada = atTime(fecha, 8, entradaMin);
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
          notas: nota,
          procesado: false
        });
        creadas += 1;

        if (!(p.incompleteDays || []).includes(dow)) {
          const salida = atTime(fecha, 17, 0);
          salida.setMinutes(salidaMin);
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
            notas: nota,
            procesado: false
          });
          creadas += 1;
        }
      }

      const daily = await recalculateDailyAttendance(TENANT_ID, emp._id, dayStart);
      const est = daily?.estatus || '—';
      if (resumen[est] != null) resumen[est] += 1;
      else resumen.otro += 1;
      const extra = [];
      if (daily?.minutosRetardo) extra.push(`ret=${daily.minutosRetardo}m`);
      if (daily?.minutosHorasExtra) extra.push(`HE=${daily.minutosHorasExtra}m`);
      if (daily?.excedeLimiteDiario) extra.push('>12h');
      console.log(
        `  ${fecha.toISOString().slice(0, 10)} → ${est}${extra.length ? ' ' + extra.join(' ') : ''}`
      );
    }
  }

  console.log('\n=== Resumen estatus ===');
  console.log(resumen);
  console.log(
    `\nListo: ${creadas} marcaciones · ${empleadosFresh.length} empleados · ${dias.length} días`
  );
  console.log(
    'Empleados:',
    empleadosFresh.map((e) => `${e.numEmpleado} ${e.firstName}`).join(' | ')
  );
  console.log('\nPrueba en UI: /asistencia → /asistencia-diaria → /asistencia-autorizaciones → /asistencia-registro-jornada');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

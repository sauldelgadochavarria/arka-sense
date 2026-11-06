'use strict';

const getEmpleadoModel = require('../models/empleado');
const getDepartamentoModel = require('../models/departamento');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const getIncidenciaModel = require('../models/incidencia');
const getBiometricDeviceModel = require('../models/biometricDevice');
const { startOfDay, endOfDay, ymdInTimeZone, addDaysYmd } = require('../libs/timeHelpers');
const { zonaDeSubsidiariaId } = require('./zonaHorariaService');

function pct(ok, total) {
  if (!total) return 0;
  return Math.round((ok / total) * 1000) / 10;
}

function nombreEmpleado(emp) {
  return `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.numEmpleado;
}

function enlacesDetalle(zona) {
  const hoy = ymdInTimeZone(new Date(), zona);
  const dia = new Date(`${hoy}T12:00:00.000Z`);
  const lunes = addDaysYmd(hoy, -((dia.getUTCDay() + 6) % 7));
  const mes = `${hoy.slice(0, 8)}01`;
  const asistencia = (desde, hasta) =>
    `/asistencia-diaria?fechaDesde=${desde}&fechaHasta=${hasta}`;
  return {
    hoy: asistencia(hoy, hoy),
    semana: asistencia(lunes, hoy),
    mes: asistencia(mes, hoy),
    empleados: '/personal-empleados?estatus=activo',
    he: `${asistencia(mes, hoy)}&he=1`,
    pendientes: '/incidencias/pendientes',
    retardos: `${asistencia(mes, hoy)}&estatus=retardo`
  };
}

async function asistenciaEnRango(tenantId, empIds, inicio, fin) {
  if (!empIds.length) return { ok: 0, total: 0, pct: 0 };
  const DailyAttendance = await getDailyAttendanceModel();
  const registros = await DailyAttendance.find({
    tenantId,
    empleadoId: { $in: empIds },
    fecha: { $gte: inicio, $lte: fin },
    estatus: { $nin: ['descanso', 'vacaciones', 'anulada'] }
  }).lean();

  const total = registros.length;
  // Incompleto y parcial cuentan: la persona ya marcó y el día todavía no cierra.
  const ok = registros.filter((r) =>
    ['presente', 'retardo', 'incompleto', 'registro_parcial'].includes(r.estatus)
  ).length;
  return { ok, total, pct: pct(ok, total) };
}

async function getDashboardKpis(tenantId, { empresaId = null, subsidiariaId = null } = {}) {
  const hoy = new Date();
  const inicioSemana = startOfDay(new Date(hoy));
  inicioSemana.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  const inicioMes = startOfDay(new Date(hoy.getFullYear(), hoy.getMonth(), 1));

  const Empleado = await getEmpleadoModel();
  const Departamento = await getDepartamentoModel();
  const Incidencia = await getIncidenciaModel();
  const BiometricDevice = await getBiometricDeviceModel();
  const DailyAttendance = await getDailyAttendanceModel();

  const empQ = { tenantId, estatus: 'activo' };
  const deptoQ = { tenantId, activo: true };
  const devQ = { tenantId, activo: true };
  if (empresaId) {
    empQ.empresaId = empresaId;
    deptoQ.empresaId = empresaId;
    devQ.empresaId = empresaId;
  }
  if (subsidiariaId) {
    empQ.subsidiariaId = subsidiariaId;
    deptoQ.subsidiariaId = subsidiariaId;
    devQ.subsidiariaId = subsidiariaId;
  }

  const [empleadosActivos, departamentos, dispositivos] = await Promise.all([
    Empleado.find(empQ).lean(),
    Departamento.find(deptoQ).lean(),
    BiometricDevice.find(devQ).lean()
  ]);

  const empIds = empleadosActivos.map((e) => e._id);
  const pendientes = empIds.length
    ? await Incidencia.countDocuments({
        tenantId,
        estatus: 'pendiente',
        empleadoId: { $in: empIds }
      })
    : 0;
  const [hoyStats, semanaStats, mesStats] = await Promise.all([
    asistenciaEnRango(tenantId, empIds, startOfDay(hoy), endOfDay(hoy)),
    asistenciaEnRango(tenantId, empIds, inicioSemana, endOfDay(hoy)),
    asistenciaEnRango(tenantId, empIds, inicioMes, endOfDay(hoy))
  ]);

  const retardosMes = await DailyAttendance.find({
    tenantId,
    empleadoId: { $in: empIds },
    fecha: { $gte: inicioMes, $lte: endOfDay(hoy) },
    minutosRetardo: { $gt: 0 }
  }).lean();

  const topRetardosMap = new Map();
  for (const r of retardosMes) {
    const key = String(r.empleadoId);
    topRetardosMap.set(key, (topRetardosMap.get(key) || 0) + (r.minutosRetardo || 0));
  }
  const empMap = new Map(empleadosActivos.map((e) => [String(e._id), e]));
  const topRetardos = [...topRetardosMap.entries()]
    .map(([id, minutos]) => ({
      empleado: nombreEmpleado(empMap.get(id) || {}),
      minutos
    }))
    .sort((a, b) => b.minutos - a.minutos)
    .slice(0, 10);

  const heMes = await DailyAttendance.aggregate([
    {
      $match: {
        tenantId,
        empleadoId: { $in: empIds },
        fecha: { $gte: inicioMes, $lte: endOfDay(hoy) }
      }
    },
    { $group: { _id: null, total: { $sum: '$minutosHorasExtra' } } }
  ]);
  const heMesMinutos = heMes[0]?.total || 0;

  const ausentismoPorDepto = [];
  for (const depto of departamentos) {
    const deptEmps = empleadosActivos.filter((e) => String(e.departamentoId) === String(depto._id));
    const deptIds = deptEmps.map((e) => e._id);
    const stats = await asistenciaEnRango(tenantId, deptIds, inicioMes, endOfDay(hoy));
    const faltas = await DailyAttendance.countDocuments({
      tenantId,
      empleadoId: { $in: deptIds },
      fecha: { $gte: inicioMes, $lte: endOfDay(hoy) },
      estatus: 'falta'
    });
    ausentismoPorDepto.push({
      departamento: depto.nombre,
      empleados: deptEmps.length,
      asistenciaPct: stats.pct,
      faltas
    });
  }
  ausentismoPorDepto.sort((a, b) => b.faltas - a.faltas);

  const sinTurno = empleadosActivos.filter((e) => !e.turnoId && e.tipoRegistro === 'rol_turnos').length;
  const dispositivosOffline = dispositivos.filter((d) => d.estatus === 'offline').length;

  const tendencia12Meses = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const ini = startOfDay(d);
    const fin = endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const stats = await asistenciaEnRango(tenantId, empIds, ini, fin);
    tendencia12Meses.push({
      mes: d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
      pct: stats.pct
    });
  }

  const registroParcialHoy = empIds.length
    ? await DailyAttendance.countDocuments({
        tenantId,
        empleadoId: { $in: empIds },
        fecha: { $gte: startOfDay(hoy), $lte: endOfDay(hoy) },
        estatus: 'registro_parcial'
      })
    : 0;
  const fueraRangoHoy = empIds.length
    ? await DailyAttendance.countDocuments({
        tenantId,
        empleadoId: { $in: empIds },
        fecha: { $gte: startOfDay(hoy), $lte: endOfDay(hoy) },
        estatus: 'fuera_de_rango'
      })
    : 0;

  const zona = await zonaDeSubsidiariaId(subsidiariaId);
  return {
    enlaces: enlacesDetalle(zona),
    empleadosActivos: empleadosActivos.length,
    asistenciaHoy: hoyStats,
    asistenciaSemana: semanaStats,
    asistenciaMes: mesStats,
    topRetardos,
    ausentismoPorDepto: ausentismoPorDepto.slice(0, 8),
    heMesMinutos,
    incidenciasPendientes: pendientes,
    alertas: [
      ...(dispositivosOffline ? [{ tipo: 'warn', texto: `${dispositivosOffline} dispositivo(s) offline` }] : []),
      ...(sinTurno ? [{ tipo: 'warn', texto: `${sinTurno} empleado(s) sin turno asignado` }] : []),
      ...(registroParcialHoy ? [{ tipo: 'info', texto: `${registroParcialHoy} registro(s) parcial hoy` }] : []),
      ...(fueraRangoHoy ? [{ tipo: 'info', texto: `${fueraRangoHoy} marcaje(s) fuera de rango hoy` }] : [])
    ],
    tendencia12Meses
  };
}

module.exports = { getDashboardKpis };

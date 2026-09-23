'use strict';

const getEmpleadoModel = require('../models/empleado');
const getTurnoModel = require('../models/turno');
const getIncidenciaModel = require('../models/incidencia');
const getPayrollDetailModel = require('../models/payrollDetail');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const { getEmpleadoExportId } = require('../libs/empleadoHelpers');
const { startOfDay, endOfDay, ymdInTimeZone } = require('../libs/timeHelpers');
const { ESQUEMA_JORNADA_DEFAULTS } = require('../libs/esquemaJornada');
const { buildTiempoClasificado, buildBanderasExcepcion, horasExtraDesdeDetail } = require('./nomina/prenominaBridge');

async function validateCodigoExternoForPeriod(period, tenantId) {
  const Empleado = await getEmpleadoModel();
  const Incidencia = await getIncidenciaModel();
  const PayrollDetail = await getPayrollDetailModel();
  const inicio = startOfDay(period.fechaInicio);
  const fin = endOfDay(period.fechaFin);

  const [empleados, incidencias, detalles] = await Promise.all([
    Empleado.find({ tenantId, estatus: 'activo', activo: true }).lean(),
    Incidencia.find({
      tenantId,
      estatus: 'aprobada',
      fechaInicio: { $gte: inicio, $lte: fin }
    }).lean(),
    PayrollDetail.find({ tenantId, periodId: period._id }).lean()
  ]);

  const empMap = new Map(empleados.map((e) => [String(e._id), e]));
  const afectados = new Set();

  for (const inc of incidencias) {
    afectados.add(String(inc.empleadoId));
  }
  for (const det of detalles) {
    if ((det.diasFalta || 0) > 0 || (det.minutosRetardo || 0) > 0 || (det.minutosHorasExtra || 0) > 0) {
      afectados.add(String(det.empleadoId));
    }
  }

  const sinCodigo = [];
  for (const empId of afectados) {
    const emp = empMap.get(empId);
    if (!emp) continue;
    if (!getEmpleadoExportId(emp)) {
      sinCodigo.push({
        _id: emp._id,
        numEmpleado: emp.numEmpleado,
        nombre: `${emp.firstName} ${emp.lastName}`.trim()
      });
    }
  }

  return {
    ok: sinCodigo.length === 0,
    sinCodigo,
    totalAfectados: afectados.size
  };
}

/**
 * Preflight jornada 2027: sin turno, excede 12 h, ordinarias snapshot, contrato clasificado.
 * - bloqueos → impiden cierre (HTTP 422 en API)
 * - advertencias → informativas
 */
async function validateJornadaForPeriod(period, tenantId) {
  const bloqueos = [];
  const advertencias = [];
  const Empleado = await getEmpleadoModel();
  const Turno = await getTurnoModel();
  const PayrollDetail = await getPayrollDetailModel();
  const DailyAttendance = await getDailyAttendanceModel();

  const inicio = startOfDay(period.fechaInicio);
  const fin = endOfDay(period.fechaFin);

  const [empleados, detalles, diarios] = await Promise.all([
    Empleado.find({ tenantId, estatus: 'activo', activo: true }).lean(),
    PayrollDetail.find({ tenantId, periodId: period._id }).lean(),
    DailyAttendance.find({
      tenantId,
      fecha: { $gte: inicio, $lte: fin },
      excedeLimiteDiario: true
    })
      .select('empleadoId fecha minutosHorasExtra')
      .lean()
  ]);

  const sinTurno = empleados
    .filter((e) => !e.turnoId)
    .map((e) => ({
      _id: e._id,
      numEmpleado: e.numEmpleado,
      nombre: `${e.firstName} ${e.lastName}`.trim()
    }));

  if (sinTurno.length) {
    advertencias.push({
      codigo: 'EMPLEADOS_SIN_TURNO',
      mensaje: `${sinTurno.length} empleado(s) activo(s) sin turno (valor hora / topes usarán defaults)`,
      detalle: sinTurno.slice(0, 20)
    });
  }

  if (diarios.length) {
    advertencias.push({
      codigo: 'EXCEDE_12H_DIA',
      mensaje: `${diarios.length} día(s) con bandera Art. 68 (> tope diario del esquema)`,
      detalle: diarios.slice(0, 30).map((d) => ({
        empleadoId: d.empleadoId,
        fecha: d.fecha,
        minutosHE: d.minutosHorasExtra
      }))
    });
  }

  const excedeEnDetalle = detalles.filter((d) => d.excedeLimiteDiario);
  if (excedeEnDetalle.length) {
    advertencias.push({
      codigo: 'PRENOMINA_EXCEDE_12H',
      mensaje: `${excedeEnDetalle.length} detalle(s) de pre-nómina con excedeLimiteDiario`,
      detalle: excedeEnDetalle.map((d) => ({ empleadoId: d.empleadoId }))
    });
  }

  // Contrato: HE clasificadas no deben superar topes absurdos
  for (const d of detalles) {
    const he = horasExtraDesdeDetail(d);
    const maxDobles = ESQUEMA_JORNADA_DEFAULTS.maxHorasExtraDoblesSemana * 4; // holgura quincena
    if (he.horasExtraDobles > maxDobles + 0.01) {
      bloqueos.push({
        codigo: 'HE_DOBLES_INCONSISTENTES',
        mensaje: `Empleado ${d.empleadoId}: horas_extra_dobles (${he.horasExtraDobles.toFixed(2)}) inconsistentes con esquema`,
        httpStatus: 422,
        empleadoId: d.empleadoId,
        tiempoClasificado: buildTiempoClasificado(d, he),
        banderasExcepcion: buildBanderasExcepcion(d)
      });
    }
  }

  const conActividadSinTurno = detalles.filter((d) => {
    const emp = empleados.find((e) => String(e._id) === String(d.empleadoId));
    return emp && !emp.turnoId && ((d.minutosHorasExtra || 0) > 0 || (d.diasTrabajados || 0) > 0);
  });
  if (conActividadSinTurno.length) {
    advertencias.push({
      codigo: 'ACTIVIDAD_SIN_TURNO',
      mensaje: `${conActividadSinTurno.length} empleado(s) con actividad en pre-nómina pero sin turno asignado`
    });
  }

  // Turnos con horasJornada > 12 (datos legacy)
  const turnoIds = [...new Set(empleados.map((e) => e.turnoId).filter(Boolean).map(String))];
  if (turnoIds.length) {
    const turnosMal = await Turno.find({
      _id: { $in: turnoIds },
      tenantId,
      horasJornada: { $gt: ESQUEMA_JORNADA_DEFAULTS.maxHorasTotalesDia }
    }).lean();
    if (turnosMal.length) {
      bloqueos.push({
        codigo: 'TURNO_SUPERA_12H',
        mensaje: `${turnosMal.length} turno(s) con horasJornada > 12 (Art. 68). Corrige en Asistencia → Turnos.`,
        httpStatus: 422,
        detalle: turnosMal.map((t) => ({ _id: t._id, nombre: t.nombre, horasJornada: t.horasJornada }))
      });
    }
  }

  return {
    ok: bloqueos.length === 0,
    bloqueos,
    advertencias,
    httpStatus: bloqueos.length ? 422 : 200
  };
}

/** Combina código externo + jornada + asistencia incompleta para cierre de período. */
async function validatePeriodClose(period, tenantId) {
  const [codigo, jornada, incompleta] = await Promise.all([
    validateCodigoExternoForPeriod(period, tenantId),
    validateJornadaForPeriod(period, tenantId),
    validateAsistenciaIncompletaForPeriod(period, tenantId)
  ]);

  const bloqueos = [...(jornada.bloqueos || []), ...(incompleta.bloqueos || [])];
  if (!codigo.ok) {
    bloqueos.push({
      codigo: 'MISSING_CODIGO_EXTERNO',
      mensaje: `${codigo.sinCodigo.length} empleado(s) sin identificador de exportación`,
      httpStatus: 422,
      detalle: codigo.sinCodigo
    });
  }

  return {
    ok: bloqueos.length === 0 && codigo.ok,
    sinCodigo: codigo.sinCodigo || [],
    bloqueos,
    advertencias: [...(jornada.advertencias || []), ...(incompleta.advertencias || [])],
    incompletos: incompleta.incompletos || [],
    incompletosEnCurso: incompleta.enCurso || [],
    httpStatus: bloqueos.length || !codigo.ok ? 422 : 200,
    totalAfectados: codigo.totalAfectados
  };
}

/**
 * Días incompletos / registro parcial en el rango del período.
 * - Pasados → bloquean cierre (hay que completar checada, justificar o aceptar como falta).
 * - Hoy (en curso) → solo advertencia informativa.
 */
async function validateAsistenciaIncompletaForPeriod(period, tenantId) {
  const DailyAttendance = await getDailyAttendanceModel();
  const Empleado = await getEmpleadoModel();
  const inicio = startOfDay(period.fechaInicio);
  const fin = endOfDay(period.fechaFin);
  const hoyYmd = ymdInTimeZone(new Date());

  const diarios = await DailyAttendance.find({
    tenantId,
    fecha: { $gte: inicio, $lte: fin },
    estatus: { $in: ['incompleto', 'registro_parcial'] }
  })
    .select('empleadoId fecha estatus entradaReal salidaReal')
    .lean();

  if (!diarios.length) {
    return { ok: true, bloqueos: [], advertencias: [], incompletos: [], enCurso: [] };
  }

  const empIds = [...new Set(diarios.map((d) => String(d.empleadoId)))];
  const empleados = await Empleado.find({ _id: { $in: empIds } })
    .select('firstName lastName numEmpleado')
    .lean();
  const empMap = new Map(
    empleados.map((e) => [
      String(e._id),
      { nombre: `${e.firstName || ''} ${e.lastName || ''}`.trim(), numEmpleado: e.numEmpleado || '' }
    ])
  );

  const incompletos = [];
  const enCurso = [];
  for (const d of diarios) {
    const emp = empMap.get(String(d.empleadoId)) || { nombre: '—', numEmpleado: '' };
    const fechaYmd = ymdInTimeZone(d.fecha);
    const row = {
      empleadoId: d.empleadoId,
      nombre: emp.nombre,
      numEmpleado: emp.numEmpleado,
      fecha: d.fecha,
      fechaYmd,
      estatus: d.estatus,
      entradaReal: d.entradaReal || null,
      salidaReal: d.salidaReal || null
    };
    // Comparar por calendario México (no medianoche UTC del contenedor)
    if (fechaYmd < hoyYmd) incompletos.push(row);
    else enCurso.push(row);
  }

  const bloqueos = [];
  const advertencias = [];

  if (incompletos.length) {
    bloqueos.push({
      codigo: 'ASIS_INCOMPLETA',
      mensaje: `${incompletos.length} día(s) incompleto(s)/parcial(es) ya cerrados: no pagan y al recalcular cuentan como falta. Completa la marcación, justifica o deja el tratamiento como falta antes de cerrar.`,
      httpStatus: 422,
      detalle: incompletos.slice(0, 40)
    });
  }
  if (enCurso.length) {
    advertencias.push({
      codigo: 'ASIS_INCOMPLETA_EN_CURSO',
      mensaje: `${enCurso.length} día(s) en curso incompleto(s): aún no cuentan como trabajados ni como falta (falta salida). Al terminar el día, reprocesa o completa la checada.`,
      detalle: enCurso.slice(0, 20)
    });
  }

  return {
    ok: bloqueos.length === 0,
    bloqueos,
    advertencias,
    incompletos,
    enCurso,
    httpStatus: bloqueos.length ? 422 : 200
  };
}

function applyExportFlagsToDetalle(empleado, detalle) {
  const percepciones = [...(detalle.percepciones || [])];
  const deducciones = [...(detalle.deducciones || [])];

  const filteredPercepciones =
    empleado.exportarHorasExtra === false
      ? percepciones.filter((p) => p.clave !== 'P002' && p.formula !== 'horas_extra')
      : percepciones;

  const filteredDeducciones = deducciones.filter((d) => {
    if (empleado.exportarRetardos === false && (d.clave === 'D001' || d.formula === 'retardos')) return false;
    if (empleado.exportarFaltas === false && (d.clave === 'D002' || d.formula === 'faltas')) return false;
    return true;
  });

  const totalPercepciones = Math.round(filteredPercepciones.reduce((s, l) => s + l.monto, 0) * 100) / 100;
  const totalDeducciones = Math.round(filteredDeducciones.reduce((s, l) => s + l.monto, 0) * 100) / 100;

  return {
    ...detalle,
    percepciones: filteredPercepciones,
    deducciones: filteredDeducciones,
    totalPercepciones,
    totalDeducciones,
    netoPagar: Math.round((totalPercepciones - totalDeducciones) * 100) / 100,
    exportId: getEmpleadoExportId(empleado)
  };
}

module.exports = {
  validateCodigoExternoForPeriod,
  validateJornadaForPeriod,
  validateAsistenciaIncompletaForPeriod,
  validatePeriodClose,
  applyExportFlagsToDetalle
};

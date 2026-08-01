'use strict';

const getEmpleadoModel = require('../models/empleado');
const getDepartamentoModel = require('../models/departamento');
const getTurnoModel = require('../models/turno');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const getIncidenciaModel = require('../models/incidencia');
const getTipoIncidenciaModel = require('../models/tipoIncidencia');
const getVacacionSaldoModel = require('../models/vacacionSaldo');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const getPayrollDetailModel = require('../models/payrollDetail');
const getSyncLogModel = require('../models/syncLog');
const getBiometricDeviceModel = require('../models/biometricDevice');
const { validateCodigoExternoForPeriod } = require('./payrollPreflightService');
const { buildEmpleadoQuery } = require('../libs/reportFilters');
const { startOfDay, endOfDay, formatDateMX } = require('../libs/timeHelpers');
const { ESTATUS_DIARIO } = require('../config/asistencia');

function nombreEmpleado(emp) {
  if (!emp) return '—';
  return `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.numEmpleado || '—';
}

async function loadEmpleadoContext(tenantId, filters, { soloActivos = true } = {}) {
  const Empleado = await getEmpleadoModel();
  const extra = soloActivos ? { estatus: 'activo' } : {};
  const empleados = await Empleado.find(buildEmpleadoQuery(tenantId, filters, extra))
    .sort({ lastName: 1, firstName: 1 })
    .lean();
  const empMap = new Map(empleados.map((e) => [String(e._id), e]));
  const empIds = empleados.map((e) => e._id);
  return { empleados, empMap, empIds };
}

async function loadLookupMaps(tenantId) {
  const Departamento = await getDepartamentoModel();
  const Turno = await getTurnoModel();
  const [departamentos, turnos] = await Promise.all([
    Departamento.find({ tenantId }).lean(),
    Turno.find({ tenantId }).lean()
  ]);
  return {
    deptMap: new Map(departamentos.map((d) => [String(d._id), d.nombre])),
    turnoMap: new Map(turnos.map((t) => [String(t._id), t.nombre]))
  };
}

function enrichRow(row, emp, maps) {
  return {
    ...row,
    numEmpleado: emp?.numEmpleado || '',
    empleado: nombreEmpleado(emp),
    departamento: emp?.departamentoId ? maps.deptMap.get(String(emp.departamentoId)) || '—' : '—',
    turno: emp?.turnoId ? maps.turnoMap.get(String(emp.turnoId)) || '—' : '—'
  };
}

async function reportAsistenciaPeriodo(tenantId, filters) {
  const maps = await loadLookupMaps(tenantId);
  const { empleados, empMap, empIds } = await loadEmpleadoContext(tenantId, filters);
  if (!empIds.length) {
    return {
      columns: [
        { key: 'numEmpleado', label: 'No. empleado' },
        { key: 'empleado', label: 'Empleado' },
        { key: 'departamento', label: 'Departamento' },
        { key: 'presentes', label: 'Presentes' },
        { key: 'retardos', label: 'Retardos' },
        { key: 'faltas', label: 'Faltas' },
        { key: 'incompletos', label: 'Incompletos' },
        { key: 'descanso', label: 'Descanso' },
        { key: 'registroParcial', label: 'Reg. parcial' },
        { key: 'fueraDeRango', label: 'Fuera de rango' }
      ],
      rows: []
    };
  }

  const DailyAttendance = await getDailyAttendanceModel();
  const registros = await DailyAttendance.find({
    tenantId,
    empleadoId: { $in: empIds },
    fecha: { $gte: filters.fechaInicio, $lte: filters.fechaFin }
  }).lean();

  const agg = new Map();
  for (const emp of empleados) {
    agg.set(String(emp._id), {
      presentes: 0,
      retardos: 0,
      faltas: 0,
      incompletos: 0,
      descanso: 0,
      registroParcial: 0,
      fueraDeRango: 0
    });
  }

  for (const r of registros) {
    const bucket = agg.get(String(r.empleadoId));
    if (!bucket) continue;
    if (r.estatus === 'presente') bucket.presentes += 1;
    else if (r.estatus === 'retardo') bucket.retardos += 1;
    else if (r.estatus === 'falta') bucket.faltas += 1;
    else if (r.estatus === 'incompleto') bucket.incompletos += 1;
    else if (r.estatus === 'descanso') bucket.descanso += 1;
    else if (r.estatus === 'registro_parcial') bucket.registroParcial += 1;
    else if (r.estatus === 'fuera_de_rango') bucket.fueraDeRango += 1;
  }

  const rows = empleados.map((emp) =>
    enrichRow({ ...agg.get(String(emp._id)) }, emp, maps)
  );

  return {
    columns: [
      { key: 'numEmpleado', label: 'No. empleado' },
      { key: 'empleado', label: 'Empleado' },
      { key: 'departamento', label: 'Departamento' },
      { key: 'presentes', label: 'Presentes' },
      { key: 'retardos', label: 'Retardos' },
      { key: 'faltas', label: 'Faltas' },
      { key: 'incompletos', label: 'Incompletos' },
      { key: 'descanso', label: 'Descanso' },
      { key: 'registroParcial', label: 'Reg. parcial' },
      { key: 'fueraDeRango', label: 'Fuera de rango' }
    ],
    rows
  };
}

async function reportIncidenciasPeriodo(tenantId, filters) {
  const maps = await loadLookupMaps(tenantId);
  const { empMap, empIds } = await loadEmpleadoContext(tenantId, filters, { soloActivos: false });
  const Incidencia = await getIncidenciaModel();
  const TipoIncidencia = await getTipoIncidenciaModel();

  const incQuery = {
    tenantId,
    fechaInicio: { $lte: filters.fechaFin },
    fechaFin: { $gte: filters.fechaInicio }
  };
  if (filters.empleadoId) incQuery.empleadoId = filters.empleadoId;
  else if (empIds.length) incQuery.empleadoId = { $in: empIds };
  if (filters.tipoIncidenciaId) incQuery.tipoIncidenciaId = filters.tipoIncidenciaId;
  if (filters.estatusIncidencia) incQuery.estatus = filters.estatusIncidencia;

  const [incidencias, tipos] = await Promise.all([
    Incidencia.find(incQuery).sort({ fechaInicio: -1 }).lean(),
    TipoIncidencia.find({ tenantId }).lean()
  ]);
  const tipoMap = new Map(tipos.map((t) => [String(t._id), t]));

  const rows = incidencias
    .filter((inc) => empMap.has(String(inc.empleadoId)))
    .map((inc) => {
      const emp = empMap.get(String(inc.empleadoId));
      const tipo = inc.tipoIncidenciaId ? tipoMap.get(String(inc.tipoIncidenciaId)) : null;
      return enrichRow(
        {
          codigo: inc.codigo,
          tipo: tipo?.nombre || inc.codigo,
          fechaInicio: formatDateMX(inc.fechaInicio),
          fechaFin: formatDateMX(inc.fechaFin),
          dias: inc.diasAfectados ?? 0,
          minutos: inc.minutosAfectados ?? 0,
          estatus: inc.estatus,
          origen: inc.origen,
          motivo: inc.motivo || ''
        },
        emp,
        maps
      );
    });

  return {
    columns: [
      { key: 'numEmpleado', label: 'No. empleado' },
      { key: 'empleado', label: 'Empleado' },
      { key: 'departamento', label: 'Departamento' },
      { key: 'codigo', label: 'Código' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'fechaInicio', label: 'Desde' },
      { key: 'fechaFin', label: 'Hasta' },
      { key: 'dias', label: 'Días' },
      { key: 'minutos', label: 'Minutos' },
      { key: 'estatus', label: 'Estatus' },
      { key: 'origen', label: 'Origen' }
    ],
    rows
  };
}

async function reportRetardos(tenantId, filters) {
  const maps = await loadLookupMaps(tenantId);
  const { empMap, empIds } = await loadEmpleadoContext(tenantId, filters);
  const DailyAttendance = await getDailyAttendanceModel();

  const registros = await DailyAttendance.find({
    tenantId,
    empleadoId: { $in: empIds },
    fecha: { $gte: filters.fechaInicio, $lte: filters.fechaFin },
    minutosRetardo: { $gt: 0 }
  })
    .sort({ fecha: -1 })
    .lean();

  const acum = new Map();
  const rows = [];
  for (const r of registros) {
    const emp = empMap.get(String(r.empleadoId));
    if (!emp) continue;
    const key = String(r.empleadoId);
    acum.set(key, (acum.get(key) || 0) + (r.minutosRetardo || 0));
    rows.push(
      enrichRow(
        {
          fecha: formatDateMX(r.fecha),
          minutos: r.minutosRetardo,
          estatus: ESTATUS_DIARIO[r.estatus] || r.estatus
        },
        emp,
        maps
      )
    );
  }

  const resumen = [...acum.entries()]
    .map(([empId, minutos]) => {
      const emp = empMap.get(empId);
      return enrichRow({ eventos: registros.filter((r) => String(r.empleadoId) === empId).length, minutosAcumulados: minutos }, emp, maps);
    })
    .sort((a, b) => b.minutosAcumulados - a.minutosAcumulados);

  return {
    columns: [
      { key: 'fecha', label: 'Fecha' },
      { key: 'numEmpleado', label: 'No. empleado' },
      { key: 'empleado', label: 'Empleado' },
      { key: 'departamento', label: 'Departamento' },
      { key: 'minutos', label: 'Minutos retardo' },
      { key: 'estatus', label: 'Estatus día' }
    ],
    rows,
    resumen: {
      title: 'Acumulado por empleado',
      columns: [
        { key: 'empleado', label: 'Empleado' },
        { key: 'departamento', label: 'Departamento' },
        { key: 'eventos', label: 'Eventos' },
        { key: 'minutosAcumulados', label: 'Minutos acumulados' }
      ],
      rows: resumen
    }
  };
}

async function reportFaltas(tenantId, filters) {
  const maps = await loadLookupMaps(tenantId);
  const { empMap, empIds } = await loadEmpleadoContext(tenantId, filters);
  const DailyAttendance = await getDailyAttendanceModel();
  const Incidencia = await getIncidenciaModel();

  const [registros, incidencias] = await Promise.all([
    DailyAttendance.find({
      tenantId,
      empleadoId: { $in: empIds },
      fecha: { $gte: filters.fechaInicio, $lte: filters.fechaFin },
      estatus: 'falta'
    })
      .sort({ fecha: -1 })
      .lean(),
    Incidencia.find({
      tenantId,
      empleadoId: { $in: empIds },
      estatus: 'aprobada',
      codigo: { $in: ['FI', 'PSG', 'VAC', 'PCG'] },
      fechaInicio: { $lte: filters.fechaFin },
      fechaFin: { $gte: filters.fechaInicio }
    }).lean()
  ]);

  const justificadas = new Set(
    incidencias.filter((i) => ['FI', 'PSG', 'VAC', 'PCG'].includes(i.codigo)).map((i) => String(i.empleadoId))
  );

  const rows = registros.map((r) => {
    const emp = empMap.get(String(r.empleadoId));
    const tipo = justificadas.has(String(r.empleadoId)) ? 'Justificada (incidencia)' : 'Injustificada';
    return enrichRow(
      {
        fecha: formatDateMX(r.fecha),
        tipo,
        notas: r.notas || ''
      },
      emp,
      maps
    );
  });

  return {
    columns: [
      { key: 'fecha', label: 'Fecha' },
      { key: 'numEmpleado', label: 'No. empleado' },
      { key: 'empleado', label: 'Empleado' },
      { key: 'departamento', label: 'Departamento' },
      { key: 'tipo', label: 'Clasificación' },
      { key: 'notas', label: 'Notas' }
    ],
    rows
  };
}

async function reportHorasExtra(tenantId, filters) {
  const maps = await loadLookupMaps(tenantId);
  const { empMap, empIds } = await loadEmpleadoContext(tenantId, filters);
  const DailyAttendance = await getDailyAttendanceModel();

  const registros = await DailyAttendance.find({
    tenantId,
    empleadoId: { $in: empIds },
    fecha: { $gte: filters.fechaInicio, $lte: filters.fechaFin },
    $or: [
      { minutosHorasExtra: { $gt: 0 } },
      { minutosHEOrdinaria: { $gt: 0 } },
      { minutosHEDoble: { $gt: 0 } },
      { minutosHETriple: { $gt: 0 } }
    ]
  })
    .sort({ fecha: -1 })
    .lean();

  const acum = new Map();
  const rows = registros.map((r) => {
    const emp = empMap.get(String(r.empleadoId));
    const key = String(r.empleadoId);
    const prev = acum.get(key) || { ord: 0, doble: 0, triple: 0, total: 0 };
    prev.ord += r.minutosHEOrdinaria || 0;
    prev.doble += r.minutosHEDoble || 0;
    prev.triple += r.minutosHETriple || 0;
    prev.total += r.minutosHorasExtra || 0;
    acum.set(key, prev);
    return enrichRow(
      {
        fecha: formatDateMX(r.fecha),
        heOrdinaria: r.minutosHEOrdinaria || 0,
        heDoble: r.minutosHEDoble || 0,
        heTriple: r.minutosHETriple || 0,
        total: r.minutosHorasExtra || 0
      },
      emp,
      maps
    );
  });

  const resumen = [...acum.entries()]
    .map(([empId, mins]) => enrichRow(mins, empMap.get(empId), maps))
    .sort((a, b) => b.total - a.total);

  return {
    columns: [
      { key: 'fecha', label: 'Fecha' },
      { key: 'empleado', label: 'Empleado' },
      { key: 'departamento', label: 'Departamento' },
      { key: 'heOrdinaria', label: 'HE ord. (min)' },
      { key: 'heDoble', label: 'HE doble (min)' },
      { key: 'heTriple', label: 'HE triple (min)' },
      { key: 'total', label: 'Total (min)' }
    ],
    rows,
    resumen: {
      title: 'Acumulado por empleado',
      columns: [
        { key: 'empleado', label: 'Empleado' },
        { key: 'ord', label: 'Ordinaria' },
        { key: 'doble', label: 'Doble' },
        { key: 'triple', label: 'Triple' },
        { key: 'total', label: 'Total' }
      ],
      rows: resumen
    }
  };
}

async function reportAsistenciaPerfecta(tenantId, filters) {
  const maps = await loadLookupMaps(tenantId);
  const { empleados, empIds } = await loadEmpleadoContext(tenantId, filters);
  const DailyAttendance = await getDailyAttendanceModel();
  const Incidencia = await getIncidenciaModel();

  const [registros, incidencias] = await Promise.all([
    DailyAttendance.find({
      tenantId,
      empleadoId: { $in: empIds },
      fecha: { $gte: filters.fechaInicio, $lte: filters.fechaFin },
      estatus: { $in: ['retardo', 'falta', 'incompleto', 'registro_parcial', 'fuera_de_rango'] }
    }).lean(),
    Incidencia.find({
      tenantId,
      empleadoId: { $in: empIds },
      estatus: { $in: ['aprobada', 'pendiente'] },
      fechaInicio: { $lte: filters.fechaFin },
      fechaFin: { $gte: filters.fechaInicio }
    }).lean()
  ]);

  const conProblema = new Set([
    ...registros.map((r) => String(r.empleadoId)),
    ...incidencias.map((i) => String(i.empleadoId))
  ]);

  const rows = empleados
    .filter((emp) => !conProblema.has(String(emp._id)))
    .map((emp) => enrichRow({ diasLaborables: 'Sin incidencias' }, emp, maps));

  return {
    columns: [
      { key: 'numEmpleado', label: 'No. empleado' },
      { key: 'empleado', label: 'Empleado' },
      { key: 'departamento', label: 'Departamento' },
      { key: 'turno', label: 'Turno' },
      { key: 'diasLaborables', label: 'Observación' }
    ],
    rows,
    summary: { total: rows.length }
  };
}

async function reportVacaciones(tenantId, filters) {
  const maps = await loadLookupMaps(tenantId);
  const { empleados, empMap } = await loadEmpleadoContext(tenantId, filters);
  const VacacionSaldo = await getVacacionSaldoModel();
  const Incidencia = await getIncidenciaModel();

  const saldos = await VacacionSaldo.find({ tenantId, anio: filters.anio }).lean();
  const saldoMap = new Map(saldos.map((s) => [String(s.empleadoId), s]));

  const vacInc = await Incidencia.find({
    tenantId,
    codigo: 'VAC',
    estatus: 'aprobada',
    fechaInicio: {
      $gte: startOfDay(new Date(filters.anio, 0, 1)),
      $lte: endOfDay(new Date(filters.anio, 11, 31))
    }
  }).lean();

  const tomadosMap = new Map();
  for (const inc of vacInc) {
    if (!empMap.has(String(inc.empleadoId))) continue;
    const key = String(inc.empleadoId);
    tomadosMap.set(key, (tomadosMap.get(key) || 0) + (inc.diasAfectados || 0));
  }

  const rows = empleados.map((emp) => {
    const saldo = saldoMap.get(String(emp._id));
    return enrichRow(
      {
        diasCorresponden: saldo?.diasCorresponden ?? 0,
        diasTomados: saldo?.diasTomados ?? tomadosMap.get(String(emp._id)) ?? 0,
        diasPendientes: saldo?.diasPendientes ?? 0
      },
      emp,
      maps
    );
  });

  return {
    columns: [
      { key: 'numEmpleado', label: 'No. empleado' },
      { key: 'empleado', label: 'Empleado' },
      { key: 'departamento', label: 'Departamento' },
      { key: 'diasCorresponden', label: 'Corresponden' },
      { key: 'diasTomados', label: 'Tomados' },
      { key: 'diasPendientes', label: 'Pendientes' }
    ],
    rows
  };
}

async function reportRotacionPersonal(tenantId, filters) {
  const maps = await loadLookupMaps(tenantId);
  const Empleado = await getEmpleadoModel();
  const baseQuery = buildEmpleadoQuery(tenantId, filters, {});
  const empleados = await Empleado.find(baseQuery).lean();

  const rows = [];
  for (const emp of empleados) {
    const ingreso = emp.fechaIngreso ? new Date(emp.fechaIngreso) : null;
    const baja = emp.fechaBaja ? new Date(emp.fechaBaja) : null;
    if (ingreso && ingreso >= filters.fechaInicio && ingreso <= filters.fechaFin) {
      rows.push(
        enrichRow(
          {
            movimiento: 'Alta',
            fecha: formatDateMX(ingreso),
            motivo: 'Ingreso',
            estatus: emp.estatus
          },
          emp,
          maps
        )
      );
    }
    if (baja && baja >= filters.fechaInicio && baja <= filters.fechaFin) {
      rows.push(
        enrichRow(
          {
            movimiento: 'Baja',
            fecha: formatDateMX(baja),
            motivo: emp.motivoBaja || '—',
            estatus: emp.estatus
          },
          emp,
          maps
        )
      );
    }
  }

  rows.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));

  return {
    columns: [
      { key: 'movimiento', label: 'Movimiento' },
      { key: 'fecha', label: 'Fecha' },
      { key: 'numEmpleado', label: 'No. empleado' },
      { key: 'empleado', label: 'Empleado' },
      { key: 'departamento', label: 'Departamento' },
      { key: 'motivo', label: 'Motivo' },
      { key: 'estatus', label: 'Estatus actual' }
    ],
    rows
  };
}

async function reportProductividadTurno(tenantId, filters) {
  const maps = await loadLookupMaps(tenantId);
  const { empIds } = await loadEmpleadoContext(tenantId, filters);
  const DailyAttendance = await getDailyAttendanceModel();

  const matchTurno = filters.turnoId ? { turnoId: filters.turnoId } : {};
  const registros = await DailyAttendance.find({
    tenantId,
    empleadoId: { $in: empIds },
    fecha: { $gte: filters.fechaInicio, $lte: filters.fechaFin },
    ...matchTurno
  }).lean();

  const agg = new Map();
  for (const r of registros) {
    const turnoKey = r.turnoId ? String(r.turnoId) : 'sin_turno';
    const bucket = agg.get(turnoKey) || { total: 0, ok: 0 };
    bucket.total += 1;
    if (['presente', 'retardo'].includes(r.estatus)) bucket.ok += 1;
    agg.set(turnoKey, bucket);
  }

  const rows = [...agg.entries()].map(([turnoId, stats]) => ({
    turno: turnoId === 'sin_turno' ? 'Sin turno' : maps.turnoMap.get(turnoId) || turnoId,
    diasRegistrados: stats.total,
    asistenciasOk: stats.ok,
    porcentaje: stats.total ? Math.round((stats.ok / stats.total) * 1000) / 10 : 0
  }));

  rows.sort((a, b) => b.porcentaje - a.porcentaje);

  return {
    columns: [
      { key: 'turno', label: 'Turno' },
      { key: 'diasRegistrados', label: 'Días registrados' },
      { key: 'asistenciasOk', label: 'Presente/retardo' },
      { key: 'porcentaje', label: '% asistencia' }
    ],
    rows
  };
}

async function reportRegistrosParciales(tenantId, filters) {
  return reportByEstatus(tenantId, filters, 'registro_parcial', 'Registro parcial');
}

async function reportMarcajesFueraRango(tenantId, filters) {
  return reportByEstatus(tenantId, filters, 'fuera_de_rango', 'Fuera de rango');
}

async function reportByEstatus(tenantId, filters, estatus, label) {
  const maps = await loadLookupMaps(tenantId);
  const { empMap, empIds } = await loadEmpleadoContext(tenantId, filters);
  const DailyAttendance = await getDailyAttendanceModel();
  const Incidencia = await getIncidenciaModel();

  const registros = await DailyAttendance.find({
    tenantId,
    empleadoId: { $in: empIds },
    fecha: { $gte: filters.fechaInicio, $lte: filters.fechaFin },
    estatus
  })
    .sort({ fecha: -1 })
    .lean();

  const incidencias = await Incidencia.find({
    tenantId,
    empleadoId: { $in: empIds },
    codigo: estatus === 'fuera_de_rango' ? 'FR' : 'RP',
    estatus: { $in: ['pendiente', 'aprobada'] }
  }).lean();
  const incMap = new Map(incidencias.map((i) => [`${i.empleadoId}_${formatDateMX(i.fechaInicio)}`, i]));

  const rows = registros.map((r) => {
    const emp = empMap.get(String(r.empleadoId));
    const incKey = `${r.empleadoId}_${formatDateMX(r.fecha)}`;
    const inc = incMap.get(incKey);
    return enrichRow(
      {
        fecha: formatDateMX(r.fecha),
        estatus: label,
        justificacion: inc ? inc.estatus : 'Sin solicitud',
        notas: r.notas || ''
      },
      emp,
      maps
    );
  });

  return {
    columns: [
      { key: 'fecha', label: 'Fecha' },
      { key: 'empleado', label: 'Empleado' },
      { key: 'departamento', label: 'Departamento' },
      { key: 'estatus', label: 'Estatus' },
      { key: 'justificacion', label: 'Justificación' },
      { key: 'notas', label: 'Notas' }
    ],
    rows
  };
}

async function reportSinCodigoExterno(tenantId, filters) {
  const maps = await loadLookupMaps(tenantId);
  const PayrollPeriod = await getPayrollPeriodModel();
  let period = null;
  if (filters.periodoId) {
    period = await PayrollPeriod.findOne({ _id: filters.periodoId, tenantId }).lean();
  } else {
    period = await PayrollPeriod.findOne({
      tenantId,
      fechaInicio: { $lte: filters.fechaFin },
      fechaFin: { $gte: filters.fechaInicio }
    })
      .sort({ fechaInicio: -1 })
      .lean();
  }

  if (!period) {
    const Empleado = await getEmpleadoModel();
    const empleados = await Empleado.find({
      tenantId,
      estatus: 'activo',
      $or: [{ codigoExterno: '' }, { codigoExterno: { $exists: false } }]
    }).lean();
    const rows = empleados.map((emp) =>
      enrichRow({ observacion: 'Sin código externo capturado' }, emp, maps)
    );
    return {
      columns: [
        { key: 'numEmpleado', label: 'No. empleado' },
        { key: 'empleado', label: 'Empleado' },
        { key: 'departamento', label: 'Departamento' },
        { key: 'observacion', label: 'Observación' }
      ],
      rows
    };
  }

  const validacion = await validateCodigoExternoForPeriod(period, tenantId);
  const Empleado = await getEmpleadoModel();
  const empleados = await Empleado.find({
    _id: { $in: validacion.sinCodigo.map((e) => e._id) }
  }).lean();

  const rows = empleados.map((emp) =>
    enrichRow(
      {
        observacion: 'Con movimientos en período sin código externo',
        periodo: `${formatDateMX(period.fechaInicio)} – ${formatDateMX(period.fechaFin)}`
      },
      emp,
      maps
    )
  );

  return {
    columns: [
      { key: 'numEmpleado', label: 'No. empleado' },
      { key: 'empleado', label: 'Empleado' },
      { key: 'departamento', label: 'Departamento' },
      { key: 'periodo', label: 'Período' },
      { key: 'observacion', label: 'Observación' }
    ],
    rows,
    summary: { totalAfectados: validacion.totalAfectados, sinCodigo: validacion.sinCodigo.length }
  };
}

async function reportPrenomina(tenantId, filters, estatus) {
  const maps = await loadLookupMaps(tenantId);
  const PayrollPeriod = await getPayrollPeriodModel();
  const PayrollDetail = await getPayrollDetailModel();
  const Empleado = await getEmpleadoModel();

  const periodQuery = { tenantId, estatus };
  if (filters.periodoId) periodQuery._id = filters.periodoId;

  const periodos = await PayrollPeriod.find(periodQuery).sort({ fechaInicio: -1 }).limit(24).lean();
  const period = filters.periodoId
    ? periodos.find((p) => String(p._id) === String(filters.periodoId))
    : periodos[0];
  if (!period) {
    return {
      columns: [
        { key: 'periodo', label: 'Período' },
        { key: 'empleado', label: 'Empleado' },
        { key: 'diasTrabajados', label: 'Días trab.' },
        { key: 'diasFalta', label: 'Faltas' },
        { key: 'minutosRetardo', label: 'Retardo (min)' },
        { key: 'minutosHorasExtra', label: 'HE (min)' },
        { key: 'netoPagar', label: 'Neto' }
      ],
      rows: []
    };
  }

  const detalles = await PayrollDetail.find({ tenantId, periodId: period._id }).lean();
  const empleados = await Empleado.find({ tenantId }).lean();
  const empMap = new Map(empleados.map((e) => [String(e._id), e]));

  const rows = detalles.map((det) => {
    const emp = empMap.get(String(det.empleadoId));
    return enrichRow(
      {
        periodo: `${formatDateMX(period.fechaInicio)} – ${formatDateMX(period.fechaFin)}`,
        diasTrabajados: det.diasTrabajados ?? 0,
        diasFalta: det.diasFalta ?? 0,
        minutosRetardo: det.minutosRetardo ?? 0,
        minutosHorasExtra: det.minutosHorasExtra ?? 0,
        netoPagar: det.netoPagar ?? 0
      },
      emp,
      maps
    );
  });

  return {
    columns: [
      { key: 'periodo', label: 'Período' },
      { key: 'numEmpleado', label: 'No. empleado' },
      { key: 'empleado', label: 'Empleado' },
      { key: 'departamento', label: 'Departamento' },
      { key: 'diasTrabajados', label: 'Días trab.' },
      { key: 'diasFalta', label: 'Faltas' },
      { key: 'minutosRetardo', label: 'Retardo (min)' },
      { key: 'minutosHorasExtra', label: 'HE (min)' },
      { key: 'netoPagar', label: 'Neto' }
    ],
    rows,
    summary: {
      periodo: period,
      totales: period.totales || {}
    }
  };
}

async function reportConciliacionExport(tenantId, filters) {
  const SyncLog = await getSyncLogModel();
  const logs = await SyncLog.find({
    tenantId,
    tipo: 'prenomina_export',
    createdAt: { $gte: filters.fechaInicio, $lte: filters.fechaFin }
  })
    .sort({ createdAt: -1 })
    .lean();

  const rows = logs.map((log) => ({
    fecha: formatDateMX(log.createdAt),
    adaptador: log.adaptador || '—',
    referencia: log.referenciaId || '—',
    estatus: log.estatus,
    registrosOk: log.registrosOk ?? 0,
    registrosError: log.registrosError ?? 0,
    detalle: (log.detalle || '').slice(0, 120)
  }));

  return {
    columns: [
      { key: 'fecha', label: 'Fecha' },
      { key: 'adaptador', label: 'Sistema destino' },
      { key: 'referencia', label: 'Referencia' },
      { key: 'estatus', label: 'Estatus' },
      { key: 'registrosOk', label: 'OK' },
      { key: 'registrosError', label: 'Errores' },
      { key: 'detalle', label: 'Detalle' }
    ],
    rows
  };
}

async function reportDispositivos(tenantId) {
  const BiometricDevice = await getBiometricDeviceModel();
  const dispositivos = await BiometricDevice.find({ tenantId }).sort({ nombre: 1 }).lean();

  const rows = dispositivos.map((d) => ({
    nombre: d.nombre,
    tipo: d.tipo,
    ubicacion: d.ubicacion || '—',
    host: d.host || '—',
    estatus: d.estatus,
    ultimoPing: d.ultimoPing ? formatDateMX(d.ultimoPing) : '—',
    empleadosSincronizados: d.empleadosSincronizados ?? 0,
    activo: d.activo ? 'Sí' : 'No'
  }));

  return {
    columns: [
      { key: 'nombre', label: 'Dispositivo' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'ubicacion', label: 'Ubicación' },
      { key: 'estatus', label: 'Estatus' },
      { key: 'ultimoPing', label: 'Último ping' },
      { key: 'empleadosSincronizados', label: 'Emp. sincronizados' },
      { key: 'activo', label: 'Activo' }
    ],
    rows
  };
}

const RUNNERS = {
  'asistencia-periodo': reportAsistenciaPeriodo,
  'incidencias-periodo': reportIncidenciasPeriodo,
  retardos: reportRetardos,
  faltas: reportFaltas,
  'horas-extra': reportHorasExtra,
  'asistencia-perfecta': reportAsistenciaPerfecta,
  vacaciones: reportVacaciones,
  'rotacion-personal': reportRotacionPersonal,
  'productividad-turno': reportProductividadTurno,
  'registros-parciales': reportRegistrosParciales,
  'marcajes-fuera-rango': reportMarcajesFueraRango,
  'sin-codigo-externo': reportSinCodigoExterno,
  'prenomina-borrador': (tenantId, filters) => reportPrenomina(tenantId, filters, 'borrador'),
  'prenomina-cerrada': (tenantId, filters) => reportPrenomina(tenantId, filters, 'cerrado'),
  'conciliacion-export': reportConciliacionExport,
  dispositivos: (tenantId) => reportDispositivos(tenantId)
};

async function runReport(slug, tenantId, filters) {
  const runner = RUNNERS[slug];
  if (!runner) return null;
  return runner(tenantId, filters);
}

module.exports = { runReport, loadLookupMaps };

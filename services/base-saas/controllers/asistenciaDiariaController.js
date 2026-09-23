const getEmpleadoModel = require('../models/empleado');
const getTurnoModel = require('../models/turno');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const getDepartamentoModel = require('../models/departamento');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString, parseOptionalObjectId } = require('../libs/formHelpers');
const { parseDateTimeLocal, startOfDay, endOfDay, formatTimeHHMM } = require('../libs/timeHelpers');
const { ESTATUS_DIARIO } = require('../config/asistencia');
const { recalculateDayForTenant } = require('../services/attendanceProcessingService');
const { listTiposPeriodo } = require('../services/tipoPeriodoNominaService');

function defaultFechaQuery(req) {
  return trimString(req.query.fecha) || new Date().toISOString().slice(0, 10);
}

function labelPeriodo(p, tipoMap) {
  if (!p) return '';
  const tipoNom =
    (p.tipoPeriodoId && tipoMap.get(String(p.tipoPeriodoId))) || p.tipo || '';
  const num = p.numeroPeriodo != null ? `#${p.numeroPeriodo}` : '';
  const anio = p.anio || '';
  const ini = p.fechaInicio ? startOfDay(p.fechaInicio).toISOString().slice(0, 10) : '';
  const fin = p.fechaFin ? startOfDay(p.fechaFin).toISOString().slice(0, 10) : '';
  return [tipoNom, num, anio, ini && fin ? `${ini}→${fin}` : ''].filter(Boolean).join(' · ');
}

async function listDiaria(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  let fechaStr = defaultFechaQuery(req);
  const estatusFiltro = trimString(req.query.estatus);
  const departamentoId = parseOptionalObjectId(req.query.departamentoId);
  let tipoPeriodoId = parseOptionalObjectId(req.query.tipoPeriodoId);
  const periodoId = parseOptionalObjectId(req.query.periodoId);

  const Empleado = await getEmpleadoModel();
  const Turno = await getTurnoModel();
  const DailyAttendance = await getDailyAttendanceModel();
  const Departamento = await getDepartamentoModel();
  const PayrollPeriod = await getPayrollPeriodModel();

  let periodoSel = null;
  let fechaAjustadaPorPeriodo = false;
  if (empresa && periodoId) {
    periodoSel = await PayrollPeriod.findOne({
      _id: periodoId,
      tenantId: req.session.tenantId
    }).lean();
    if (periodoSel) {
      if (periodoSel.tipoPeriodoId && !tipoPeriodoId) {
        tipoPeriodoId = periodoSel.tipoPeriodoId;
      }
      const ini = startOfDay(periodoSel.fechaInicio);
      const fin = startOfDay(periodoSel.fechaFin);
      let fecha = startOfDay(parseDateTimeLocal(`${fechaStr}T12:00`) || new Date());
      if (fecha < ini || fecha > fin) {
        const hoy = startOfDay(new Date());
        fecha = hoy >= ini && hoy <= fin ? hoy : ini;
        fechaStr = fecha.toISOString().slice(0, 10);
        fechaAjustadaPorPeriodo = true;
      }
    }
  }

  const fecha = startOfDay(parseDateTimeLocal(`${fechaStr}T12:00`) || new Date());

  const empQuery = { tenantId: req.session.tenantId, estatus: 'activo' };
  if (departamentoId) empQuery.departamentoId = departamentoId;
  if (tipoPeriodoId) empQuery.tipoPeriodoId = tipoPeriodoId;
  else if (periodoSel?.tipo && !periodoSel.tipoPeriodoId) {
    // Período sin tipoPeriodoId: filtrar por motor vía tipos del catálogo
  }

  const [empleadosRaw, turnos, resumenes, departamentos, tiposPeriodo, periodos] = empresa
    ? await Promise.all([
        Empleado.find(empQuery).sort({ lastName: 1, firstName: 1 }).lean(),
        Turno.find({ tenantId: req.session.tenantId }).lean(),
        DailyAttendance.find({
          tenantId: req.session.tenantId,
          fecha: { $gte: fecha, $lte: endOfDay(fecha) }
        }).lean(),
        Departamento.find({ tenantId: req.session.tenantId, activo: { $ne: false } })
          .sort({ nombre: 1 })
          .lean(),
        listTiposPeriodo(req.session.tenantId, true),
        PayrollPeriod.find({ tenantId: req.session.tenantId })
          .sort({ anio: -1, numeroPeriodo: -1, fechaInicio: -1 })
          .limit(60)
          .lean()
      ])
    : [[], [], [], [], [], []];

  const tipoPeriodoMap = new Map(
    tiposPeriodo.map((t) => [String(t._id), t.nombre || t.tipoMotor || String(t.codigoLegado)])
  );
  const tiposByMotor = new Map();
  for (const t of tiposPeriodo) {
    const k = String(t.tipoMotor || '').toLowerCase();
    if (!tiposByMotor.has(k)) tiposByMotor.set(k, []);
    tiposByMotor.get(k).push(String(t._id));
  }

  let empleados = empleadosRaw;
  if (periodoSel && !periodoSel.tipoPeriodoId && periodoSel.tipo) {
    const idsMotor = new Set(tiposByMotor.get(String(periodoSel.tipo).toLowerCase()) || []);
    empleados = empleadosRaw.filter((e) => {
      if (!e.tipoPeriodoId) return true;
      return idsMotor.has(String(e.tipoPeriodoId));
    });
  }

  const turnoById = new Map(turnos.map((t) => [String(t._id), t]));
  const turnoMap = new Map(turnos.map((t) => [String(t._id), t.nombre]));
  const deptoMap = new Map(departamentos.map((d) => [String(d._id), d.nombre]));
  const resumenMap = new Map(resumenes.map((r) => [String(r.empleadoId), r]));
  const empIdSet = new Set(empleados.map((e) => String(e._id)));
  const resumenesScope = resumenes.filter((r) => empIdSet.has(String(r.empleadoId)));

  const mostrarComida =
    turnos.some((t) => t.comidaChecada) ||
    resumenesScope.some((r) => r.salidaComida || r.regresoComida);

  const periodoLabel = periodoSel ? labelPeriodo(periodoSel, tipoPeriodoMap) : '';

  const todasFilas = empleados.map((empleado) => {
    const resumen = resumenMap.get(String(empleado._id)) || null;
    const turno = empleado.turnoId ? turnoById.get(String(empleado.turnoId)) : null;
    return {
      empleado,
      resumen,
      comidaChecada: Boolean(turno?.comidaChecada),
      departamentoNombre: empleado.departamentoId
        ? deptoMap.get(String(empleado.departamentoId)) || '—'
        : '—',
      tipoPeriodoNombre: empleado.tipoPeriodoId
        ? tipoPeriodoMap.get(String(empleado.tipoPeriodoId)) || '—'
        : '—',
      periodoNombre: periodoLabel || '—'
    };
  });

  const stats = {
    total: todasFilas.length,
    presentes: resumenesScope.filter((r) => r.estatus === 'presente').length,
    retardos: resumenesScope.filter((r) => r.estatus === 'retardo').length,
    faltas: resumenesScope.filter((r) => r.estatus === 'falta').length,
    incompletos: resumenesScope.filter((r) => r.estatus === 'incompleto').length,
    registroParcial: resumenesScope.filter((r) => r.estatus === 'registro_parcial').length,
    fueraDeRango: resumenesScope.filter((r) => r.estatus === 'fuera_de_rango').length,
    descanso: resumenesScope.filter((r) => r.estatus === 'descanso').length,
    sinProcesar: todasFilas.filter((f) => !f.resumen).length
  };

  let filas = todasFilas;
  if (estatusFiltro === 'sin_procesar') {
    filas = todasFilas.filter((f) => !f.resumen);
  } else if (estatusFiltro) {
    filas = todasFilas.filter((f) => f.resumen && f.resumen.estatus === estatusFiltro);
  }

  res.render('Asistencia/diaria', {
    filas,
    fecha: fechaStr,
    stats,
    estatusFiltro,
    departamentoId: departamentoId ? String(departamentoId) : '',
    tipoPeriodoId: tipoPeriodoId ? String(tipoPeriodoId) : '',
    periodoId: periodoId ? String(periodoId) : '',
    periodoSel,
    periodoLabel,
    fechaAjustadaPorPeriodo,
    departamentos,
    tiposPeriodo,
    periodos,
    labelPeriodo: (p) => labelPeriodo(p, tipoPeriodoMap),
    turnoMap,
    mostrarComida,
    estatusLabels: ESTATUS_DIARIO,
    formatTimeHHMM,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function reprocesarDiaria(req, res) {
  try {
    const fechaStr = defaultFechaQuery(req);
    const fecha = startOfDay(parseDateTimeLocal(`${fechaStr}T12:00`) || new Date());
    await recalculateDayForTenant(req.session.tenantId, fecha);
    req.flash('success', 'Asistencia del día reprocesada para todos los empleados activos');
    const qs = new URLSearchParams({ fecha: fechaStr });
    const dep = parseOptionalObjectId(req.query.departamentoId);
    const tip = parseOptionalObjectId(req.query.tipoPeriodoId);
    const per = parseOptionalObjectId(req.query.periodoId);
    if (dep) qs.set('departamentoId', String(dep));
    if (tip) qs.set('tipoPeriodoId', String(tip));
    if (per) qs.set('periodoId', String(per));
    res.redirect(`/asistencia-diaria?${qs.toString()}`);
  } catch (err) {
    console.error('[asistencia-diaria]', err);
    req.flash('error', 'Error al reprocesar la asistencia');
    res.redirect(`/asistencia-diaria?fecha=${defaultFechaQuery(req)}`);
  }
}

module.exports = { listDiaria, reprocesarDiaria };

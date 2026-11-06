const getEmpleadoModel = require('../models/empleado');
const getTurnoModel = require('../models/turno');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const getDepartamentoModel = require('../models/departamento');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const { requireEmpresaForTenant, scopeEmpresaFilter, scopeTurnoFilter, scopeEmpleadosFromReq, sessionSubsidiariaId } = require('../libs/tenantScope');
const { trimString, parseOptionalObjectId } = require('../libs/formHelpers');
const { formatTimeHHMM, ymdAncla } = require('../libs/timeHelpers');
const {
  contextoFecha,
  mapaZonasPorSubsidiaria,
  mapaZonaPorEmpleado
} = require('../services/zonaHorariaService');
const { ESTATUS_DIARIO } = require('../config/asistencia');
const { recalculateDayForTenant } = require('../services/attendanceProcessingService');
const { resolverRangoAsistencia } = require('../libs/rangoAsistencia');
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
  const ini = p.fechaInicio ? ymdAncla(p.fechaInicio) : '';
  const fin = p.fechaFin ? ymdAncla(p.fechaFin) : '';
  return [tipoNom, num, anio, ini && fin ? `${ini}→${fin}` : ''].filter(Boolean).join(' · ');
}

async function listDiaria(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const rango = await resolverRangoAsistencia(req, empresa);
  let fechaDesde = rango.fechaDesde;
  let fechaHasta = rango.fechaHasta;
  const zonaPagina = rango.zona;
  const estatusFiltro = trimString(req.query.estatus);
  const soloHe = trimString(req.query.he) === '1';
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
    const scope = scopeEmpresaFilter(req, empresa);
    periodoSel = await PayrollPeriod.findOne({
      _id: periodoId,
      ...scope
    }).lean();
    if (periodoSel) {
      if (periodoSel.tipoPeriodoId && !tipoPeriodoId) {
        tipoPeriodoId = periodoSel.tipoPeriodoId;
      }
      const ini = ymdAncla(periodoSel.fechaInicio, zonaPagina);
      const fin = ymdAncla(periodoSel.fechaFin, zonaPagina);
      const antes = `${fechaDesde}|${fechaHasta}`;
      if (ini && fechaDesde < ini) fechaDesde = ini;
      if (fin && fechaHasta > fin) fechaHasta = fin;
      if (fechaDesde > fechaHasta) {
        fechaDesde = ini || fechaDesde;
        fechaHasta = fin || fechaHasta;
      }
      fechaAjustadaPorPeriodo = antes !== `${fechaDesde}|${fechaHasta}`;
    }
  }

  const unDia = fechaDesde === fechaHasta;
  const fecha = new Date(`${fechaDesde}T00:00:00.000Z`);
  const fechaFin = new Date(`${fechaHasta}T23:59:59.999Z`);
  const fechaStr = fechaHasta;

  const empQuery = scopeEmpleadosFromReq(req, empresa, { soloActivos: true }) || {
    tenantId: req.session.tenantId,
    estatus: 'activo'
  };
  if (departamentoId) empQuery.departamentoId = departamentoId;
  if (tipoPeriodoId) empQuery.tipoPeriodoId = tipoPeriodoId;
  else if (periodoSel?.tipo && !periodoSel.tipoPeriodoId) {
    // Período sin tipoPeriodoId: filtrar por motor vía tipos del catálogo
  }

  const scopePeriodos = scopeEmpresaFilter(req, empresa);
  const [empleadosRaw, turnos, resumenes, departamentos, tiposPeriodo, periodos] = empresa
    ? await Promise.all([
        Empleado.find(empQuery).sort({ lastName: 1, firstName: 1 }).lean(),
        Turno.find(scopeTurnoFilter(req, empresa) || { tenantId: req.session.tenantId }).lean(),
        DailyAttendance.find({
          tenantId: req.session.tenantId,
          fecha: { $gte: fecha, $lte: fechaFin }
        }).lean(),
        Departamento.find({ ...(scopePeriodos || { tenantId: req.session.tenantId }), activo: { $ne: false } })
          .sort({ nombre: 1 })
          .lean(),
        listTiposPeriodo(req.session.tenantId, true, empresa._id),
        PayrollPeriod.find(scopePeriodos || { tenantId: req.session.tenantId })
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
  const empById = new Map(empleados.map((e) => [String(e._id), e]));

  const mostrarComida =
    turnos.some((t) => t.comidaChecada) ||
    resumenesScope.some((r) => r.salidaComida || r.regresoComida);

  const periodoLabel = periodoSel ? labelPeriodo(periodoSel, tipoPeriodoMap) : '';

  const mapaSubs = await mapaZonasPorSubsidiaria(empleados.map((e) => e.subsidiariaId));
  const zonaPorEmp = mapaZonaPorEmpleado(empleados, mapaSubs);
  function filaDe(empleado, resumen) {
    const turno = empleado.turnoId ? turnoById.get(String(empleado.turnoId)) : null;
    return {
      empleado,
      resumen,
      fechaYmd: resumen && resumen.fecha ? new Date(resumen.fecha).toISOString().slice(0, 10) : fechaDesde,
      zonaHoraria: (resumen && resumen.zonaHoraria) || zonaPorEmp.get(String(empleado._id)) || zonaPagina,
      comidaChecada: Boolean(turno?.comidaChecada),
      departamentoNombre: empleado.departamentoId
        ? deptoMap.get(String(empleado.departamentoId)) || '—'
        : '—',
      tipoPeriodoNombre: empleado.tipoPeriodoId
        ? tipoPeriodoMap.get(String(empleado.tipoPeriodoId)) || '—'
        : '—',
      periodoNombre: periodoLabel || '—'
    };
  }

  const todasFilas = unDia
    ? empleados.map((empleado) => filaDe(empleado, resumenMap.get(String(empleado._id)) || null))
    : resumenesScope
        .map((resumen) => {
          const empleado = empById.get(String(resumen.empleadoId));
          return empleado ? filaDe(empleado, resumen) : null;
        })
        .filter(Boolean)
        .sort((a, b) => String(b.fechaYmd).localeCompare(String(a.fechaYmd)));

  const sinTurno = empleados
    .filter((e) => !e.turnoId)
    .map((e) => ({
      id: e._id,
      nombre: `${e.firstName || ''} ${e.lastName || ''}`.trim(),
      num: e.numEmpleado || '',
      departamento: e.departamentoId ? deptoMap.get(String(e.departamentoId)) || '—' : '—'
    }));

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
  if (soloHe) {
    filas = filas.filter((f) => f.resumen && Number(f.resumen.minutosHorasExtra) > 0);
  }

  res.render('Asistencia/diaria', {
    filas,
    fecha: fechaStr,
    fechaDesde,
    fechaHasta,
    unDia,
    stats,
    estatusFiltro,
    soloHe,
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
    sinTurno,
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
    const { empresa } = await requireEmpresaForTenant(req);
    const ctx = await contextoFecha(req.query.fecha || req.body.fecha, sessionSubsidiariaId(req));
    const fechaStr = ctx.ymd;
    const fecha = ctx.desde;
    await recalculateDayForTenant(req.session.tenantId, fecha, {
      empresaId: empresa?._id || null,
      subsidiariaId: sessionSubsidiariaId(req)
    });
    req.flash('success', 'Asistencia del día reprocesada para empleados de la subsidiaria activa');
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

'use strict';

const getPeriodoNominaModel = require('../models/periodoNomina');
const getReciboNominaModel = require('../models/reciboNomina');
const getConceptoAplicadoModel = require('../models/conceptoAplicado');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const getEmpleadoModel = require('../models/empleado');
const getConceptoNominaModel = require('../models/conceptoNomina');
const getTablaFiscalModel = require('../models/tablaFiscal');
const getRangoFiscalModel = require('../models/rangoFiscal');
const getParametroGeneralModel = require('../models/parametroGeneral');
const getCatalogoSatModel = require('../models/catalogoSat');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { tenantHasFeature } = require('../libs/tenantFeatureFlags');
const { resolveNominaConceptoModo, userCanEditNomina, userCanViewNomina } = require('../libs/roleAccess');
const { resolvePeriodRange } = require('../libs/payrollPeriodDates');
const { trimString, parseDate, parseCheckbox, parsePositiveNumber } = require('../libs/formHelpers');
const { parseBodyStringList } = require('../libs/conceptoAplicabilidad');
const { asignarNumeroPeriodo, ensureNumerosPeriodoTenant } = require('../libs/periodoNumero');
const { startOfDay, endOfDay, diasCalendarioInclusive } = require('../libs/timeHelpers');
const { sugerirPagaDespensa } = require('../libs/periodoPrestacionesFlags');
const {
  MODULO_NOMINA,
  SECCIONES_NOMINA,
  RELACION_PRENOMINA,
  TIPOS_PERIODO,
  TIPOS_NOMINA,
  TIPOS_CONCEPTO,
  NATURALEZAS_CONCEPTO,
  ESTATUS_PERIODO_NOMINA,
  VARIABLES_CONTEXTO,
  CATEGORIAS_VARIABLES,
  groupVariablesByCategoria
} = require('../config/nomina');
const {
  ensureNominaConceptsForTenant,
  listConceptos,
  getConceptoConFormulas,
  guardarFormula,
  crearConcepto,
  actualizarConcepto,
  toggleConcepto,
  validarDependenciasGrupo
} = require('../services/nomina/nominaConceptoService');
const { cerrarPeriodo } = require('../services/nomina/calculoNominaService');
const {
  registrarAuditoriaNomina,
  listAuditoriaPeriodo
} = require('../services/nomina/nominaAuditoriaService');
const { resolveUserLabel } = require('../libs/userLabel');

function sessionActor(req) {
  const userId = req.session.userid || req.session.userId || '';
  const userLabel =
    req.session.user ||
    req.session.email ||
    req.session.username ||
    '';
  return { userId, userLabel };
}
const { encolarCalculo, obtenerEstadoJob } = require('../services/nomina/nominaCalculoJobService');
const { validatePeriodoForCalculo } = require('../services/nomina/nominaPreflightService');
const {
  createFormulaScope,
  createFormulaScopeWithCatalog,
  evaluateExpression,
  evaluateCondicion,
  validateFormulaSyntax,
  normalizeConditionComparisons,
  redondear
} = require('../services/nomina/formulaEvaluator');
const { obtenerParametrosVigentes } = require('../services/nomina/tablasFiscalesService');

function featureFlagsFromReq(req) {
  return req.tenant?.featureFlags || req.session?.featureFlags || {};
}

function requireNominaFeature(req, res) {
  if (tenantHasFeature(featureFlagsFromReq(req), 'nomina')) return null;
  req.flash('error', 'El módulo de Nómina no está habilitado para este tenant.');
  res.redirect('/dashboard');
  return false;
}

function requireNominaViewOrRedirect(req, res) {
  if (requireNominaFeature(req, res) === false) return false;
  if (userCanViewNomina(req.session)) return null;
  req.flash('error', 'Tu rol no tiene permiso para consultar nómina.');
  res.redirect('/dashboard');
  return false;
}

function nominaEditFallback(req, codigo) {
  if (codigo) {
    return `/nomina/conceptos/${encodeURIComponent(String(codigo).toUpperCase())}?modo=vista`;
  }
  const path = String(req.originalUrl || req.path || '');
  if (path.includes('/nomina/periodos/') && req.params?.id) {
    return `/nomina/periodos/${req.params.id}`;
  }
  if (path.includes('/nomina/configuracion')) return '/nomina/configuracion';
  if (path.includes('/nomina/periodos')) return '/nomina/periodos';
  return '/nomina';
}

function requireNominaEditOrRedirect(req, res, codigo = null) {
  if (requireNominaFeature(req, res) === false) return false;
  if (userCanEditNomina(req.session)) return null;
  req.flash(
    'error',
    'Tu rol solo puede consultar nómina. Calcular, cerrar o editar requiere el rol «Nómina operativa».'
  );
  res.redirect(nominaEditFallback(req, codigo));
  return false;
}

function diasEntre(inicio, fin) {
  return diasCalendarioInclusive(inicio, fin);
}

async function index(req, res) {
  if (requireNominaViewOrRedirect(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);

  res.render('Nomina/index', {
    modulo: MODULO_NOMINA,
    secciones: SECCIONES_NOMINA,
    relacionPrenomina: RELACION_PRENOMINA,
    empresa,
    error: error || null,
    session: req.session
  });
}

// ── Períodos ─────────────────────────────────────────────

async function periodos(req, res) {
  if (requireNominaViewOrRedirect(req, res) === false) return;
  const tenantId = req.session.tenantId;
  const { empresa, error } = await requireEmpresaForTenant(tenantId);
  const PeriodoNomina = await getPeriodoNominaModel();
  const PayrollPeriod = await getPayrollPeriodModel();

  if (empresa) {
    await ensureNumerosPeriodoTenant(PeriodoNomina, tenantId);
  }

  const periodosList = empresa
    ? await PeriodoNomina.find({ tenantId }).sort({ anio: -1, tipoPeriodo: 1, numeroPeriodo: -1, fechaInicio: -1 }).limit(40).lean()
    : [];
  const prenominaPeriodos = empresa
    ? await PayrollPeriod.find({ tenantId, compartirConNomina: true })
        .sort({ fechaInicio: -1 })
        .limit(40)
        .lean()
    : [];

  res.render('Nomina/periodos', {
    periodos: periodosList,
    prenominaPeriodos,
    tiposPeriodo: TIPOS_PERIODO,
    tiposNomina: TIPOS_NOMINA,
    estatusLabels: ESTATUS_PERIODO_NOMINA,
    sugerirPagaDespensaDefault: sugerirPagaDespensa('quincenal', new Date()),
    empresa,
    error: error || null,
    canEdit: userCanEditNomina(req.session),
    session: req.session
  });
}

async function createPeriodo(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const tenantId = req.session.tenantId;
    const { empresa, error } = await requireEmpresaForTenant(tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/nomina/periodos');
    }

    const tipoPeriodo = trimString(req.body.tipoPeriodo) || 'quincenal';
    const tipoNomina = trimString(req.body.tipoNomina) || 'ordinaria';
    const ref = parseDate(req.body.fechaReferencia) || new Date();
    let { fechaInicio, fechaFin } = resolvePeriodRange(tipoPeriodo, ref);

    await ensureNominaConceptsForTenant(tenantId, empresa._id);

    const payrollPeriodId = trimString(req.body.payrollPeriodId) || null;
    let prePeriodo = null;
    if (payrollPeriodId) {
      const PayrollPeriod = await getPayrollPeriodModel();
      prePeriodo = await PayrollPeriod.findOne({ tenantId, _id: payrollPeriodId }).lean();
      if (!prePeriodo) {
        req.flash('error', 'El período de pre-nómina seleccionado no existe');
        return res.redirect('/nomina/periodos');
      }
      if (!prePeriodo.compartirConNomina) {
        req.flash('error', 'El período de pre-nómina no está marcado para compartirse con nómina');
        return res.redirect('/nomina/periodos');
      }
      if (prePeriodo.tipo && String(prePeriodo.tipo).toLowerCase() !== String(tipoPeriodo).toLowerCase()) {
        req.flash(
          'error',
          `La pre-nómina es «${prePeriodo.tipo}» y el período de nómina es «${tipoPeriodo}». Deben coincidir.`
        );
        return res.redirect('/nomina/periodos');
      }
      // Alinear fechas con la pre-nómina vinculada (fuente de asistencia)
      fechaInicio = startOfDay(prePeriodo.fechaInicio);
      fechaFin = endOfDay(prePeriodo.fechaFin);
    }

    const PeriodoNomina = await getPeriodoNominaModel();
    const exists = await PeriodoNomina.findOne({
      tenantId,
      tipoPeriodo,
      tipoNomina,
      fechaInicio: startOfDay(fechaInicio),
      fechaFin: endOfDay(fechaFin)
    });
    if (exists) {
      req.flash('error', 'Ya existe un período de nómina con esas fechas y tipo');
      return res.redirect('/nomina/periodos');
    }

    const { anio, numeroPeriodo } = await asignarNumeroPeriodo(PeriodoNomina, {
      tenantId,
      tipoPeriodo,
      fechaInicio
    });

    const lastBody = (name) => {
      const v = req.body[name];
      if (Array.isArray(v)) return v[v.length - 1];
      return v;
    };
    const pagaDespensa = lastBody('pagaDespensa') === '1' || lastBody('pagaDespensa') === true;
    const despensaMontoOverride = parsePositiveNumber(req.body.despensaMontoOverride) ?? 0;
    const despensaPagoMensual =
      lastBody('despensaPagoMensual') === '1' || lastBody('despensaPagoMensual') === true;

    const periodo = await PeriodoNomina.create({
      tenantId,
      empresaId: empresa._id,
      tipoPeriodo,
      tipoNomina,
      fechaInicio: startOfDay(fechaInicio),
      fechaFin: endOfDay(fechaFin),
      anio,
      numeroPeriodo,
      diasPeriodo: diasCalendarioInclusive(fechaInicio, fechaFin),
      estatus: 'abierto',
      payrollPeriodId: payrollPeriodId || null,
      notas: trimString(req.body.notas),
      prestaciones: {
        pagaDespensa: !!pagaDespensa,
        despensaMontoOverride,
        despensaPagoMensual: !!despensaPagoMensual
      }
    });

    await registrarAuditoriaNomina({
      tenantId,
      accion: 'PERIODO_CREAR',
      entidad: 'periodo',
      periodoId: periodo._id,
      ...sessionActor(req),
      mensaje: `Período abierto ${tipoPeriodo}/${tipoNomina} #${numeroPeriodo}/${anio}`,
      detalle: {
        tipoPeriodo,
        tipoNomina,
        anio,
        numeroPeriodo,
        fechaInicio: periodo.fechaInicio,
        fechaFin: periodo.fechaFin,
        payrollPeriodId: payrollPeriodId || null
      },
      ip: req.ip,
      userAgent: req.get('user-agent') || ''
    });

    req.flash('success', `Período de nómina abierto (#${numeroPeriodo} / ${anio})`);
    res.redirect(`/nomina/periodos/${periodo._id}`);
  } catch (err) {
    console.error('[nomina]', err);
    req.flash('error', err.message || 'Error al crear período');
    res.redirect('/nomina/periodos');
  }
}

async function updatePeriodoPrestacionesAction(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const tenantId = req.session.tenantId;
    const PeriodoNomina = await getPeriodoNominaModel();
    const periodo = await PeriodoNomina.findOne({ tenantId, _id: req.params.id });
    if (!periodo) {
      req.flash('error', 'Período no encontrado');
      return res.redirect('/nomina/periodos');
    }
    const est = String(periodo.estatus || '').toLowerCase();
    if (est === 'cerrado' || est === 'calculando') {
      req.flash(
        'error',
        est === 'cerrado'
          ? 'Período cerrado: solo consulta de prestaciones'
          : 'No se pueden editar prestaciones mientras el período está calculando'
      );
      return res.redirect(`/nomina/periodos/${periodo._id}`);
    }
    if (est !== 'abierto' && est !== 'calculado') {
      req.flash('error', `No se pueden editar prestaciones en estatus «${periodo.estatus}»`);
      return res.redirect(`/nomina/periodos/${periodo._id}`);
    }

    const bodyVal = (name) => {
      const v = req.body[name];
      if (Array.isArray(v)) return v[v.length - 1];
      return v;
    };
    const pagaDespensa = bodyVal('pagaDespensa') === '1' || bodyVal('pagaDespensa') === 'on';
    const despensaPagoMensual =
      bodyVal('despensaPagoMensual') === '1' || bodyVal('despensaPagoMensual') === 'on';
    const despensaMontoOverride = parsePositiveNumber(req.body.despensaMontoOverride) ?? 0;

    periodo.set('prestaciones.pagaDespensa', !!pagaDespensa);
    periodo.set('prestaciones.despensaPagoMensual', !!despensaPagoMensual);
    periodo.set('prestaciones.despensaMontoOverride', despensaMontoOverride);
    await periodo.save();

    await registrarAuditoriaNomina({
      tenantId,
      accion: 'PERIODO_PRESTACIONES',
      entidad: 'periodo',
      periodoId: periodo._id,
      ...sessionActor(req),
      mensaje: `Prestaciones: pagaDespensa=${pagaDespensa ? 'sí' : 'no'}`,
      detalle: {
        prestaciones: {
          pagaDespensa: !!pagaDespensa,
          despensaPagoMensual: !!despensaPagoMensual,
          despensaMontoOverride
        }
      },
      ip: req.ip,
      userAgent: req.get('user-agent') || ''
    });

    req.flash('success', 'Prestaciones del período guardadas. Recalcula la nómina para aplicarlas.');
    res.redirect(`/nomina/periodos/${periodo._id}`);
  } catch (err) {
    console.error('[nomina]', err);
    req.flash('error', err.message || 'Error al guardar prestaciones');
    res.redirect(`/nomina/periodos/${req.params.id}`);
  }
}

async function showPeriodo(req, res) {
  if (requireNominaViewOrRedirect(req, res) === false) return;
  const tenantId = req.session.tenantId;
  const PeriodoNomina = await getPeriodoNominaModel();
  const ReciboNomina = await getReciboNominaModel();
  const Historico = await getNominaHistoricoReciboModel();
  const Empleado = await getEmpleadoModel();

  const periodo = await PeriodoNomina.findOne({ tenantId, _id: req.params.id }).lean();
  if (!periodo) {
    req.flash('error', 'Período no encontrado');
    return res.redirect('/nomina/periodos');
  }

  let recibos = [];
  let recibosDesdeHistorico = false;

  if (periodo.estatus === 'cerrado') {
    const hist = await Historico.find({
      tenantId,
      empresaId: periodo.empresaId,
      periodoId: periodo._id,
      origen: 'cierre'
    }).lean();
    recibosDesdeHistorico = true;
    recibos = hist.map((h) => ({
      _id: h._id,
      empleadoId: h.empleadoId,
      diasLaborados: h.diasLaborados,
      faltas: h.faltas,
      totalPercepciones: h.totalPercepciones,
      totalDeducciones: h.totalDeducciones,
      netoPagar: h.netoPagar,
      insumosFuente: h.insumosFuente,
      calculoId: h.calculoId,
      calculoLoteId: h.calculoLoteId,
      fechaCalculo: h.fechaCalculo,
      fechaCierre: h.fechaCierre,
      cerrado: true,
      desdeHistorico: true,
      layoutBancario: h.layoutBancario || null,
      timbrado: h.timbrado || null,
      correo: h.correo || null,
      numEmpleado: h.empleado?.numEmpleado || '',
      empleadoNombre: h.empleado?.nombre || '—'
    }));
  } else {
    recibos = await ReciboNomina.find({ tenantId, periodoId: periodo._id }).lean();
    const empleadoIds = recibos.map((r) => r.empleadoId);
    const empleados = await Empleado.find({ _id: { $in: empleadoIds } }).lean();
    const empleadoMap = new Map(empleados.map((e) => [String(e._id), e]));
    recibos = recibos.map((r) => {
      const emp = empleadoMap.get(String(r.empleadoId));
      return {
        ...r,
        empleadoNombre: emp ? `${emp.firstName} ${emp.lastName}` : '—',
        numEmpleado: emp?.numEmpleado || '',
        desdeHistorico: false
      };
    });
  }

  const preflight =
    periodo.estatus !== 'cerrado' && periodo.estatus !== 'calculando'
      ? await validatePeriodoForCalculo(tenantId, periodo)
      : null;

  const calculoJob = await obtenerEstadoJob(tenantId, periodo._id);

  const PayrollPeriod = await getPayrollPeriodModel();
  let prenominaPeriodo = null;
  if (periodo.payrollPeriodId) {
    prenominaPeriodo = await PayrollPeriod.findOne({ tenantId, _id: periodo.payrollPeriodId }).lean();
  }

  const prenominaCandidatos =
    periodo.estatus !== 'cerrado' && !periodo.payrollPeriodId
      ? (
          await PayrollPeriod.find({
            tenantId,
            compartirConNomina: true,
            estatus: { $in: ['abierto', 'borrador', 'cerrado'] }
          })
            .sort({ fechaInicio: -1 })
            .limit(80)
            .lean()
        ).filter(
          (p) =>
            !p.tipo ||
            String(p.tipo).toLowerCase() === String(periodo.tipoPeriodo || '').toLowerCase()
        )
      : [];

  const auditoria = await listAuditoriaPeriodo(tenantId, periodo._id, 30);

  let calculadoPor = periodo.calculadoPorLabel || '';
  let cerradoPor = periodo.cerradoPorLabel || '';
  if (!calculadoPor && periodo.calculadoPorUserId) {
    calculadoPor = await resolveUserLabel(periodo.calculadoPorUserId);
  }
  if (!cerradoPor && periodo.cerradoPorUserId) {
    cerradoPor = await resolveUserLabel(periodo.cerradoPorUserId);
  }

  res.render('Nomina/periodo-show', {
    periodo,
    recibos,
    recibosDesdeHistorico,
    preflight,
    calculoJob,
    prenominaPeriodo,
    prenominaCandidatos,
    auditoria,
    calculadoPor,
    cerradoPor,
    estatusLabels: ESTATUS_PERIODO_NOMINA,
    canEdit: userCanEditNomina(req.session),
    session: req.session
  });
}

async function vincularPrenominaAction(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const tenantId = req.session.tenantId;
    const PeriodoNomina = await getPeriodoNominaModel();
    const PayrollPeriod = await getPayrollPeriodModel();

    const periodo = await PeriodoNomina.findOne({ tenantId, _id: req.params.id });
    if (!periodo) {
      req.flash('error', 'Período no encontrado');
      return res.redirect('/nomina/periodos');
    }
    if (periodo.estatus === 'cerrado') {
      req.flash('error', 'No se puede vincular pre-nómina a un período cerrado');
      return res.redirect(`/nomina/periodos/${periodo._id}`);
    }
    if (periodo.estatus === 'calculando') {
      req.flash('error', 'Espera a que termine el cálculo antes de vincular');
      return res.redirect(`/nomina/periodos/${periodo._id}`);
    }

    const payrollPeriodId = trimString(req.body.payrollPeriodId);
    if (!payrollPeriodId) {
      req.flash('error', 'Selecciona un período de pre-nómina');
      return res.redirect(`/nomina/periodos/${periodo._id}`);
    }

    const pre = await PayrollPeriod.findOne({ tenantId, _id: payrollPeriodId }).lean();
    if (!pre) {
      req.flash('error', 'El período de pre-nómina no existe');
      return res.redirect(`/nomina/periodos/${periodo._id}`);
    }
    if (!pre.compartirConNomina) {
      req.flash('error', 'Esa pre-nómina no está marcada para compartirse con nómina');
      return res.redirect(`/nomina/periodos/${periodo._id}`);
    }

    // No sobrescribir tipoPeriodo: un quincenal no debe volverse semanal al vincular.
    if (pre.tipo && String(pre.tipo).toLowerCase() !== String(periodo.tipoPeriodo).toLowerCase()) {
      req.flash(
        'error',
        `No se puede vincular: la pre-nómina es «${pre.tipo}» y este período de nómina es «${periodo.tipoPeriodo}». Elige una pre-nómina del mismo tipo.`
      );
      return res.redirect(`/nomina/periodos/${periodo._id}`);
    }

    const yaUsada = await PeriodoNomina.findOne({
      tenantId,
      payrollPeriodId: pre._id,
      _id: { $ne: periodo._id }
    }).lean();
    if (yaUsada) {
      req.flash(
        'error',
        `Esa pre-nómina ya está vinculada al período ${yaUsada.tipoPeriodo} #${yaUsada.numeroPeriodo || '—'} (${new Date(yaUsada.fechaInicio).toLocaleDateString('es-MX')}).`
      );
      return res.redirect(`/nomina/periodos/${periodo._id}`);
    }

    const fechaInicio = startOfDay(pre.fechaInicio);
    const fechaFin = endOfDay(pre.fechaFin);

    const choque = await PeriodoNomina.findOne({
      tenantId,
      tipoPeriodo: periodo.tipoPeriodo,
      tipoNomina: periodo.tipoNomina,
      fechaInicio,
      fechaFin,
      _id: { $ne: periodo._id }
    }).lean();
    if (choque) {
      req.flash(
        'error',
        `Al alinear fechas coincidiría con otro período ${choque.tipoPeriodo} ya existente (#${choque.numeroPeriodo || '—'}).`
      );
      return res.redirect(`/nomina/periodos/${periodo._id}`);
    }

    periodo.payrollPeriodId = pre._id;
    periodo.fechaInicio = fechaInicio;
    periodo.fechaFin = fechaFin;
    periodo.diasPeriodo = diasCalendarioInclusive(fechaInicio, fechaFin);
    if (!periodo.anio || !periodo.numeroPeriodo) {
      const assigned = await asignarNumeroPeriodo(PeriodoNomina, {
        tenantId,
        tipoPeriodo: periodo.tipoPeriodo,
        fechaInicio
      });
      periodo.anio = assigned.anio;
      periodo.numeroPeriodo = assigned.numeroPeriodo;
    } else {
      periodo.anio = fechaInicio.getFullYear();
    }
    await periodo.save();

    await registrarAuditoriaNomina({
      tenantId,
      accion: 'PERIODO_VINCULAR_PRENOMINA',
      entidad: 'periodo',
      periodoId: periodo._id,
      ...sessionActor(req),
      mensaje: `Pre-nómina vinculada ${payrollPeriodId}`,
      detalle: {
        payrollPeriodId,
        fechaInicio,
        fechaFin,
        tipoPeriodo: periodo.tipoPeriodo,
        numeroPeriodo: periodo.numeroPeriodo,
        anio: periodo.anio
      },
      ip: req.ip,
      userAgent: req.get('user-agent') || ''
    });

    req.flash(
      'success',
      `Pre-nómina vinculada (tipo «${periodo.tipoPeriodo}» conservado). Fechas: ${fechaInicio.toLocaleDateString('es-MX')} – ${startOfDay(fechaFin).toLocaleDateString('es-MX')}. Recalcula para aplicar asistencia.`
    );
    res.redirect(`/nomina/periodos/${periodo._id}`);
  } catch (err) {
    console.error('[nomina vincular]', err);
    req.flash('error', err.message || 'Error al vincular pre-nómina');
    res.redirect(`/nomina/periodos/${req.params.id}`);
  }
}

async function calcularPeriodoAction(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const PeriodoNomina = await getPeriodoNominaModel();
    const periodo = await PeriodoNomina.findOne({
      tenantId: req.session.tenantId,
      _id: req.params.id
    }).lean();
    if (!periodo) {
      req.flash('error', 'Período no encontrado');
      return res.redirect('/nomina/periodos');
    }

    const tipoEsp = String(periodo.tipoNomina || '').toLowerCase();
    if (tipoEsp === 'finiquito' || tipoEsp === 'indemnizacion') {
      req.flash(
        'error',
        'Este período es de finiquito/indemnización: los montos se inyectan desde /nomina/finiquitos. No uses el cálculo ordinario (sobrescribiría los conceptos FIN_*).'
      );
      return res.redirect(`/nomina/periodos/${req.params.id}`);
    }

    const preflight = await validatePeriodoForCalculo(req.session.tenantId, periodo);
    if (!preflight.ok) {
      req.flash('error', preflight.bloqueos.map((b) => b.mensaje).join(' · '));
      return res.redirect(`/nomina/periodos/${req.params.id}`);
    }

    const actor = sessionActor(req);
    const { job, yaEncolado } = await encolarCalculo(
      req.session.tenantId,
      req.params.id,
      actor.userId,
      actor.userLabel
    );

    await registrarAuditoriaNomina({
      tenantId: req.session.tenantId,
      accion: 'PERIODO_CALCULAR',
      entidad: 'periodo',
      periodoId: req.params.id,
      ...actor,
      mensaje: yaEncolado ? 'Reintento: cálculo ya en curso' : 'Cálculo encolado',
      detalle: { jobId: job?._id, yaEncolado },
      ip: req.ip,
      userAgent: req.get('user-agent') || ''
    });

    req.flash(
      'success',
      yaEncolado
        ? 'Ya hay un cálculo en curso para este período'
        : 'Cálculo de nómina iniciado en segundo plano'
    );
  } catch (err) {
    console.error('[nomina calcular]', err);
    await registrarAuditoriaNomina({
      tenantId: req.session.tenantId,
      accion: 'PERIODO_CALCULAR_ERROR',
      entidad: 'periodo',
      periodoId: req.params.id,
      ...sessionActor(req),
      mensaje: err.message || 'Error al encolar cálculo',
      detalle: { error: err.message }
    });
    req.flash('error', err.message || 'Error al encolar cálculo');
  }
  res.redirect(`/nomina/periodos/${req.params.id}`);
}

async function estadoCalculoApi(req, res) {
  if (requireNominaViewOrRedirect(req, res) === false) return;
  const job = await obtenerEstadoJob(req.session.tenantId, req.params.id);
  if (!job) {
    return res.json({ ok: true, job: null });
  }
  const pct =
    job.progreso?.total > 0
      ? Math.round((job.progreso.procesados / job.progreso.total) * 100)
      : job.estatus === 'completed'
        ? 100
        : 0;
  res.json({
    ok: true,
    job: {
      id: job._id,
      estatus: job.estatus,
      progreso: job.progreso,
      porcentaje: pct,
      totales: job.totales,
      error: job.error,
      erroresDetalle: job.erroresDetalle || []
    }
  });
}

async function cerrarPeriodoAction(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  const actor = sessionActor(req);
  try {
    const cierre = await cerrarPeriodo(
      req.session.tenantId,
      req.params.id,
      actor.userId,
      actor.userLabel
    );
    req.flash(
      'success',
      `Período cerrado. Movidos ${cierre?.archivados || 0} recibos a histórico; eliminados ${cierre?.operativosEliminados || 0} del temporal.`
    );
  } catch (err) {
    await registrarAuditoriaNomina({
      tenantId: req.session.tenantId,
      accion: 'PERIODO_CERRAR_ERROR',
      entidad: 'periodo',
      periodoId: req.params.id,
      ...actor,
      mensaje: err.message || 'No se pudo cerrar',
      detalle: { error: err.message }
    });
    req.flash('error', err.message || 'No se pudo cerrar');
  }
  res.redirect(`/nomina/periodos/${req.params.id}`);
}

async function showRecibo(req, res) {
  if (requireNominaViewOrRedirect(req, res) === false) return;
  const tenantId = req.session.tenantId;
  const ReciboNomina = await getReciboNominaModel();
  const ConceptoAplicado = await getConceptoAplicadoModel();
  const Historico = await getNominaHistoricoReciboModel();
  const PeriodoNomina = await getPeriodoNominaModel();
  const Empleado = await getEmpleadoModel();
  const { requireEmpresaForTenant: reqEmp } = require('../libs/tenantScope');

  let recibo = await ReciboNomina.findOne({ tenantId, _id: req.params.reciboId }).lean();
  let conceptos = null;
  let desdeHistorico = false;

  if (!recibo) {
    const hist = await Historico.findOne({
      tenantId,
      _id: req.params.reciboId
    }).lean();
    if (!hist) {
      // Compat: enlace viejo con id del recibo operativo ya borrado
      const histPorOrigen = await Historico.findOne({
        tenantId,
        reciboOrigenId: req.params.reciboId
      }).lean();
      if (!histPorOrigen) {
        req.flash('error', 'Recibo no encontrado');
        return res.redirect(`/nomina/periodos/${req.params.id}`);
      }
      recibo = mapHistoricoToReciboView(histPorOrigen);
      conceptos = histPorOrigen.conceptos || [];
      desdeHistorico = true;
    } else {
      recibo = mapHistoricoToReciboView(hist);
      conceptos = hist.conceptos || [];
      desdeHistorico = true;
    }
  }

  const ConceptoNomina = await getConceptoNominaModel();

  const [periodo, empleado, catalogo, empScope] = await Promise.all([
    PeriodoNomina.findOne({ _id: recibo.periodoId }).lean(),
    Empleado.findOne({ _id: recibo.empleadoId }).lean(),
    ConceptoNomina.find({ tenantId })
      .select('codigo nombre naturaleza tipo claveSAT sat metadata ordenImpresion ordenCalculo')
      .lean(),
    reqEmp(tenantId).catch(() => ({ empresa: null }))
  ]);

  if (!desdeHistorico) {
    conceptos = await ConceptoAplicado.find({ tenantId, reciboId: recibo._id })
      .sort({ conceptoCodigo: 1 })
      .lean();
  }

  const conceptosMeta = {};
  for (const c of catalogo) {
    conceptosMeta[c.codigo] = {
      nombre: c.nombre || c.codigo,
      naturaleza: c.naturaleza,
      tipo: c.tipo,
      claveSAT: (c.sat && c.sat.clave) || c.claveSAT || '',
      ordenImpresion: c.ordenImpresion != null ? Number(c.ordenImpresion) : 100,
      ordenCalculo: c.ordenCalculo != null ? Number(c.ordenCalculo) : 100,
      informativo: !!(c.metadata && c.metadata.informativo) || c.naturaleza === 'informativo'
    };
  }

  const byPrintOrder = (a, b) =>
    (a.ordenImpresion - b.ordenImpresion) ||
    (a.ordenCalculo - b.ordenCalculo) ||
    String(a.conceptoCodigo).localeCompare(String(b.conceptoCodigo));

  const lineas = (conceptos || []).map((c) => {
    const meta = conceptosMeta[c.conceptoCodigo] || {};
    const tipo = c.tipo || meta.tipo || 'percepcion';
    const esInfo = meta.naturaleza === 'informativo' || meta.informativo;
    return {
      ...c,
      nombre: meta.nombre || c.conceptoCodigo,
      claveSAT: c.claveSAT || meta.claveSAT || '',
      tipo,
      esInfo,
      ordenImpresion: meta.ordenImpresion != null ? meta.ordenImpresion : 100,
      ordenCalculo: meta.ordenCalculo != null ? meta.ordenCalculo : 100
    };
  });

  const percepciones = lineas
    .filter((c) => !c.esInfo && c.tipo === 'percepcion' && Number(c.importe) !== 0)
    .sort(byPrintOrder);
  const deducciones = lineas
    .filter((c) => !c.esInfo && c.tipo === 'deduccion' && Number(c.importe) !== 0)
    .sort(byPrintOrder);
  const otrosPagos = lineas
    .filter((c) => !c.esInfo && c.tipo === 'otro_pago' && Number(c.importe) !== 0)
    .sort(byPrintOrder);

  res.render('Nomina/recibo', {
    recibo,
    periodo,
    empleado,
    empresa: empScope?.empresa || null,
    conceptos,
    conceptosMeta,
    percepciones,
    deducciones,
    otrosPagos,
    desdeHistorico,
    session: req.session
  });
}

function mapHistoricoToReciboView(hist) {
  return {
    _id: hist._id,
    tenantId: hist.tenantId,
    empresaId: hist.empresaId,
    subsidiariaId: hist.subsidiariaId,
    empleadoId: hist.empleadoId,
    periodoId: hist.periodoId,
    diasLaborados: hist.diasLaborados,
    faltas: hist.faltas,
    diasPago: hist.diasPagados != null ? { diasPagados: hist.diasPagados } : null,
    totalPercepciones: hist.totalPercepciones,
    totalDeducciones: hist.totalDeducciones,
    netoPagar: hist.netoPagar,
    basesFiscales: hist.basesFiscales || {},
    insumosFuente: hist.insumosFuente,
    insumosResumen: hist.insumosResumen || {},
    fechaCalculo: hist.fechaCalculo,
    calculoId: hist.calculoId,
    calculoLoteId: hist.calculoLoteId,
    fechaCierre: hist.fechaCierre,
    cerrado: true,
    isrMotor: hist.isrMotor,
    errorCalculo: '',
    layoutBancario: hist.layoutBancario || null,
    desdeHistorico: true
  };
}

// ── Conceptos ────────────────────────────────────────────

async function conceptos(req, res) {
  if (requireNominaViewOrRedirect(req, res) === false) return;
  const tenantId = req.session.tenantId;
  const { empresa, error } = await requireEmpresaForTenant(tenantId);
  const canEdit = userCanEditNomina(req.session);

  if (empresa) {
    await ensureNominaConceptsForTenant(tenantId, empresa._id);
    try {
      const { ensureCompanyConceptConfigs } = require('../services/nomina/conceptResolutionService');
      await ensureCompanyConceptConfigs(tenantId, empresa._id);
    } catch (_) {
      /* opcional */
    }
  }

  let conceptosList = empresa ? await listConceptos(tenantId) : [];
  // Misma colección: mostrar todos; el badge aplicaEn los separa visualmente
  conceptosList = conceptosList.map((c) => ({
    ...c,
    aplicaEn: c.aplicaEn || c.metadata?.aplicaEn || 'nomina',
    tiposIncidencia: c.tiposIncidencia || c.metadata?.tiposIncidencia || []
  }));

  res.render('Nomina/conceptos', {
    conceptos: conceptosList,
    tiposConcepto: TIPOS_CONCEPTO,
    naturalezas: NATURALEZAS_CONCEPTO,
    empresa,
    canEdit,
    error: error || null,
    session: req.session
  });
}

async function loadConceptoAmbitoEnums() {
  const { getEnumItems, ensureSystemEnums } = require('../services/nomina/systemEnumService');
  try {
    await ensureSystemEnums();
  } catch (_) {
    /* seed opcional */
  }
  const [tiposEmpleadoOpts, tiposPeriodoOpts, tiposNominaOpts] = await Promise.all([
    getEnumItems('tipo_empleado').catch(() => []),
    getEnumItems('tipo_periodo').catch(() => []),
    getEnumItems('tipo_nomina').catch(() => [])
  ]);
  return { tiposEmpleadoOpts, tiposPeriodoOpts, tiposNominaOpts };
}

async function newConcepto(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const ambitoEnums = await loadConceptoAmbitoEnums();
  const { getEnumItems } = require('../services/nomina/systemEnumService');
  let categoriasConcepto = [];
  try {
    categoriasConcepto = await getEnumItems('categoria_concepto');
  } catch (_) {
    categoriasConcepto = [
      { value: 'ordinario', label: 'Ordinario' },
      { value: 'prevision_social', label: 'Previsión social' },
      { value: 'fiscal', label: 'Fiscal' },
      { value: 'informativo', label: 'Informativo' },
      { value: 'otro', label: 'Otro' }
    ];
  }
  res.render('Nomina/concepto-nuevo', {
    tiposConcepto: TIPOS_CONCEPTO,
    naturalezas: NATURALEZAS_CONCEPTO,
    categoriasConcepto,
    ...ambitoEnums,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createConcepto(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const tenantId = req.session.tenantId;
    const { empresa, error } = await requireEmpresaForTenant(tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/nomina/conceptos');
    }

    await crearConcepto(tenantId, empresa._id, {
      codigo: req.body.codigo,
      nombre: req.body.nombre,
      tipo: req.body.tipo,
      naturaleza: req.body.naturaleza,
      categoria: req.body.categoria,
      ordenCalculo: req.body.ordenCalculo,
      codigoExterno: req.body.codigoExterno,
      cuentaContable: req.body.cuentaContable,
      fase: req.body.fase,
      aplicaEn: req.body.aplicaEn,
      satClave: req.body.satClave || req.body.claveSAT,
      satDescripcion: req.body.satDescripcion,
      claveSAT: req.body.satClave || req.body.claveSAT,
      tiposIncidencia: req.body.tiposIncidencia,
      formulaPrenomina: req.body.formulaPrenomina,
      clavePrenomina: req.body.clavePrenomina,
      integraISR: req.body.integraISR,
      integraIMSS: req.body.integraIMSS,
      integraINFONAVIT: req.body.integraINFONAVIT,
      desgloseModo: req.body.desgloseModo,
      naturalezaSdi: req.body.naturalezaSdi,
      imssDesgloseModo: req.body.imssDesgloseModo,
      aplicaTiposEmpleado: parseBodyStringList(req.body.aplicaTiposEmpleado),
      aplicaTiposPeriodo: parseBodyStringList(req.body.aplicaTiposPeriodo),
      aplicaTipoNomina: parseBodyStringList(req.body.aplicaTipoNomina)
    });
    req.flash('success', 'Concepto creado');
  } catch (err) {
    req.flash('error', err.message || 'Error al crear concepto');
  }
  res.redirect('/nomina/conceptos');
}

async function showConcepto(req, res) {
  if (requireNominaViewOrRedirect(req, res) === false) return;
  const tenantId = req.session.tenantId;
  const codigo = String(req.params.codigo).toUpperCase();
  const access = resolveNominaConceptoModo(req.session, req.query);
  const { canEdit, modoVista, modo } = access;

  // Pedir edición sin permiso → forzar vista
  const rawModo = String(req.query.modo || '').toLowerCase();
  if ((rawModo === 'edicion' || rawModo === 'edit' || rawModo === 'editar') && !canEdit) {
    req.flash('error', 'No tienes permiso de edición; se muestra en modo consulta.');
    return res.redirect(`/nomina/conceptos/${codigo}?modo=vista`);
  }

  const data = await getConceptoConFormulas(tenantId, codigo);

  if (!data) {
    req.flash('error', 'Concepto no encontrado');
    return res.redirect('/nomina/conceptos');
  }

  const formulasPorClave = {};
  const byKey = new Map();
  for (const f of data.formulas) {
    const key = `${f.tipoPeriodo}|${f.tipoNomina}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(f);
  }
  const pickPreferida =
    typeof data.pickFormulaPreferida === 'function'
      ? data.pickFormulaPreferida
      : (arr) => arr[0];
  for (const [key, candidatas] of byKey) {
    const f = pickPreferida(candidatas);
    if (!f) continue;
    formulasPorClave[key] = {
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      condicion: f.condicion || '',
      formula: f.formula || '',
      dependencias: f.dependencias || [],
      redondeo: f.redondeo ?? 2,
      fase: f.fase || 1,
      tipoAplicacion: f.tipoAplicacion || 'FIJO',
      version: f.version || 1,
      vigenciaDesde: f.vigenciaDesde,
      empresaId: f.empresaId ? String(f.empresaId) : null
    };
  }

  const periodoVals = new Set(TIPOS_PERIODO.map((t) => t.value));
  const nominaVals = new Set(TIPOS_NOMINA.map((t) => t.value));
  const periodoActivo = periodoVals.has(String(req.query.periodo || ''))
    ? String(req.query.periodo)
    : (formulasPorClave['quincenal|ordinaria'] ? 'quincenal' : TIPOS_PERIODO[0].value);
  const nominaActiva = nominaVals.has(String(req.query.nomina || ''))
    ? String(req.query.nomina)
    : 'ordinaria';

  const todosConceptos = await listConceptos(tenantId);
  const conceptosOtros = todosConceptos.filter((c) => c.codigo !== codigo);

  let companyConfig = null;
  let catalogEntry = null;
  try {
    const { getCatalogWithCompanyConfig, ensureDefaultFormulas } = require('../services/nomina/conceptResolutionService');
    const { requireEmpresaForTenant: reqEmp } = require('../libs/tenantScope');
    const { empresa } = await reqEmp(tenantId);
    if (empresa) {
      await ensureDefaultFormulas(tenantId, null);
      const withCfg = await getCatalogWithCompanyConfig(tenantId, empresa._id);
      catalogEntry = withCfg.find((c) => c.codigo === codigo) || null;
      companyConfig = catalogEntry?.config || null;
    }
  } catch (_) {
    /* capa arquitectura opcional si aún no hay seed */
  }

  const { getEnumItems, getFormulaContextVariables } = require('../services/nomina/systemEnumService');
  let fases = [];
  let tiposAplicacion = [];
  let categoriasConcepto = [];
  try {
    fases = await getEnumItems('fase_calculo');
    tiposAplicacion = await getEnumItems('tipo_aplicacion');
    categoriasConcepto = await getEnumItems('categoria_concepto');
  } catch (_) {
    fases = [
      { value: '1', label: 'Fase 1 — Percepciones' },
      { value: '2', label: 'Fase 2 — Acumuladores' },
      { value: '3', label: 'Fase 3 — Deducciones' },
      { value: '4', label: 'Fase 4 — Neto' }
    ];
    tiposAplicacion = [
      { value: 'FIJO', label: 'Fijo' },
      { value: 'EVENTUAL', label: 'Eventual' }
    ];
    categoriasConcepto = [
      { value: 'ordinario', label: 'Ordinario' },
      { value: 'prevision_social', label: 'Previsión social' },
      { value: 'fiscal', label: 'Fiscal' },
      { value: 'informativo', label: 'Informativo' },
      { value: 'otro', label: 'Otro' }
    ];
  }
  const {
    tiposEmpleadoOpts,
    tiposPeriodoOpts,
    tiposNominaOpts
  } = await loadConceptoAmbitoEnums();

  let variablesBase = [...VARIABLES_CONTEXTO];
  try {
    const fromDb = await getFormulaContextVariables(VARIABLES_CONTEXTO);
    const seen = new Set(variablesBase.map((v) => v.key));
    for (const v of fromDb) {
      if (seen.has(v.key)) continue;
      seen.add(v.key);
      variablesBase.push(v);
    }
  } catch (_) {
    /* enums opcionales */
  }

  const variablesAgrupadas = groupVariablesByCategoria(variablesBase);
  const catMeta = new Map(CATEGORIAS_VARIABLES.map((c) => [c.id, c]));
  const tipoToCat = {
    percepcion: 'conceptos_percepcion',
    deduccion: 'conceptos_deduccion',
    otro_pago: 'conceptos_otro'
  };
  for (const c of conceptosOtros) {
    const catId = tipoToCat[c.tipo] || 'conceptos_otro';
    let grupo = variablesAgrupadas.find((g) => g.id === catId);
    if (!grupo) {
      const meta = catMeta.get(catId) || { id: catId, label: catId, descripcion: '' };
      grupo = { ...meta, variables: [] };
      variablesAgrupadas.push(grupo);
    }
    grupo.variables.push({
      key: c.codigo,
      label: c.nombre,
      tipo: 'concepto',
      categoria: catId,
      descripcion: `${c.tipo} · ${c.naturaleza || '—'} · orden ${c.ordenCalculo ?? '—'}`,
      ejemplo: null,
      esConcepto: true
    });
  }

  const tipoConcepto = data.concepto.tipo || 'percepcion';
  const satCatalogoMap = {
    percepcion: 'c_TipoPercepcion',
    deduccion: 'c_TipoDeduccion',
    otro_pago: 'c_TipoOtroPago'
  };
  let opcionesSat = [];
  try {
    const { listCatalogoSat } = require('../services/nomina/catalogosNominaService');
    const catalogoSat = satCatalogoMap[tipoConcepto] || 'c_TipoPercepcion';
    opcionesSat = await listCatalogoSat(catalogoSat);
    opcionesSat = (opcionesSat || []).filter((e) => e.activo !== false);
  } catch (_) {
    opcionesSat = [];
  }

  const { DEFAULT_TIPOS_INCIDENCIA } = require('../config/incidenciasCatalog');
  const tiposIncidenciaOpts = DEFAULT_TIPOS_INCIDENCIA;
  const { listFormulaFunctionsForAutocomplete } = require('../services/nomina/formulaFunctionsService');
  const formulaSystemFunctions = await listFormulaFunctionsForAutocomplete();

  const desgloseModos = [
    { value: 'todo_gravado', label: 'Todo gravado' },
    { value: 'todo_exento', label: 'Todo exento' },
    { value: 'tope_uma', label: 'Tope en UMAs' },
    { value: 'tope_monto', label: 'Tope en monto' },
    { value: 'formula', label: 'Fórmula gravado/exento' },
    { value: 'regla_ley', label: 'Regla de ley (p.ej. HE)' }
  ];
  const { IMSS_DESGLOSE_MODOS, NATURALEZA_SDI_OPTS } = require('../models/fiscalConceptoShared');
  const imssDesgloseModos = IMSS_DESGLOSE_MODOS;
  const naturalezaSdiOpts = NATURALEZA_SDI_OPTS;
  const formulasPrenomina = [
    { value: '', label: '— (sin fórmula pre-nómina)' },
    { value: 'salario_periodo', label: 'Salario del período' },
    { value: 'horas_extra', label: 'Horas extra' },
    { value: 'retardos', label: 'Retardos' },
    { value: 'faltas', label: 'Faltas' },
    { value: 'salida_anticipada', label: 'Salida anticipada' },
    { value: 'manual', label: 'Manual' }
  ];
  const ambitosAplicaEn = [
    { value: 'nomina', label: 'Solo nómina' },
    { value: 'prenomina', label: 'Solo pre-nómina' },
    { value: 'ambos', label: 'Ambos' }
  ];

  res.render('Nomina/concepto-edit', {
    concepto: data.concepto,
    formulasPorClave,
    periodoActivo,
    nominaActiva,
    tiposPeriodo: TIPOS_PERIODO,
    tiposNomina: TIPOS_NOMINA,
    tiposConcepto: TIPOS_CONCEPTO,
    naturalezas: NATURALEZAS_CONCEPTO,
    variablesAgrupadas,
    variablesContexto: VARIABLES_CONTEXTO,
    companyConfig,
    catalogEntry,
    fases,
    tiposAplicacion,
    categoriasConcepto,
    opcionesSat,
    tiposIncidenciaOpts,
    desgloseModos,
    imssDesgloseModos,
    naturalezaSdiOpts,
    formulasPrenomina,
    ambitosAplicaEn,
    tiposEmpleadoOpts,
    tiposPeriodoOpts,
    tiposNominaOpts,
    formulaSystemFunctions,
    canEdit,
    modoVista,
    modo,
    session: req.session
  });
}

async function saveConceptoPropsAction(req, res) {
  if (requireNominaEditOrRedirect(req, res, req.params.codigo) === false) return;
  const codigo = String(req.params.codigo).toUpperCase();
  const periodo = trimString(req.body.returnPeriodo) || trimString(req.query.periodo) || '';
  const nomina = trimString(req.body.returnNomina) || trimString(req.query.nomina) || '';
  try {
    const tenantId = req.session.tenantId;
    const { empresa } = await requireEmpresaForTenant(tenantId);
    const tiposIncidencia = parseBodyStringList(req.body.tiposIncidencia);
    const aplicaTiposEmpleado = parseBodyStringList(req.body.aplicaTiposEmpleado);
    const aplicaTiposPeriodo = parseBodyStringList(req.body.aplicaTiposPeriodo);
    const aplicaTipoNomina = parseBodyStringList(req.body.aplicaTipoNomina);

    await actualizarConcepto(
      tenantId,
      codigo,
      {
        nombre: req.body.nombre,
        tipo: req.body.tipo,
        naturaleza: req.body.naturaleza,
        categoria: req.body.categoria,
        ordenCalculo: req.body.ordenCalculo,
        ordenImpresion: req.body.ordenImpresion,
        fase: req.body.fase,
        aplicaEn: req.body.aplicaEn,
        codigoExterno: req.body.codigoExterno,
        cuentaContable: req.body.cuentaContable,
        clavePrenomina: req.body.clavePrenomina,
        aplicaTiposEmpleado,
        aplicaTiposPeriodo,
        aplicaTipoNomina,
        formulaPrenomina: req.body.formulaPrenomina,
        tiposIncidencia,
        insumosContexto: req.body.insumosContexto,
        satClave: req.body.satClave || req.body.claveSAT,
        satDescripcion: req.body.satDescripcion,
        claveSAT: req.body.satClave || req.body.claveSAT,
        integraISR: req.body.integraISR === 'on' || req.body.integraISR === '1' || req.body.integraISR === true,
        integraIMSS: req.body.integraIMSS === 'on' || req.body.integraIMSS === '1' || req.body.integraIMSS === true,
        integraINFONAVIT:
          req.body.integraINFONAVIT === 'on' ||
          req.body.integraINFONAVIT === '1' ||
          req.body.integraINFONAVIT === true,
        desgloseModo: req.body.desgloseModo,
        topeExentoUMA: req.body.topeExentoUMA,
        topeExentoMonto: req.body.topeExentoMonto,
        formulaExento: req.body.formulaExento,
        formulaGravado: req.body.formulaGravado,
        codigoRegla: req.body.codigoRegla,
        naturalezaSdi: req.body.naturalezaSdi,
        imssDesgloseModo: req.body.imssDesgloseModo,
        imssTopeNoIntegraUMA: req.body.imssTopeNoIntegraUMA,
        imssTopeNoIntegraMonto: req.body.imssTopeNoIntegraMonto,
        imssTopeNoIntegraPctSbc: req.body.imssTopeNoIntegraPctSbc,
        imssFormulaIntegra: req.body.imssFormulaIntegra,
        imssFormulaNoIntegra: req.body.imssFormulaNoIntegra,
        imssCodigoRegla: req.body.imssCodigoRegla,
        fiscalNaturaleza: req.body.naturaleza,
        tipoAplicacion: req.body.tipoAplicacion
      },
      { empresaId: empresa?._id || null, syncCatalog: true }
    );
    req.flash('success', 'Propiedades del concepto guardadas');
  } catch (err) {
    req.flash('error', err.message || 'Error al guardar propiedades');
  }
  const qs = [];
  if (periodo) qs.push(`periodo=${encodeURIComponent(periodo)}`);
  if (nomina) qs.push(`nomina=${encodeURIComponent(nomina)}`);
  qs.push('modo=edicion');
  res.redirect(`/nomina/conceptos/${codigo}?${qs.join('&')}#props`);
}

async function saveFormulaAction(req, res) {
  if (requireNominaEditOrRedirect(req, res, req.params.codigo) === false) return;
  const codigo = String(req.params.codigo).toUpperCase();
  const tipoPeriodo = trimString(req.body.tipoPeriodo) || 'quincenal';
  const tipoNomina = trimString(req.body.tipoNomina) || 'ordinaria';
  try {
    const deps = String(req.body.dependencias || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    let empresaIdOverride = null;
    if (req.body.comoOverride === 'on') {
      const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
      empresaIdOverride = empresa?._id || null;
    }

    const payloadBase = {
      conceptoCodigo: codigo,
      tipoNomina,
      condicion: trimString(req.body.condicion),
      formula: trimString(req.body.formula),
      dependencias: deps,
      redondeo: Number(req.body.redondeo) || 2,
      fase: Number(req.body.fase) || 1,
      tipoAplicacion: trimString(req.body.tipoAplicacion) || 'FIJO',
      empresaId: empresaIdOverride
    };

    const periodos =
      req.body.aplicarTodosPeriodos === 'on'
        ? TIPOS_PERIODO.map((t) => t.value)
        : [tipoPeriodo];

    for (const tp of periodos) {
      await guardarFormula(req.session.tenantId, { ...payloadBase, tipoPeriodo: tp });
    }

    const msg =
      periodos.length > 1
        ? `Fórmula guardada en ${periodos.length} tipos de período`
        : 'Fórmula guardada (nueva vigencia)';
    req.flash('success', msg);
  } catch (err) {
    req.flash('error', err.message || 'Error al guardar fórmula');
  }
  res.redirect(`/nomina/conceptos/${codigo}?periodo=${encodeURIComponent(tipoPeriodo)}&nomina=${encodeURIComponent(tipoNomina)}&modo=edicion`);
}

async function toggleConceptoAction(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    await toggleConcepto(req.session.tenantId, req.params.codigo);
    req.flash('success', 'Estado actualizado');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo cambiar el estado');
  }
  res.redirect('/nomina/conceptos');
}

async function validarFormulaApi(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const deps = (req.body.dependencias || []).map((d) => String(d).toUpperCase());
    await validarDependenciasGrupo(
      req.session.tenantId,
      req.body.tipoPeriodo,
      req.body.tipoNomina || 'ordinaria',
      req.body.conceptoCodigo,
      deps
    );
    if (req.body.formula) validateFormulaSyntax(req.body.formula);
    res.json({ valido: true });
  } catch (err) {
    res.status(400).json({ valido: false, error: err.message });
  }
}

async function probarFormulaApi(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const { formula, condicion, variables, tipoAplicacion } = req.body;
    validateFormulaSyntax(formula);

    const condicionNorm = normalizeConditionComparisons(condicion || '');
    if (condicionNorm) validateFormulaSyntax(condicionNorm);

    const parametros = await obtenerParametrosVigentes(new Date());
    const scope = await createFormulaScopeWithCatalog(parametros, {
      aplicarTabla: () => 0,
      topeUMA: (v, veces) => Math.min(Number(v) || 0, parametros.uma * (veces || 1)),
      isrPeriodo: (g) => g * 0.1,
      imssObrero: (sdi, dias) => sdi * dias * 0.02775
    });
    // variables de prueba primero; parámetros no deben pisar INCIDENCIAS / EMPLEADO
    const contexto = { ...(variables || {}), ...parametros, ...(variables || {}) };
    const aplica = evaluateCondicion(condicionNorm, contexto, scope);
    const app = String(tipoAplicacion || 'FIJO').toUpperCase() === 'EVENTUAL' ? 'EVENTUAL' : 'FIJO';
    const faltasPrueba = contexto.INCIDENCIAS?.faltas ?? contexto.faltas;
    const retardosPrueba = contexto.INCIDENCIAS?.minutosRetardo ?? contexto.minutosRetardo;
    const llegadasPrueba = contexto.INCIDENCIAS?.llegadasTarde ?? contexto.llegadasTarde;

    if (!aplica) {
      return res.json({
        ok: true,
        aplica: false,
        resultado: 0,
        tipoAplicacion: app,
        condicionOriginal: condicion || '',
        condicionUsada: condicionNorm,
        faltasPrueba,
        retardosPrueba,
        llegadasPrueba,
        mensaje:
          `Condición falsa con datos de prueba ` +
          `(faltas=${faltasPrueba}, minutosRetardo=${retardosPrueba}, llegadasTarde=${llegadasPrueba}). ` +
          `Se evaluó: ${condicionNorm || '(vacía)'}` +
          (condicion && condicion !== condicionNorm ? ` (normalizada desde "${condicion}")` : '')
      });
    }
    const crudo = evaluateExpression(formula, contexto, scope);
    res.json({
      ok: true,
      aplica: true,
      resultado: redondear(crudo, 2),
      tipoAplicacion: app,
      condicionUsada: condicionNorm,
      faltasPrueba,
      retardosPrueba,
      llegadasPrueba
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
}

// ── Configuración fiscal ─────────────────────────────────

async function configuracion(req, res) {
  if (requireNominaViewOrRedirect(req, res) === false) return;
  const TablaFiscal = await getTablaFiscalModel();
  const RangoFiscal = await getRangoFiscalModel();
  const ParametroGeneral = await getParametroGeneralModel();
  const CatalogoSat = await getCatalogoSatModel();
  const getEmpresaModel = require('../models/empresa');
  const Empresa = await getEmpresaModel();

  const [tablas, parametros, satCount, empresa] = await Promise.all([
    TablaFiscal.find({ activo: true }).sort({ codigo: 1, vigenciaDesde: -1 }).lean(),
    ParametroGeneral.find().sort({ clave: 1, vigenciaDesde: -1 }).lean(),
    CatalogoSat.countDocuments({ activo: true }),
    Empresa.findOne({ tenantId: req.session.tenantId }).lean()
  ]);

  const tablasConRangos = [];
  for (const t of tablas) {
    const rangos = await RangoFiscal.find({ tablaId: t._id }).sort({ limiteInferior: 1 }).lean();
    tablasConRangos.push({ ...t, rangos });
  }

  res.render('Nomina/configuracion', {
    tablas: tablasConRangos,
    parametros,
    satCount,
    empresa,
    isrModo: empresa?.nominaIsr?.modo || 'inteligente_alerta',
    isrActivo: empresa?.nominaIsr?.activo !== false,
    politicaDias: require('../libs/diasPagadosMotor').mergePolitica(empresa?.nominaDias || {}),
    politicaDescuentos: require('../libs/politicaDescuentosDefaults').mergePoliticaDescuentos(
      empresa?.nominaDescuentos || {}
    ),
    conceptosDeduccion: await loadConceptosDeduccion(req.session.tenantId),
    canEdit: userCanEditNomina(req.session),
    session: req.session
  });
}

async function loadConceptosDeduccion(tenantId) {
  try {
    const getConceptoNominaModel = require('../models/conceptoNomina');
    const Concepto = await getConceptoNominaModel();
    return Concepto.find({
      tenantId,
      activo: true,
      tipo: { $in: ['deduccion', 'deducción'] }
    })
      .select('codigo nombre ordenCalculo')
      .sort({ ordenCalculo: 1, codigo: 1 })
      .lean();
  } catch {
    return [];
  }
}

async function saveIsrMotorConfig(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const getEmpresaModel = require('../models/empresa');
    const Empresa = await getEmpresaModel();
    const modo = String(req.body.modo || 'inteligente_alerta');
    const allowed = new Set(['sat', 'inteligente_alerta', 'inteligente_retencion']);
    await Empresa.updateOne(
      { tenantId: req.session.tenantId },
      {
        $set: {
          'nominaIsr.modo': allowed.has(modo) ? modo : 'inteligente_alerta',
          'nominaIsr.activo': req.body.activo === 'on' || req.body.activo === '1' || req.body.activo === true
        }
      }
    );
    req.flash('success', 'Motor ISR actualizado');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo guardar');
  }
  res.redirect('/nomina/configuracion');
}

async function saveDiasPagadosConfig(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const getEmpresaModel = require('../models/empresa');
    const { mergePolitica } = require('../libs/diasPagadosMotor');
    const Empresa = await getEmpresaModel();
    const flag = (name) =>
      req.body[name] === 'on' || req.body[name] === '1' || req.body[name] === true;
    const numOrNull = (v) => {
      if (v == null || String(v).trim() === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const modos = new Set(['todo_o_nada', 'proporcional', 'conservar', 'ninguno']);
    const modoDescanso = modos.has(String(req.body.modoDescanso || ''))
      ? String(req.body.modoDescanso)
      : 'todo_o_nada';

    const nominaDias = mergePolitica({
      activo: flag('activo'),
      modoDescanso,
      pierdeDescansoConUnaFaltaInjustificada: flag('pierdeDescansoConUnaFaltaInjustificada'),
      pagaDescansoConIncapacidad: flag('pagaDescansoConIncapacidad'),
      pagaDescansoConVacaciones: flag('pagaDescansoConVacaciones'),
      pagaDescansoConPermisoConGoce: flag('pagaDescansoConPermisoConGoce'),
      cuentaJustificadasComoCumplidas: flag('cuentaJustificadasComoCumplidas'),
      imssUsaDiasPagados: flag('imssUsaDiasPagados'),
      diasProgramadosPorPeriodo: numOrNull(req.body.diasProgramadosPorPeriodo),
      diasDescansoPorPeriodo: numOrNull(req.body.diasDescansoPorPeriodo)
    });

    await Empresa.updateOne({ tenantId: req.session.tenantId }, { $set: { nominaDias } });
    req.flash('success', 'Política de días pagados guardada');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo guardar');
  }
  res.redirect('/nomina/configuracion');
}

async function saveDescuentosConfig(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const getEmpresaModel = require('../models/empresa');
    const { parsePoliticaDescuentosFromBody } = require('../libs/politicaDescuentosDefaults');
    const Empresa = await getEmpresaModel();
    const nominaDescuentos = parsePoliticaDescuentosFromBody(req.body);
    await Empresa.updateOne({ tenantId: req.session.tenantId }, { $set: { nominaDescuentos } });
    req.flash('success', 'Política de descuentos por concepto guardada');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo guardar');
  }
  res.redirect('/nomina/configuracion');
}

module.exports = {
  index,
  periodos,
  createPeriodo,
  updatePeriodoPrestacionesAction,
  showPeriodo,
  vincularPrenominaAction,
  calcularPeriodoAction,
  estadoCalculoApi,
  cerrarPeriodoAction,
  showRecibo,
  conceptos,
  newConcepto,
  createConcepto,
  showConcepto,
  saveConceptoPropsAction,
  saveFormulaAction,
  toggleConceptoAction,
  validarFormulaApi,
  probarFormulaApi,
  configuracion,
  saveIsrMotorConfig,
  saveDiasPagadosConfig,
  saveDescuentosConfig
};

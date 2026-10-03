'use strict';

const getPeriodoNominaModel = require('../models/periodoNomina');
const getReciboNominaModel = require('../models/reciboNomina');
const getConceptoAplicadoModel = require('../models/conceptoAplicado');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getNominaCfdiArchivoModel = require('../models/nominaCfdiArchivo');
const { obtenerCfdiArchivoParaDescarga } = require('../services/cfdiArchivoService');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const getEmpleadoModel = require('../models/empleado');
const getConceptoNominaModel = require('../models/conceptoNomina');
const getTablaFiscalModel = require('../models/tablaFiscal');
const getRangoFiscalModel = require('../models/rangoFiscal');
const getParametroGeneralModel = require('../models/parametroGeneral');
const getCatalogoSatModel = require('../models/catalogoSat');
const { requireEmpresaForTenant, sessionSubsidiariaId } = require('../libs/tenantScope');
const { listPeriodosNominaScoped } = require('../libs/periodosNominaScope');
const {
  listTiposPeriodo,
  ensureTiposPeriodoForTenant
} = require('../services/tipoPeriodoNominaService');
const { clasificacionFromTipoPeriodo } = require('../libs/empleadoTipoPeriodo');
const { tenantHasFeature } = require('../libs/tenantFeatureFlags');
const { resolveNominaConceptoModo, userCanEditNomina, userCanViewNomina } = require('../libs/roleAccess');
const { resolvePeriodRange } = require('../libs/payrollPeriodDates');
const { trimString, parseDate, parseCheckbox, parsePositiveNumber } = require('../libs/formHelpers');
const { parseBodyStringList } = require('../libs/conceptoAplicabilidad');
const {
  asignarNumeroPeriodo,
  ensureNumerosPeriodoTenant,
  mapSugerenciasSiguientePeriodo,
  pickSugerenciaDefault,
  rangoSiguienteTrasUltimo,
  diasPeriodoUtc,
  startOfUtcDay,
  endOfUtcDay
} = require('../libs/periodoNumero');
const { startOfDay, endOfDay, diasCalendarioInclusive } = require('../libs/timeHelpers');
const { sugerirPagaDespensa } = require('../libs/periodoPrestacionesFlags');
const {
  MODULO_NOMINA,
  SECCIONES_NOMINA,
  RELACION_PRENOMINA,
  TIPOS_PERIODO,
  TIPOS_NOMINA,
  PERIODICIDADES_PAGO_SAT,
  TIPOS_NOMINA_CFDI,
  MOTOR_A_PERIODICIDAD_SAT,
  tipoNominaCfdiDesdeNegocio,
  periodicidadSatDesdeMotor,
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
  const { empresa, error } = await requireEmpresaForTenant(req);

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
  const { empresa, error } = await requireEmpresaForTenant(req);
  const PeriodoNomina = await getPeriodoNominaModel();
  const PayrollPeriod = await getPayrollPeriodModel();
  const subId = sessionSubsidiariaId(req);

  if (empresa) {
    await ensureNumerosPeriodoTenant(PeriodoNomina, tenantId);
  }

  const filtros = {
    anio: trimString(req.query.anio),
    tipoPeriodo: trimString(req.query.tipoPeriodo),
    tipoNomina: trimString(req.query.tipoNomina),
    estatus: trimString(req.query.estatus),
    tipoNominaCfdi: trimString(req.query.tipoNominaCfdi).toUpperCase(),
    periodicidadPagoSat: trimString(req.query.periodicidadPagoSat),
    q: trimString(req.query.q)
  };

  const filter = {};
  if (filtros.anio && /^\d{4}$/.test(filtros.anio)) filter.anio = Number(filtros.anio);
  if (filtros.tipoPeriodo) filter.tipoPeriodo = filtros.tipoPeriodo;
  if (filtros.tipoNomina) filter.tipoNomina = filtros.tipoNomina;
  if (filtros.estatus) filter.estatus = filtros.estatus;
  if (filtros.tipoNominaCfdi === 'O' || filtros.tipoNominaCfdi === 'E') {
    filter.tipoNominaCfdi = filtros.tipoNominaCfdi;
  }
  if (filtros.periodicidadPagoSat && /^\d+$/.test(filtros.periodicidadPagoSat)) {
    filter.periodicidadPagoSat = Number(filtros.periodicidadPagoSat);
  }
  if (filtros.q) {
    const rx = new RegExp(filtros.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ notas: rx }, { cerradoPorLabel: rx }, { calculadoPorLabel: rx }];
  }

  const periodosList = empresa
    ? await listPeriodosNominaScoped({
        tenantId,
        empresaId: empresa._id,
        subsidiariaId: subId,
        filter,
        limit: 200
      })
    : [];
  const prenominaQ = { tenantId, empresaId: empresa._id, compartirConNomina: true };
  if (subId) prenominaQ.subsidiariaId = subId;
  const prenominaPeriodos = empresa
    ? await PayrollPeriod.find(prenominaQ).sort({ fechaInicio: -1 }).limit(80).lean()
    : [];

  let tiposPeriodoCatalogo = [];
  if (empresa) {
    await ensureTiposPeriodoForTenant(tenantId, empresa._id);
    tiposPeriodoCatalogo = (await listTiposPeriodo(tenantId, true, empresa._id)).map((t) => {
      const clasif = clasificacionFromTipoPeriodo(t);
      return {
        ...t,
        clasificacion: clasif,
        clasificacionLabel:
          clasif === 'sindicalizado' ? 'Sindicalizado' : clasif === 'confianza' ? 'Confianza' : ''
      };
    });
  }
  const tiposPeriodoById = {};
  for (const t of tiposPeriodoCatalogo) tiposPeriodoById[String(t._id)] = t;

  const openCreate = String(req.query.nuevo || '') === '1';

  let sugerenciasSiguiente = {};
  let createDefaults = {
    tipoPeriodo: 'quincenal',
    tipoPeriodoId: '',
    tipoNomina: 'ordinaria',
    fechaReferencia: null,
    sugerencia: null
  };
  if (empresa) {
    // Sugerencias: anclar al último período de la subsidiaria activa (si hay)
    const scopedForSug = await listPeriodosNominaScoped({
      tenantId,
      empresaId: empresa._id,
      subsidiariaId: subId,
      filter: {},
      limit: 300,
      annotateDisplay: true,
      collapseDuplicates: true
    });
    sugerenciasSiguiente = {};
    const byKey = new Map();
    for (const p of scopedForSug) {
      const key = p.tipoPeriodoId
        ? `id:${p.tipoPeriodoId}|${p.tipoNomina || 'ordinaria'}`
        : `${p.tipoPeriodo}|${p.tipoNomina || 'ordinaria'}`;
      const prev = byKey.get(key);
      if (!prev || new Date(p.fechaFin) > new Date(prev.fechaFin)) byKey.set(key, p);
    }
    const { ymdUtc } = require('../libs/periodoNumero');
    for (const [key, ultimo] of byKey) {
      const tipoPeriodo = ultimo.tipoPeriodo;
      const tipoNomina = ultimo.tipoNomina || 'ordinaria';
      const { ref, range, diasPeriodo } = rangoSiguienteTrasUltimo(tipoPeriodo, ultimo.fechaFin, null, {
        fechaInicioUltimo: ultimo.fechaInicio,
        diasPeriodo: ultimo.diasPeriodo
      });
      const anio = range.fechaInicio.getUTCFullYear();
      const sameYear = scopedForSug.filter((p) => {
        const sameCat = ultimo.tipoPeriodoId
          ? String(p.tipoPeriodoId || '') === String(ultimo.tipoPeriodoId)
          : p.tipoPeriodo === tipoPeriodo && !p.tipoPeriodoId;
        return (
          sameCat &&
          (p.tipoNomina || 'ordinaria') === tipoNomina &&
          Number(p.anio || new Date(p.fechaInicio).getUTCFullYear()) === anio
        );
      });
      const maxDisplay = sameYear.reduce(
        (m, p) => Math.max(m, Number(p.numeroPeriodoDisplay) || 0),
        0
      );
      sugerenciasSiguiente[key] = {
        tieneHistorico: true,
        ultimo: {
          fechaInicio: ymdUtc(ultimo.fechaInicio),
          fechaFin: ymdUtc(ultimo.fechaFin),
          anio: ultimo.anio,
          numeroPeriodo: ultimo.numeroPeriodoDisplay ?? ultimo.numeroPeriodo,
          estatus: ultimo.estatus
        },
        fechaReferencia: ymdUtc(ref),
        fechaInicio: ymdUtc(range.fechaInicio),
        fechaFin: ymdUtc(range.fechaFin),
        diasPeriodo: diasPeriodo || null,
        anio,
        numeroPeriodo: maxDisplay + 1,
        tipoPeriodo,
        tipoPeriodoId: ultimo.tipoPeriodoId ? String(ultimo.tipoPeriodoId) : '',
        tipoNomina
      };
    }
    // defaults globales si no hay histórico en sub
    const baseMap = await mapSugerenciasSiguientePeriodo(PeriodoNomina, {
      tenantId,
      empresaId: empresa._id,
      subsidiariaId: subId
    });
    for (const [k, v] of Object.entries(baseMap)) {
      if (!sugerenciasSiguiente[k]) sugerenciasSiguiente[k] = v;
    }
    const picked = pickSugerenciaDefault(sugerenciasSiguiente);
    const defTipoId =
      picked.tipoPeriodoId ||
      picked.sugerencia?.tipoPeriodoId ||
      (tiposPeriodoCatalogo.find((t) => t.tipoMotor === picked.tipoPeriodo)
        ? String(tiposPeriodoCatalogo.find((t) => t.tipoMotor === picked.tipoPeriodo)._id)
        : '');
    createDefaults = {
      tipoPeriodo: picked.tipoPeriodo,
      tipoPeriodoId: defTipoId ? String(defTipoId) : '',
      tipoNomina: picked.tipoNomina,
      fechaReferencia: picked.sugerencia?.fechaReferencia || null,
      sugerencia: picked.sugerencia || null
    };
  }

  const fechaRefDefault =
    createDefaults.fechaReferencia || new Date().toISOString().slice(0, 10);
  const refForDespensa = parseDate(fechaRefDefault) || new Date();

  res.render('Nomina/periodos', {
    periodos: periodosList,
    prenominaPeriodos,
    tiposPeriodo: TIPOS_PERIODO,
    tiposPeriodoCatalogo,
    tiposPeriodoById,
    tiposNomina: TIPOS_NOMINA,
    tiposNominaCfdi: TIPOS_NOMINA_CFDI,
    periodicidadesSat: PERIODICIDADES_PAGO_SAT,
    motorAPeriodicidadSat: MOTOR_A_PERIODICIDAD_SAT,
    estatusLabels: ESTATUS_PERIODO_NOMINA,
    filtros,
    openCreate,
    createDefaults,
    sugerenciasSiguiente,
    sugerirPagaDespensaDefault: sugerirPagaDespensa(createDefaults.tipoPeriodo, refForDespensa),
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

    const tipoPeriodoIdBody = trimString(req.body.tipoPeriodoId);
    let tipoCatalogo = null;
    if (tipoPeriodoIdBody) {
      await ensureTiposPeriodoForTenant(tenantId, empresa._id);
      const tipos = await listTiposPeriodo(tenantId, true, empresa._id);
      tipoCatalogo = tipos.find((t) => String(t._id) === tipoPeriodoIdBody) || null;
      if (!tipoCatalogo) {
        req.flash('error', 'El tipo de período seleccionado no existe o está inactivo');
        return res.redirect('/nomina/periodos?nuevo=1#nuevo-periodo');
      }
    }
    const tipoPeriodo =
      (tipoCatalogo && tipoCatalogo.tipoMotor) || trimString(req.body.tipoPeriodo) || 'quincenal';
    const tipoPeriodoId = tipoCatalogo ? tipoCatalogo._id : null;
    const tipoNomina = trimString(req.body.tipoNomina) || 'ordinaria';
    const tipoNominaCfdiBody = trimString(req.body.tipoNominaCfdi).toUpperCase();
    const tipoNominaCfdi =
      tipoNominaCfdiBody === 'O' || tipoNominaCfdiBody === 'E'
        ? tipoNominaCfdiBody
        : tipoNominaCfdiDesdeNegocio(tipoNomina);
    const periodicidadBody = Number(req.body.periodicidadPagoSat);
    const periodicidadPagoSat = Number.isFinite(periodicidadBody)
      ? periodicidadBody
      : tipoCatalogo?.periodicidadPagoSat != null
        ? Number(tipoCatalogo.periodicidadPagoSat)
        : periodicidadSatDesdeMotor(tipoPeriodo);
    const ref = parseDate(req.body.fechaReferencia) || new Date();
    const subId = sessionSubsidiariaId(req);
    const PeriodoNomina = await getPeriodoNominaModel();

    // Continuar secuencia del último período de la misma sub + catálogo (SIND/CONF)
    let fechaInicio;
    let fechaFin;
    let diasPeriodoCalc = null;
    const ultimoQ = {
      tenantId,
      empresaId: empresa._id,
      tipoPeriodo,
      tipoNomina
    };
    if (tipoPeriodoId) ultimoQ.tipoPeriodoId = tipoPeriodoId;
    if (subId) ultimoQ.subsidiariaId = subId;
    else ultimoQ.$or = [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }];
    const ultimo = await PeriodoNomina.findOne(ultimoQ).sort({ fechaFin: -1, numeroPeriodo: -1 }).lean();
    if (ultimo?.fechaFin) {
      const next = rangoSiguienteTrasUltimo(tipoPeriodo, ultimo.fechaFin, null, {
        fechaInicioUltimo: ultimo.fechaInicio,
        diasPeriodo: ultimo.diasPeriodo
      });
      fechaInicio = next.range.fechaInicio;
      fechaFin = next.range.fechaFin;
      diasPeriodoCalc = next.diasPeriodo;
    } else {
      ({ fechaInicio, fechaFin } = resolvePeriodRange(tipoPeriodo, ref, tipoCatalogo));
    }
    let fechaPago = null;

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
      fechaInicio = startOfUtcDay(prePeriodo.fechaInicio);
      fechaFin = endOfUtcDay(prePeriodo.fechaFin);
      fechaPago = prePeriodo.fechaPago ? startOfUtcDay(prePeriodo.fechaPago) : null;
      diasPeriodoCalc = diasPeriodoUtc(fechaInicio, fechaFin);
    }

    if (!fechaPago) {
      const { sugerirFechaPago } = require('../libs/calendarioPeriodo');
      fechaPago = sugerirFechaPago(fechaFin, null);
    }

    const fechaInicioNorm = startOfUtcDay(fechaInicio);
    const fechaFinNorm = endOfUtcDay(fechaFin);
    const diasPeriodo =
      diasPeriodoCalc || diasPeriodoUtc(fechaInicioNorm, fechaFinNorm) || diasCalendarioInclusive(fechaInicio, fechaFin);

    const existsQ = {
      tenantId,
      empresaId: empresa._id,
      subsidiariaId: subId || null,
      tipoPeriodo,
      tipoNomina,
      fechaInicio: fechaInicioNorm,
      fechaFin: fechaFinNorm
    };
    if (tipoPeriodoId) existsQ.tipoPeriodoId = tipoPeriodoId;
    const exists = await PeriodoNomina.findOne(existsQ);
    if (exists) {
      req.flash('error', 'Ya existe un período de nómina con esas fechas y tipo');
      return res.redirect('/nomina/periodos');
    }

    // Solape: misma sub + mismo catálogo (SIND y CONF pueden coexistir en fechas)
    const solapeQ = {
      tenantId,
      empresaId: empresa._id,
      ...(subId
        ? { subsidiariaId: subId }
        : { $or: [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }] }),
      tipoPeriodo,
      tipoNomina,
      fechaInicio: { $lte: fechaFinNorm },
      fechaFin: { $gte: fechaInicioNorm }
    };
    if (tipoPeriodoId) solapeQ.tipoPeriodoId = tipoPeriodoId;
    const solape = await PeriodoNomina.findOne(solapeQ)
      .select('_id numeroPeriodo fechaInicio fechaFin')
      .lean();
    if (solape) {
      req.flash(
        'error',
        `Las fechas se solapan con el período #${solape.numeroPeriodo || '—'} ` +
          `(${new Date(solape.fechaInicio).toLocaleDateString('es-MX')} – ${new Date(solape.fechaFin).toLocaleDateString('es-MX')}).`
      );
      return res.redirect('/nomina/periodos');
    }

    const { anio, numeroPeriodo } = await asignarNumeroPeriodo(PeriodoNomina, {
      tenantId,
      empresaId: empresa._id,
      subsidiariaId: subId,
      tipoPeriodo,
      tipoNomina,
      fechaInicio: fechaInicioNorm
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

    const clasifLab = clasificacionFromTipoPeriodo(tipoCatalogo);
    const periodo = await PeriodoNomina.create({
      tenantId,
      empresaId: empresa._id,
      subsidiariaId: subId || null,
      tipoPeriodo,
      tipoPeriodoId: tipoPeriodoId || null,
      tipoNomina,
      tipoNominaCfdi,
      periodicidadPagoSat: periodicidadPagoSat != null ? periodicidadPagoSat : null,
      fechaInicio: fechaInicioNorm,
      fechaFin: fechaFinNorm,
      fechaPago: fechaPago ? startOfUtcDay(fechaPago) : null,
      anio,
      numeroPeriodo,
      diasPeriodo,
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
      mensaje: `Período abierto ${tipoCatalogo?.nombre || tipoPeriodo}/${tipoNomina} #${numeroPeriodo}/${anio}`,
      detalle: {
        tipoPeriodo,
        tipoPeriodoId: tipoPeriodoId ? String(tipoPeriodoId) : null,
        clasificacionLaboral: clasifLab,
        tipoNomina,
        tipoNominaCfdi,
        periodicidadPagoSat,
        anio,
        numeroPeriodo,
        fechaInicio: periodo.fechaInicio,
        fechaFin: periodo.fechaFin,
        payrollPeriodId: payrollPeriodId || null
      },
      ip: req.ip,
      userAgent: req.get('user-agent') || ''
    });

    const clasifMsg =
      clasifLab === 'sindicalizado'
        ? ' · Sindicalizado'
        : clasifLab === 'confianza'
          ? ' · Confianza'
          : '';
    req.flash(
      'success',
      `Período de nómina abierto (#${numeroPeriodo} / ${anio})${clasifMsg}${
        tipoCatalogo?.nombre ? ` · ${tipoCatalogo.nombre}` : ''
      }`
    );
    res.redirect(`/nomina/periodos/${periodo._id}`);
  } catch (err) {
    console.error('[nomina]', err);
    req.flash('error', err.message || 'Error al crear período');
    res.redirect('/nomina/periodos');
  }
}

async function updatePeriodoClasificacionAction(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  const redirectTo = req.body.returnTo || `/nomina/periodos/${req.params.id}`;
  try {
    const tenantId = req.session.tenantId;
    const PeriodoNomina = await getPeriodoNominaModel();
    const periodo = await PeriodoNomina.findOne({ tenantId, _id: req.params.id });
    if (!periodo) {
      req.flash('error', 'Período no encontrado');
      return res.redirect('/nomina/periodos');
    }
    if (periodo.estatus === 'calculando') {
      req.flash('error', 'Espera a que termine el cálculo');
      return res.redirect(redirectTo);
    }

    const allowed = new Set(TIPOS_NOMINA.map((t) => t.value));
    const tipoNomina = trimString(req.body.tipoNomina);
    if (!tipoNomina || !allowed.has(tipoNomina)) {
      req.flash('error', 'Tipo de nómina inválido');
      return res.redirect(redirectTo);
    }

    if (tipoNomina !== periodo.tipoNomina && periodo.numeroPeriodo != null) {
      const clash = await PeriodoNomina.findOne({
        tenantId,
        empresaId: periodo.empresaId,
        anio: periodo.anio,
        tipoPeriodo: periodo.tipoPeriodo,
        tipoNomina,
        numeroPeriodo: periodo.numeroPeriodo,
        _id: { $ne: periodo._id }
      })
        .select('_id')
        .lean();
      if (clash) {
        req.flash(
          'error',
          `Ya existe el período #${periodo.numeroPeriodo} ${periodo.tipoPeriodo}/${tipoNomina} en ${periodo.anio}`
        );
        return res.redirect(redirectTo);
      }
    }

    const prev = periodo.tipoNomina;
    periodo.tipoNomina = tipoNomina;
    // Si aún no hay CFDI tipificado y el usuario clasifica especial → E
    if (!periodo.tipoNominaCfdi) {
      periodo.tipoNominaCfdi = tipoNomina === 'ordinaria' ? 'O' : 'E';
    }
    await periodo.save();

    if (periodo.payrollPeriodId) {
      const PayrollPeriod = await getPayrollPeriodModel();
      await PayrollPeriod.updateOne(
        { _id: periodo.payrollPeriodId, tenantId },
        {
          $set: {
            tipoNomina,
            ...(periodo.tipoNominaCfdi ? { tipoNominaCfdi: periodo.tipoNominaCfdi } : {})
          }
        }
      );
    }

    await registrarAuditoriaNomina({
      tenantId,
      empresaId: periodo.empresaId,
      periodoId: periodo._id,
      accion: 'clasificacion_periodo',
      mensaje: `Tipo nómina: ${prev} → ${tipoNomina}`,
      ...sessionActor(req)
    }).catch(() => {});

    req.flash('success', `Tipo de nómina actualizado a «${tipoNomina}»`);
    return res.redirect(redirectTo);
  } catch (err) {
    req.flash('error', err.message || 'No se pudo actualizar la clasificación');
    return res.redirect(redirectTo);
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
  let recibosTotal = 0;
  let recibosPage = 1;
  let recibosPageSize = 50;
  let recibosPages = 1;
  let recibosFiltros = { q: '', departamento: '', departamentos: [] };

  if (periodo.estatus === 'cerrado') {
    // Cierre formal + importación CFDI (ambos viven en histórico)
    const histFilter = {
      tenantId,
      empresaId: periodo.empresaId,
      periodoId: periodo._id
    };
    const qEmp = trimString(req.query.q);
    const deptoFiltro = trimString(req.query.departamento);
    if (deptoFiltro) {
      histFilter['empleado.departamentoNombre'] = deptoFiltro;
    }
    if (qEmp) {
      const rx = new RegExp(qEmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      histFilter.$or = [{ 'empleado.numEmpleado': rx }, { 'empleado.nombre': rx }];
    }

    recibosDesdeHistorico = true;
    recibosPage = Math.max(1, Number(req.query.page) || 1);
    recibosPageSize = Math.min(200, Math.max(20, Number(req.query.pageSize) || 50));
    recibosTotal = await Historico.countDocuments(histFilter);
    recibosPages = Math.max(1, Math.ceil(recibosTotal / recibosPageSize));
    if (recibosPage > recibosPages) recibosPage = recibosPages;

    const [hist, deptosAgg] = await Promise.all([
      Historico.find(histFilter)
        .select(
          [
            'empleadoId',
            'empleado',
            'diasLaborados',
            'faltas',
            'totalPercepciones',
            'totalDeducciones',
            'netoPagar',
            'insumosFuente',
            'calculoId',
            'calculoLoteId',
            'fechaCalculo',
            'fechaCierre',
            'layoutBancario',
            'timbrado',
            'correo',
            'origen'
          ].join(' ')
        )
        .sort({ 'empleado.numEmpleado': 1, netoPagar: -1 })
        .skip((recibosPage - 1) * recibosPageSize)
        .limit(recibosPageSize)
        .lean(),
      Historico.aggregate([
        {
          $match: {
            tenantId,
            empresaId: periodo.empresaId,
            periodoId: periodo._id,
            'empleado.departamentoNombre': { $exists: true, $nin: [null, ''] }
          }
        },
        { $group: { _id: '$empleado.departamentoNombre', n: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ])
    ]);

    recibosFiltros = {
      q: qEmp,
      departamento: deptoFiltro,
      departamentos: deptosAgg.map((d) => ({ nombre: d._id, n: d.n }))
    };

    recibos = hist.map((h) => ({
      _id: h._id,
      empleadoId: h.empleadoId,
      diasLaborados: h.diasLaborados,
      faltas: h.faltas,
      totalPercepciones: h.totalPercepciones,
      totalDeducciones: h.totalDeducciones,
      netoPagar: h.netoPagar,
      insumosFuente: h.insumosFuente || (h.origen === 'importacion' ? 'importacion_cfdi' : 'default'),
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
      empleadoNombre: h.empleado?.nombre || '—',
      departamentoNombre: h.empleado?.departamentoNombre || '',
      archivoXmlId: h.timbrado?.archivoXmlId || null,
      cfdiUuid: h.timbrado?.uuid || ''
    }));

    // Resuelve XML guardado por historicoId/uuid cuando el snapshot no trae archivoXmlId
    const needLookup = recibos.filter((r) => !r.archivoXmlId && (r._id || r.cfdiUuid));
    if (needLookup.length) {
      const CfdiArchivo = await getNominaCfdiArchivoModel();
      const histIds = needLookup.map((r) => r._id);
      const uuids = needLookup.map((r) => r.cfdiUuid).filter(Boolean);
      const archivos = await CfdiArchivo.find({
        tenantId,
        tipo: 'xml',
        $or: [
          ...(histIds.length ? [{ historicoId: { $in: histIds } }] : []),
          ...(uuids.length ? [{ uuid: { $in: uuids } }] : [])
        ]
      })
        .select('_id historicoId uuid')
        .lean();
      const byHist = new Map(
        archivos.filter((a) => a.historicoId).map((a) => [String(a.historicoId), a._id])
      );
      const byUuid = new Map(
        archivos.filter((a) => a.uuid).map((a) => [String(a.uuid).toUpperCase(), a._id])
      );
      recibos = recibos.map((r) => {
        if (r.archivoXmlId) return r;
        const id =
          byHist.get(String(r._id)) ||
          (r.cfdiUuid ? byUuid.get(String(r.cfdiUuid).toUpperCase()) : null);
        return id ? { ...r, archivoXmlId: id } : r;
      });
    }
  } else {
    recibos = await ReciboNomina.find({ tenantId, periodoId: periodo._id }).lean();
    recibosTotal = recibos.length;
    const empleadoIds = recibos.map((r) => r.empleadoId);
    const empleados = await Empleado.find({ _id: { $in: empleadoIds } }).lean();
    const empleadoMap = new Map(empleados.map((e) => [String(e._id), e]));
    recibos = recibos.map((r) => {
      const emp = empleadoMap.get(String(r.empleadoId));
      return {
        ...r,
        empleadoNombre: emp ? `${emp.firstName} ${emp.lastName}` : '—',
        numEmpleado: emp?.numEmpleado || '',
        desdeHistorico: false,
        archivoXmlId: r.timbrado?.archivoXmlId || null,
        cfdiUuid: r.timbrado?.uuid || ''
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

  // # visible alineado a la subsidiaria activa (1..N cronológico en el listado)
  try {
    const { empresa: empCtx } = await requireEmpresaForTenant(req);
    const subId = sessionSubsidiariaId(req);
    if (empCtx) {
      const siblings = await listPeriodosNominaScoped({
        tenantId,
        empresaId: empCtx._id,
        subsidiariaId: subId,
        filter: {
          tipoPeriodo: periodo.tipoPeriodo,
          tipoNomina: periodo.tipoNomina || 'ordinaria',
          anio: periodo.anio || new Date(periodo.fechaInicio).getFullYear()
        },
        limit: 200,
        annotateDisplay: true,
        collapseDuplicates: true
      });
      const hit = siblings.find((p) => String(p._id) === String(periodo._id));
      if (hit?.numeroPeriodoDisplay != null) {
        periodo.numeroPeriodoDisplay = hit.numeroPeriodoDisplay;
      }
    }
  } catch (_) {
    /* no bloquear detalle */
  }

  let tipoPeriodoCatalogo = null;
  if (periodo.tipoPeriodoId && periodo.empresaId) {
    try {
      const tipos = await listTiposPeriodo(tenantId, false, periodo.empresaId);
      const hit = tipos.find((t) => String(t._id) === String(periodo.tipoPeriodoId));
      if (hit) {
        const clasif = clasificacionFromTipoPeriodo(hit);
        tipoPeriodoCatalogo = {
          ...hit,
          clasificacion: clasif,
          clasificacionLabel:
            clasif === 'sindicalizado' ? 'Sindicalizado' : clasif === 'confianza' ? 'Confianza' : ''
        };
      }
    } catch (_) {
      /* opcional */
    }
  }

  res.render('Nomina/periodo-show', {
    periodo,
    tipoPeriodoCatalogo,
    recibos,
    recibosDesdeHistorico,
    recibosTotal,
    recibosPage,
    recibosPageSize,
    recibosPages,
    recibosFiltros,
    preflight,
    calculoJob,
    prenominaPeriodo,
    prenominaCandidatos,
    auditoria,
    calculadoPor,
    cerradoPor,
    tiposNomina: TIPOS_NOMINA,
    tiposNominaCfdi: TIPOS_NOMINA_CFDI,
    periodicidadesSat: PERIODICIDADES_PAGO_SAT,
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
        empresaId: periodo.empresaId,
        tipoPeriodo: periodo.tipoPeriodo,
        tipoNomina: periodo.tipoNomina || 'ordinaria',
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
  let histDoc = null;

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
      histDoc = histPorOrigen;
      recibo = mapHistoricoToReciboView(histPorOrigen);
      conceptos = histPorOrigen.conceptos || [];
      desdeHistorico = true;
    } else {
      histDoc = hist;
      recibo = mapHistoricoToReciboView(hist);
      conceptos = hist.conceptos || [];
      desdeHistorico = true;
    }
  }

  const ConceptoNomina = await getConceptoNominaModel();
  const empScope = await reqEmp(req).catch(() => ({ empresa: null }));
  const catalogoQ = empScope.empresa
    ? { tenantId, empresaId: empScope.empresa._id }
    : { tenantId };

  const [empleado, catalogo] = await Promise.all([
    Empleado.findOne({ _id: recibo.empleadoId }).lean(),
    ConceptoNomina.find(catalogoQ)
      .select('codigo nombre naturaleza tipo claveSAT sat metadata ordenImpresion ordenCalculo')
      .lean()
  ]);

  let periodo = null;
  if (recibo.periodoId) {
    periodo = await PeriodoNomina.findOne({ _id: recibo.periodoId }).lean();
  }
  if (!periodo && req.params.id && String(req.params.id) !== String(recibo.periodoId || '')) {
    periodo = await PeriodoNomina.findOne({ _id: req.params.id }).lean();
  }

  // Históricos de importación pueden tener periodoId huérfano o solo snapshot embebido.
  if (!periodo) {
    const snap = histDoc?.periodo || null;
    const fallbackId = recibo.periodoId || req.params.id || null;
    if (snap || fallbackId) {
      periodo = {
        _id: fallbackId,
        tipoPeriodo: snap?.tipoPeriodo || '',
        tipoNomina: snap?.tipoNomina || '',
        numeroPeriodo: snap?.numeroPeriodo ?? null,
        anio: histDoc?.anio || null,
        fechaInicio: snap?.fechaInicio || null,
        fechaFin: snap?.fechaFin || null,
        diasPeriodo: snap?.diasPeriodo || 0,
        estatus: 'cerrado',
        _sintetico: true
      };
    }
  }

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

  let hasXmlCfdi = Boolean(recibo.timbrado?.archivoXmlId);
  if (!hasXmlCfdi) {
    const CfdiArchivo = await getNominaCfdiArchivoModel();
    const uuid = String(recibo.timbrado?.uuid || '').toUpperCase();
    const found = await CfdiArchivo.findOne({
      tenantId,
      tipo: 'xml',
      $or: [
        { historicoId: recibo._id },
        ...(uuid ? [{ uuid }] : []),
        { reciboId: recibo._id }
      ]
    })
      .select('_id')
      .lean();
    hasXmlCfdi = Boolean(found);
  }

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
    hasXmlCfdi,
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
    timbrado: hist.timbrado || null,
    desdeHistorico: true
  };
}

/**
 * Descarga XML CFDI del recibo/histórico (import o timbrado local).
 */
async function descargarXmlRecibo(req, res) {
  if (requireNominaViewOrRedirect(req, res) === false) return;
  const tenantId = req.session.tenantId;
  const ReciboNomina = await getReciboNominaModel();
  const Historico = await getNominaHistoricoReciboModel();
  const CfdiArchivo = await getNominaCfdiArchivoModel();

  let archivoId = null;
  let uuid = '';

  const recibo = await ReciboNomina.findOne({ tenantId, _id: req.params.reciboId })
    .select('timbrado')
    .lean();
  if (recibo) {
    archivoId = recibo.timbrado?.archivoXmlId || null;
    uuid = recibo.timbrado?.uuid || '';
  } else {
    const hist =
      (await Historico.findOne({ tenantId, _id: req.params.reciboId })
        .select('timbrado')
        .lean()) ||
      (await Historico.findOne({ tenantId, reciboOrigenId: req.params.reciboId })
        .select('timbrado')
        .lean());
    if (hist) {
      archivoId = hist.timbrado?.archivoXmlId || null;
      uuid = hist.timbrado?.uuid || '';
      if (!archivoId) {
        const byHist = await CfdiArchivo.findOne({
          tenantId,
          historicoId: hist._id,
          tipo: 'xml'
        })
          .select('_id')
          .lean();
        archivoId = byHist?._id || null;
      }
    }
  }

  if (!archivoId && uuid) {
    const byUuid = await CfdiArchivo.findOne({
      tenantId,
      uuid: String(uuid).toUpperCase(),
      tipo: 'xml'
    })
      .select('_id')
      .lean();
    archivoId = byUuid?._id || null;
  }

  if (!archivoId) return res.status(404).send('XML no disponible para este recibo');

  const doc = await obtenerCfdiArchivoParaDescarga(tenantId, archivoId);
  if (!doc || !doc.contenido) return res.status(404).send('Archivo XML no encontrado');

  const buf = Buffer.isBuffer(doc.contenido)
    ? doc.contenido
    : Buffer.from(doc.contenido.buffer || doc.contenido);
  const nombre = doc.nombreArchivo || `cfdi_${doc.uuid || archivoId}.xml`;
  res.setHeader('Content-Type', doc.contentType || 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${nombre.replace(/"/g, '')}"`);
  res.setHeader('Content-Length', buf.length);
  return res.send(buf);
}

// ── Conceptos ────────────────────────────────────────────

async function conceptos(req, res) {
  if (requireNominaViewOrRedirect(req, res) === false) return;
  const tenantId = req.session.tenantId;
  const { empresa, error } = await requireEmpresaForTenant(req);
  const canEdit = userCanEditNomina(req.session);
  const subId = sessionSubsidiariaId(req);

  if (empresa) {
    await ensureNominaConceptsForTenant(tenantId, empresa._id);
    try {
      const { ensureCompanyConceptConfigs } = require('../services/nomina/conceptResolutionService');
      await ensureCompanyConceptConfigs(tenantId, empresa._id);
    } catch (_) {
      /* opcional */
    }
  }

  let conceptosList = [];
  if (empresa) {
    try {
      const {
        listConceptosVisiblesParaSubsidiaria
      } = require('../services/nomina/conceptResolutionService');
      conceptosList = await listConceptosVisiblesParaSubsidiaria(tenantId, empresa._id, subId, {
        backfillHistorico: true,
        // En la pantalla de catálogo sí mostramos inactivos (Activo = No) para que el cambio se vea
        ocultarDeshabilitados: false
      });
    } catch (err) {
      console.error('[conceptos] list:', err);
      conceptosList = await listConceptos(tenantId, empresa._id);
      conceptosList = conceptosList.map((c) => ({
        ...c,
        aplicaEn: c.aplicaEn || c.metadata?.aplicaEn || 'nomina',
        tiposIncidencia: c.tiposIncidencia || c.metadata?.tiposIncidencia || [],
        activoUi: c.activo !== false
      }));
    }
  }

  res.render('Nomina/conceptos', {
    conceptos: conceptosList,
    tiposConcepto: TIPOS_CONCEPTO,
    naturalezas: NATURALEZAS_CONCEPTO,
    empresa,
    subsidiariaId: subId || null,
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
  const { empresa, error } = await requireEmpresaForTenant(req);
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
    try {
      const {
        upsertSubsidiaryConceptConfig
      } = require('../services/nomina/conceptResolutionService');
      await upsertSubsidiaryConceptConfig({
        tenantId,
        empresaId: empresa._id,
        subsidiariaId: sessionSubsidiariaId(req),
        conceptoCodigo: req.body.codigo,
        origen: 'manual',
        aliasNombre: req.body.nombre || '',
        tipo: req.body.tipo || ''
      });
    } catch (_) {
      /* opcional */
    }
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

  const { empresa } = await requireEmpresaForTenant(req);
  const data = await getConceptoConFormulas(tenantId, codigo, empresa ? empresa._id : null);

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

  const todosConceptos = await listConceptos(tenantId, empresa ? empresa._id : null);
  const conceptosOtros = todosConceptos.filter((c) => c.codigo !== codigo);

  let companyConfig = null;
  let catalogEntry = null;
  try {
    const { getCatalogWithCompanyConfig, ensureDefaultFormulas } = require('../services/nomina/conceptResolutionService');
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
        descuentoProgramado: {
          permite: req.body.dpPermite === 'on' || req.body.dpPermite === '1' || req.body.dpPermite === true,
          permiteSaldo:
            req.body.dpPermiteSaldo === 'on' ||
            req.body.dpPermiteSaldo === '1' ||
            req.body.dpPermiteSaldo === true,
          permiteParcial:
            req.body.dpPermiteParcial === 'on' ||
            req.body.dpPermiteParcial === '1' ||
            req.body.dpPermiteParcial === true,
          tipoInterno: req.body.dpTipoInterno || ''
        },
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
      const { empresa } = await requireEmpresaForTenant(req);
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

async function deshabilitarPreviosHistoricoAction(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const tenantId = req.session.tenantId;
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) {
      req.flash('error', error || 'Sin empresa');
      return res.redirect('/nomina/conceptos');
    }
    const {
      deshabilitarConceptosPreviosAlHistor
    } = require('../services/nomina/conceptResolutionService');
    const result = await deshabilitarConceptosPreviosAlHistor({
      tenantId,
      empresaId: empresa._id,
      subsidiariaId: sessionSubsidiariaId(req)
    });
    req.flash(
      'success',
      `Conceptos previos deshabilitados: empresa ${result.companyDeshabilitados}` +
        (result.companyCodigos.length
          ? ` (${result.companyCodigos.slice(0, 12).join(', ')}${result.companyCodigos.length > 12 ? '…' : ''})`
          : '') +
        `; sub ${result.subDeshabilitados}; maestro ${result.maestroDeshabilitados || 0}. ` +
        `Se conservan histórico/CFDI + núcleo operativo.`
    );
  } catch (err) {
    console.error('[deshabilitarPreviosHistorico]', err);
    req.flash('error', err.message || 'No se pudieron deshabilitar conceptos');
  }
  res.redirect('/nomina/conceptos');
}

async function toggleConceptoAction(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const tenantId = req.session.tenantId;
    const codigo = String(req.params.codigo || '').trim().toUpperCase();
    const subId = sessionSubsidiariaId(req);
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) {
      req.flash('error', error || 'Sin empresa');
      return res.redirect('/nomina/conceptos');
    }

    const accion = String(req.body.accion || req.body.action || '')
      .trim()
      .toLowerCase();
    const {
      setConceptoVisibilidad,
      toggleConceptoVisibilidad
    } = require('../services/nomina/conceptResolutionService');

    let result;
    if (accion === 'desactivar' || accion === 'disable' || accion === '0' || accion === 'off') {
      result = await setConceptoVisibilidad(tenantId, empresa._id, subId, codigo, false);
    } else if (accion === 'activar' || accion === 'enable' || accion === '1' || accion === 'on') {
      result = await setConceptoVisibilidad(tenantId, empresa._id, subId, codigo, true);
    } else {
      result = await toggleConceptoVisibilidad(tenantId, empresa._id, subId, codigo);
    }

    req.flash(
      'success',
      result.activo
        ? `Concepto ${result.codigo} activado`
        : `Concepto ${result.codigo} desactivado: no participará en futuros cálculos`
    );
  } catch (err) {
    console.error('[toggleConcepto]', err);
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

async function organizarPeriodosAction(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) {
      req.flash('error', error || 'Sin empresa');
      return res.redirect('/nomina/periodos');
    }
    const {
      organizarPeriodosTrasImportacion
    } = require('../services/nomina/organizarPeriodosService');
    const tipoMotor = trimString(req.body.tipoPeriodo) || 'semanal';
    const tipoNomina = trimString(req.body.tipoNomina) || 'ordinaria';
    const subId = sessionSubsidiariaId(req);
    const result = await organizarPeriodosTrasImportacion({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      tipoMotor,
      tipoNomina,
      subsidiariaId: subId
    });
    const sep = result.separacion || {};
    const act = result.resumenActivo;
    req.flash(
      'success',
      `Períodos organizados (${tipoMotor}/${tipoNomina}): ` +
        `separados ${sep.split || 0}, sellados ${sep.stamped || 0}` +
        (act
          ? `, sub activa renumerados ${act.renumerados || 0} (fusiones ${act.merges || 0})`
          : '') +
        '.'
    );
  } catch (err) {
    console.error('[organizarPeriodos]', err);
    req.flash('error', err.message || 'No se pudieron organizar los períodos');
  }
  const qs = new URLSearchParams();
  if (req.body.tipoPeriodo) qs.set('tipoPeriodo', req.body.tipoPeriodo);
  if (req.body.tipoNomina) qs.set('tipoNomina', req.body.tipoNomina);
  if (req.body.anio) qs.set('anio', req.body.anio);
  const q = qs.toString();
  res.redirect(`/nomina/periodos${q ? `?${q}` : ''}`);
}

async function mapeoSat(req, res) {
  if (requireNominaViewOrRedirect(req, res) === false) return;
  const tenantId = req.session.tenantId;
  const { empresa, error } = await requireEmpresaForTenant(tenantId);
  const subId = sessionSubsidiariaId(req);
  const canEdit = userCanEditNomina(req.session);

  let mapa = { rows: [], overridesCount: 0 };
  let codigosMotor = [];
  if (empresa) {
    const { listMapaEfectivo } = require('../services/nomina/satConceptoMotorMapService');
    const { CODIGOS_MOTOR_CONOCIDOS } = require('../config/satConceptoMotorMap');
    mapa = await listMapaEfectivo({
      tenantId,
      empresaId: empresa._id,
      subsidiariaId: subId
    });
    const ConceptoNomina = await getConceptoNominaModel();
    const fromDb = await ConceptoNomina.find({ tenantId, empresaId: empresa._id, activo: true })
      .select('codigo')
      .sort({ codigo: 1 })
      .lean();
    const set = new Set([
      ...CODIGOS_MOTOR_CONOCIDOS,
      ...fromDb.map((c) => String(c.codigo).toUpperCase()),
      ...mapa.rows.map((r) => r.conceptoCodigo)
    ]);
    codigosMotor = [...set].filter(Boolean).sort();
  }

  res.render('Nomina/mapeo-sat', {
    mapa,
    codigosMotor,
    empresa,
    subsidiariaId: subId || null,
    canEdit,
    error: error || null,
    session: req.session
  });
}

async function saveMapeoSatAction(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const tenantId = req.session.tenantId;
    const { empresa, error } = await requireEmpresaForTenant(tenantId);
    if (error || !empresa) {
      req.flash('error', error || 'Sin empresa');
      return res.redirect('/nomina/mapeo-sat');
    }
    const { upsertOverride } = require('../services/nomina/satConceptoMotorMapService');
    await upsertOverride({
      tenantId,
      empresaId: empresa._id,
      subsidiariaId: sessionSubsidiariaId(req),
      tipo: trimString(req.body.tipo),
      claveSat: trimString(req.body.claveSat),
      conceptoCodigo: trimString(req.body.conceptoCodigo),
      matchNombre: trimString(req.body.matchNombre),
      esDefault: req.body.esDefault === '1' || req.body.esDefault === true,
      notas: trimString(req.body.notas)
    });
    req.flash('success', 'Override SAT → motor guardado para esta subsidiaria');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo guardar el mapeo');
  }
  res.redirect('/nomina/mapeo-sat');
}

async function deleteMapeoSatAction(req, res) {
  if (requireNominaEditOrRedirect(req, res) === false) return;
  try {
    const tenantId = req.session.tenantId;
    const { empresa, error } = await requireEmpresaForTenant(tenantId);
    if (error || !empresa) {
      req.flash('error', error || 'Sin empresa');
      return res.redirect('/nomina/mapeo-sat');
    }
    const { deleteOverride } = require('../services/nomina/satConceptoMotorMapService');
    const ok = await deleteOverride({
      tenantId,
      empresaId: empresa._id,
      subsidiariaId: sessionSubsidiariaId(req),
      id: req.params.id
    });
    req.flash(ok ? 'success' : 'error', ok ? 'Override eliminado' : 'Override no encontrado');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo eliminar');
  }
  res.redirect('/nomina/mapeo-sat');
}

module.exports = {
  index,
  periodos,
  createPeriodo,
  organizarPeriodosAction,
  updatePeriodoPrestacionesAction,
  updatePeriodoClasificacionAction,
  showPeriodo,
  vincularPrenominaAction,
  calcularPeriodoAction,
  estadoCalculoApi,
  cerrarPeriodoAction,
  showRecibo,
  descargarXmlRecibo,
  conceptos,
  newConcepto,
  createConcepto,
  deshabilitarPreviosHistoricoAction,
  showConcepto,
  saveConceptoPropsAction,
  saveFormulaAction,
  toggleConceptoAction,
  validarFormulaApi,
  probarFormulaApi,
  configuracion,
  saveIsrMotorConfig,
  saveDiasPagadosConfig,
  saveDescuentosConfig,
  mapeoSat,
  saveMapeoSatAction,
  deleteMapeoSatAction
};

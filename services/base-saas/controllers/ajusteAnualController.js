'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const {
  trimString,
  parseOptionalObjectId,
  parseDate,
  parsePositiveNumber,
  parseCheckbox
} = require('../libs/formHelpers');
const getDepartamentoModel = require('../models/departamento');
const getPuestoModel = require('../models/puesto');
const getCentroCostoModel = require('../models/centroCosto');
const getSubsidiariaModel = require('../models/subsidiaria');
const { listTiposPeriodo } = require('../services/tipoPeriodoNominaService');
const { getEnumItems } = require('../services/nomina/systemEnumService');
const {
  PROPOSITOS_AJUSTE,
  MODOS_CALCULO,
  ETAPAS_AUTORIZACION,
  MATRIZ_DESEMPENO_DEFAULT,
  TASA_ISN_DEFAULT,
  CSV_PLANTILLA
} = require('../config/ajusteAnualCatalog');
const {
  previewAjuste,
  guardarLote,
  autorizarEtapa,
  rechazarLote,
  aplicarLote,
  listLotes,
  getLote,
  toAjusteCsv,
  actorLabel
} = require('../services/ajusteAnualService');
const { userCanEditNomina } = require('../libs/roleAccess');

function flashRedirect(req, res, path, type, msg) {
  if (req.flash) req.flash(type, msg);
  return res.redirect(path);
}

function userIdOf(session) {
  return session?.userid || session?.userId || '';
}

function isAdminSession(session) {
  const roles = session?.roles || [];
  if (!roles.length) return true;
  return roles.some((r) => r.esAdmin || r.esAdminSistema || r.puedeGestionarPersonal);
}

function canManage(session) {
  return userCanEditNomina(session) || isAdminSession(session);
}

function parseMatriz(body) {
  const m = { ...MATRIZ_DESEMPENO_DEFAULT };
  for (let i = 1; i <= 5; i += 1) {
    const n = parsePositiveNumber(body[`matriz_${i}`]);
    if (n != null) m[i] = n;
  }
  return m;
}

function parseInput(body, fromPost = false) {
  const tasaIsnPct = parsePositiveNumber(body.tasaIsnPct);
  return {
    nombre: trimString(body.nombre),
    proposito: PROPOSITOS_AJUSTE.some((p) => p.value === body.proposito) ? body.proposito : 'inflacion',
    modo: MODOS_CALCULO.some((m) => m.value === body.modo) ? body.modo : 'porcentaje',
    vigenciaDesde: parseDate(body.vigenciaDesde),
    vigenciaHasta: parseDate(body.vigenciaHasta),
    fechaAplicacion: parseDate(body.fechaAplicacion) || new Date(),
    retroactivo: parseCheckbox(body, 'retroactivo'),
    fechaRetroactiva: parseDate(body.fechaRetroactiva),
    notas: trimString(body.notas),
    csvEvaluaciones: trimString(body.csvEvaluaciones),
    filtros: {
      departamentoId: parseOptionalObjectId(body.departamentoId),
      puestoId: parseOptionalObjectId(body.puestoId),
      tipoPeriodoId: parseOptionalObjectId(body.tipoPeriodoId),
      centroCostoId: parseOptionalObjectId(body.centroCostoId),
      subsidiariaId: parseOptionalObjectId(body.subsidiariaId),
      tipoEmpleado: trimString(body.tipoEmpleado)
    },
    regla: {
      porcentaje: parsePositiveNumber(body.porcentaje) || 0,
      presupuestoMensual: parsePositiveNumber(body.presupuestoMensual) || 0,
      topePctMasa: parsePositiveNumber(body.topePctMasa),
      respetarTopeMasa: parseCheckbox(body, 'respetarTopeMasa'),
      forzarPisoSm: fromPost ? parseCheckbox(body, 'forzarPisoSm') : true,
      escalaPrestaciones: parseCheckbox(body, 'escalaPrestaciones'),
      tasaIsn: tasaIsnPct != null ? tasaIsnPct / 100 : TASA_ISN_DEFAULT,
      matriz: parseMatriz(body)
    }
  };
}

async function loadCatalogs(tenantId, empresa) {
  if (!empresa) {
    return {
      departamentos: [],
      puestos: [],
      tiposPeriodo: [],
      centrosCosto: [],
      subsidiarias: [],
      tiposEmpleado: []
    };
  }
  const Departamento = await getDepartamentoModel();
  const Puesto = await getPuestoModel();
  const CentroCosto = await getCentroCostoModel();
  const Subsidiaria = await getSubsidiariaModel();
  const [departamentos, puestos, tiposPeriodo, centrosCosto, subsidiarias, tiposEmpleado] = await Promise.all([
    Departamento.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    Puesto.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    listTiposPeriodo(tenantId, true),
    CentroCosto.find({ tenantId, empresaId: empresa._id, activo: true }).sort({ codigo: 1 }).lean(),
    Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean(),
    getEnumItems('tipo_empleado').catch(() => [])
  ]);
  return { departamentos, puestos, tiposPeriodo, centrosCosto, subsidiarias, tiposEmpleado };
}

function viewLocals(extra) {
  return {
    propositos: PROPOSITOS_AJUSTE,
    modos: MODOS_CALCULO,
    etapas: ETAPAS_AUTORIZACION,
    matrizDefault: MATRIZ_DESEMPENO_DEFAULT,
    tasaIsnDefaultPct: TASA_ISN_DEFAULT * 100,
    csvPlantilla: CSV_PLANTILLA,
    ...extra
  };
}

async function wizard(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const catalogs = await loadCatalogs(req.session.tenantId, empresa);
  const lotes = empresa ? await listLotes(req.session.tenantId, empresa._id) : [];
  const input = parseInput(req.body || {}, req.method === 'POST');
  let preview = null;
  let runError = error || null;

  if (empresa && req.method === 'POST' && req.body.accion === 'preview') {
    try {
      preview = await previewAjuste({
        tenantId: req.session.tenantId,
        empresaId: empresa._id,
        empresa,
        input
      });
    } catch (err) {
      runError = err.message || String(err);
    }
  }

  res.render('Personal/ajuste-anual', viewLocals({
    session: req.session,
    empresa,
    error: runError,
    catalogs,
    lotes,
    input,
    preview,
    canManage: canManage(req.session)
  }));
}

async function guardar(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/personal/ajuste-anual', 'error', error || 'Sin empresa');
  if (!canManage(req.session)) {
    return flashRedirect(req, res, '/personal/ajuste-anual', 'error', 'Sin permiso para guardar el lote');
  }
  try {
    const input = parseInput(req.body, true);
    const lote = await guardarLote({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      empresa,
      input,
      userId: userIdOf(req.session),
      userLabel: actorLabel(req.session)
    });
    return res.redirect(`/personal/ajuste-anual/lotes/${lote._id}`);
  } catch (err) {
    return flashRedirect(req, res, '/personal/ajuste-anual', 'error', err.message || 'No se pudo guardar');
  }
}

async function showLote(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (!empresa) {
    return res.render('Personal/ajuste-anual-lote', viewLocals({
      session: req.session,
      empresa: null,
      error: error || 'Sin empresa',
      lote: null,
      canManage: false,
      isAdmin: false
    }));
  }
  const lote = await getLote(req.session.tenantId, empresa._id, req.params.id);
  if (!lote) return res.status(404).send('Lote no encontrado');
  res.render('Personal/ajuste-anual-lote', viewLocals({
    session: req.session,
    empresa,
    error,
    lote,
    canManage: canManage(req.session),
    isAdmin: isAdminSession(req.session)
  }));
}

async function postAutorizar(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/personal/ajuste-anual', 'error', error || 'Sin empresa');
  if (!canManage(req.session)) {
    return flashRedirect(req, res, `/personal/ajuste-anual/lotes/${req.params.id}`, 'error', 'Sin permiso');
  }
  try {
    await autorizarEtapa({
      tenantId: req.session.tenantId,
      loteId: req.params.id,
      etapa: trimString(req.body.etapa),
      userId: userIdOf(req.session),
      userLabel: actorLabel(req.session),
      comentario: trimString(req.body.comentario),
      adminTodas: parseCheckbox(req.body, 'adminTodas') && isAdminSession(req.session)
    });
    return flashRedirect(req, res, `/personal/ajuste-anual/lotes/${req.params.id}`, 'success', 'Autorización registrada');
  } catch (err) {
    return flashRedirect(req, res, `/personal/ajuste-anual/lotes/${req.params.id}`, 'error', err.message);
  }
}

async function postRechazar(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/personal/ajuste-anual', 'error', error || 'Sin empresa');
  try {
    await rechazarLote({
      tenantId: req.session.tenantId,
      loteId: req.params.id,
      userId: userIdOf(req.session),
      userLabel: actorLabel(req.session),
      comentario: trimString(req.body.comentario)
    });
    return flashRedirect(req, res, `/personal/ajuste-anual/lotes/${req.params.id}`, 'success', 'Lote rechazado');
  } catch (err) {
    return flashRedirect(req, res, `/personal/ajuste-anual/lotes/${req.params.id}`, 'error', err.message);
  }
}

async function postAplicar(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/personal/ajuste-anual', 'error', error || 'Sin empresa');
  if (!canManage(req.session)) {
    return flashRedirect(req, res, `/personal/ajuste-anual/lotes/${req.params.id}`, 'error', 'Sin permiso');
  }
  try {
    const result = await aplicarLote({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      loteId: req.params.id,
      userId: userIdOf(req.session),
      userLabel: actorLabel(req.session)
    });
    return flashRedirect(
      req,
      res,
      `/personal/ajuste-anual/lotes/${req.params.id}`,
      'success',
      `Aplicado: ${result.aplicados} empleados. Recalcula la nómina abierta para ISR/SBC.`
    );
  } catch (err) {
    return flashRedirect(req, res, `/personal/ajuste-anual/lotes/${req.params.id}`, 'error', err.message);
  }
}

async function exportCsv(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return res.status(400).send(error || 'Sin empresa');
  const lote = await getLote(req.session.tenantId, empresa._id, req.params.id);
  if (!lote) return res.status(404).send('Lote no encontrado');
  const csv = toAjusteCsv(lote);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ajuste-anual-${lote._id}.csv"`);
  res.send(csv);
}

module.exports = {
  wizard,
  guardar,
  showLote,
  postAutorizar,
  postRechazar,
  postAplicar,
  exportCsv
};

'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const {
  parseOptionalObjectId,
  parseObjectIdArray,
  parseDate,
  parseCheckbox,
  toDateInputValue
} = require('../libs/formHelpers');
const getEmpleadoModel = require('../models/empleado');
const getPeriodoNominaModel = require('../models/periodoNomina');
const getDepartamentoModel = require('../models/departamento');
const getCentroCostoModel = require('../models/centroCosto');
const {
  CAUSAS_TERMINACION,
  ESTATUS_FINIQUITO,
  CONCEPTOS_FINIQUITO,
  DEFAULTS_FINIQUITO,
  mapMotivoBajaToCausa
} = require('../config/finiquitoCatalog');
const { TIPOS_EMPLEADO } = require('../config/catalogos');
const finiquitoService = require('../services/finiquito/finiquitoService');
const { userCanEditNomina, userCanViewNomina } = require('../libs/roleAccess');

function flashRedirect(req, res, path, type, msg) {
  if (req.flash) req.flash(type, msg);
  return res.redirect(path);
}

function canView(session) {
  return userCanViewNomina(session) || userCanEditNomina(session);
}

function canEdit(session) {
  return userCanEditNomina(session);
}

function money(n) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseEmpleadoIds(body) {
  const fromArray = parseObjectIdArray(body.empleadoIds || body['empleadoIds[]']);
  if (fromArray.length) return fromArray;
  const one = parseOptionalObjectId(body.empleadoId);
  return one ? [String(one)] : [];
}

async function loadCatalogosFiltro(tenantId, empresaId) {
  const Empleado = await getEmpleadoModel();
  const Departamento = await getDepartamentoModel();
  const CentroCosto = await getCentroCostoModel();
  const Periodo = await getPeriodoNominaModel();

  const [empleados, departamentos, centrosCosto, periodos, tiposDistinct] = await Promise.all([
    Empleado.find({
      tenantId,
      empresaId,
      $or: [{ estatus: 'activo' }, { estatus: 'baja' }]
    })
      .select(
        'numEmpleado firstName lastName fechaIngreso fechaBaja motivoBaja salarioDiario estatus departamentoId centroCostoId tipoEmpleado'
      )
      .sort({ numEmpleado: 1 })
      .lean(),
    Departamento.find({ tenantId, empresaId, activo: true }).sort({ nombre: 1 }).select('_id nombre').lean(),
    CentroCosto.find({ tenantId, empresaId, activo: true })
      .sort({ codigo: 1, nombre: 1 })
      .select('_id codigo nombre')
      .lean(),
    Periodo.find({
      tenantId,
      empresaId,
      tipoNomina: { $in: ['finiquito', 'indemnizacion', 'extraordinaria'] },
      estatus: { $ne: 'cerrado' }
    })
      .sort({ fechaFin: -1 })
      .limit(20)
      .lean(),
    Empleado.distinct('tipoEmpleado', { tenantId, empresaId })
  ]);

  const tiposFromCat = TIPOS_EMPLEADO.map((t) => ({ value: t.value, label: t.label }));
  const extras = (tiposDistinct || [])
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .filter((v) => !tiposFromCat.some((t) => t.value === v))
    .map((v) => ({ value: v, label: v }));

  return {
    empleados,
    departamentos,
    centrosCosto,
    periodos,
    tiposEmpleado: [...tiposFromCat, ...extras]
  };
}

async function list(req, res) {
  if (!canView(req.session)) {
    return flashRedirect(req, res, '/', 'error', 'Sin permiso de nómina');
  }
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  let items = [];
  if (empresa) {
    items = await finiquitoService.listar({
      tenantId: req.session.tenantId,
      empresaId: empresa._id
    });
  }
  res.render('Nomina/finiquitos/list', {
    session: req.session,
    empresa,
    error,
    items,
    estatusLabels: Object.fromEntries(ESTATUS_FINIQUITO.map((e) => [e.value, e.label])),
    money
  });
}

async function newForm(req, res) {
  if (!canEdit(req.session)) {
    return flashRedirect(req, res, '/nomina/finiquitos', 'error', 'Sin permiso para calcular finiquitos');
  }
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const hoy = toDateInputValue(new Date());
  let extras = {
    empleados: [],
    departamentos: [],
    centrosCosto: [],
    periodos: [],
    tiposEmpleado: TIPOS_EMPLEADO
  };
  if (empresa) {
    extras = await loadCatalogosFiltro(req.session.tenantId, empresa._id);
  }
  res.render('Nomina/finiquitos/nuevo', {
    session: req.session,
    empresa,
    error,
    ...extras,
    causas: CAUSAS_TERMINACION,
    defaults: DEFAULTS_FINIQUITO,
    mapMotivoBajaToCausa,
    preview: null,
    previews: [],
    form: { fechaBaja: hoy, empleadoIds: [] },
    money,
    toDateInputValue,
    hoy
  });
}

function parseBodyParams(body) {
  const bool = (k) => parseCheckbox(body, k);
  const num = (k) => {
    const v = body[k];
    if (v === '' || v == null) return undefined;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    fechaIngreso: body.fechaIngreso ? parseDate(body.fechaIngreso) || undefined : undefined,
    salarioDiario: num('salarioDiario'),
    salarioBaseIndemnizacion: num('salarioBaseIndemnizacion'),
    salarioBasePrimaAntiguedad: num('salarioBasePrimaAntiguedad'),
    diasAguinaldo: num('diasAguinaldo'),
    porcentajePrimaVacacional: num('porcentajePrimaVacacional'),
    diasVacacionesPendientes: num('diasVacacionesPendientes'),
    diasPendientes: num('diasPendientes'),
    fondoAhorroSaldo: num('fondoAhorroSaldo'),
    descuentoEmpresa: num('descuentoEmpresa'),
    prestamoSaldo: num('prestamoSaldo'),
    aplicaIndemnizacionTresMeses: bool('aplicaIndemnizacionTresMeses'),
    aplica20DiasPorAnio: bool('aplica20DiasPorAnio'),
    aplicaPrimaAntiguedad: body.aplicaPrimaAntiguedad === 'on' ? true : undefined,
    aplicaSalariosVencidos: bool('aplicaSalariosVencidos'),
    salariosVencidosImporte: num('salariosVencidosImporte')
  };
}

function parseNegociacion(body) {
  const gratificacion = Number(String(body.gratificacion || '0').replace(/,/g, '')) || 0;
  const notas = String(body.negociacionNotas || '').trim();
  const activaExplicit = parseCheckbox(body, 'negociacionActiva');
  const gratificacionEsSeparacion = parseCheckbox(body, 'gratificacionEsSeparacion');
  return {
    activa: activaExplicit || gratificacion > 0,
    gratificacion,
    gratificacionEsSeparacion,
    ajustes: [],
    notas
  };
}

async function preview(req, res) {
  if (!canEdit(req.session)) {
    return flashRedirect(req, res, '/nomina/finiquitos', 'error', 'Sin permiso');
  }
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (!empresa) return flashRedirect(req, res, '/nomina/finiquitos/nuevo', 'error', error || 'Sin empresa');

  try {
    const empleadoIds = parseEmpleadoIds(req.body);
    if (!empleadoIds.length) throw new Error('Selecciona al menos un empleado');
    const causa = String(req.body.causaTerminacion || '').toUpperCase();
    const fechaBaja = parseDate(req.body.fechaBaja) || new Date();
    const parametros = parseBodyParams(req.body);
    const negociacion = parseNegociacion(req.body);
    const paramsBase =
      empleadoIds.length > 1 ? { ...parametros, fechaIngreso: undefined } : parametros;

    const previews = [];
    for (const empleadoId of empleadoIds) {
      // eslint-disable-next-line no-await-in-loop
      const p = await finiquitoService.previewCalculo({
        tenantId: req.session.tenantId,
        empresaId: empresa._id,
        empleadoId,
        causaTerminacion: causa,
        fechaBaja,
        parametros: paramsBase,
        negociacion
      });
      previews.push(p);
    }

    const extras = await loadCatalogosFiltro(req.session.tenantId, empresa._id);
    const form = { ...req.body, empleadoIds };

    res.render('Nomina/finiquitos/nuevo', {
      session: req.session,
      empresa,
      error: null,
      ...extras,
      causas: CAUSAS_TERMINACION,
      defaults: DEFAULTS_FINIQUITO,
      mapMotivoBajaToCausa,
      preview: previews.length === 1 ? previews[0] : null,
      previews,
      form,
      money,
      toDateInputValue,
      hoy: toDateInputValue(new Date())
    });
  } catch (err) {
    return flashRedirect(req, res, '/nomina/finiquitos/nuevo', 'error', err.message);
  }
}

async function create(req, res) {
  if (!canEdit(req.session)) {
    return flashRedirect(req, res, '/nomina/finiquitos', 'error', 'Sin permiso');
  }
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (!empresa) return flashRedirect(req, res, '/nomina/finiquitos/nuevo', 'error', error || 'Sin empresa');

  try {
    const empleadoIds = parseEmpleadoIds(req.body);
    if (!empleadoIds.length) throw new Error('Selecciona al menos un empleado');
    const periodoIdManual = parseOptionalObjectId(req.body.periodoId);
    const crearPeriodo = parseCheckbox(req.body, 'crearPeriodoNomina') || !!periodoIdManual;
    const omitirDispersion = !parseCheckbox(req.body, 'habilitarDispersionBancaria');
    const causa = String(req.body.causaTerminacion || '').toUpperCase();
    const fechaBaja = parseDate(req.body.fechaBaja) || new Date();
    const parametros = parseBodyParams(req.body);
    const paramsBase =
      empleadoIds.length > 1 ? { ...parametros, fechaIngreso: undefined } : parametros;
    const negociacion = parseNegociacion(req.body);
    const notas = String(req.body.notas || '').trim();
    const user = { id: req.session.userid || '', label: req.session.user || '' };

    const docs = [];
    let periodoCompartido = periodoIdManual;

    for (const empleadoId of empleadoIds) {
      // eslint-disable-next-line no-await-in-loop
      const doc = await finiquitoService.crearYCalcular({
        tenantId: req.session.tenantId,
        empresaId: empresa._id,
        empleadoId,
        causaTerminacion: causa,
        fechaBaja,
        parametros: paramsBase,
        negociacion,
        periodoId: periodoCompartido || null,
        notas,
        user
      });

      if (doc.periodoId) {
        const Periodo = await getPeriodoNominaModel();
        // eslint-disable-next-line no-await-in-loop
        await Periodo.updateOne(
          { _id: doc.periodoId, tenantId: req.session.tenantId },
          { $addToSet: { empleadoIds: doc.empleadoId } }
        );
      }

      if (crearPeriodo) {
        // eslint-disable-next-line no-await-in-loop
        const emit = await finiquitoService.emitirAPeriodoNomina(doc._id, {
          tenantId: req.session.tenantId,
          user,
          omitirDispersionBancaria: omitirDispersion
        });
        periodoCompartido = emit.periodo?._id || periodoCompartido;
      }
      docs.push(doc);
    }

    if (docs.length === 1) {
      const msg = crearPeriodo
        ? 'Finiquito guardado e inyectado al período de nómina.'
        : 'Finiquito calculado. Sin período no se puede timbrar.';
      return flashRedirect(req, res, `/nomina/finiquitos/${docs[0]._id}`, 'success', msg);
    }

    const msg = crearPeriodo
      ? `${docs.length} finiquitos guardados e inyectados al mismo período de nómina.`
      : `${docs.length} finiquitos calculados sin período (timbrar requiere emitir período).`;
    return flashRedirect(req, res, '/nomina/finiquitos', 'success', msg);
  } catch (err) {
    return flashRedirect(req, res, '/nomina/finiquitos/nuevo', 'error', err.message);
  }
}

async function emitirPeriodo(req, res) {
  if (!canEdit(req.session)) {
    return flashRedirect(req, res, '/nomina/finiquitos', 'error', 'Sin permiso');
  }
  try {
    const omitirDispersion = !parseCheckbox(req.body, 'habilitarDispersionBancaria');
    const emit = await finiquitoService.emitirAPeriodoNomina(req.params.id, {
      tenantId: req.session.tenantId,
      user: { id: req.session.userid || '', label: req.session.user || '' },
      omitirDispersionBancaria: omitirDispersion
    });
    const msg = emit.periodoCreado
      ? `Período ${emit.periodo.tipoNomina} #${emit.periodo.numeroPeriodo}/${emit.periodo.anio} creado. Ya puedes cerrarlo como nómina.`
      : `Recibo actualizado en período #${emit.periodo.numeroPeriodo}/${emit.periodo.anio}.`;
    return flashRedirect(req, res, `/nomina/finiquitos/${req.params.id}`, 'success', msg);
  } catch (err) {
    return flashRedirect(req, res, `/nomina/finiquitos/${req.params.id}`, 'error', err.message);
  }
}

async function editForm(req, res) {
  if (!canEdit(req.session)) {
    return flashRedirect(req, res, '/nomina/finiquitos', 'error', 'Sin permiso');
  }
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const doc = await finiquitoService.obtener(req.session.tenantId, req.params.id);
  if (!doc) return flashRedirect(req, res, '/nomina/finiquitos', 'error', 'No encontrado');

  const bloqueo = await finiquitoService.resolverBloqueoEdicion(doc, req.session.tenantId);
  if (!bloqueo.puedeRecalcular) {
    return flashRedirect(
      req,
      res,
      `/nomina/finiquitos/${doc._id}`,
      'error',
      `Cálculo permanente (${bloqueo.motivo}). No se puede recalcular.`
    );
  }

  const p = doc.parametros || {};
  const n = doc.negociacion || {};
  res.render('Nomina/finiquitos/editar', {
    session: req.session,
    empresa,
    error,
    doc,
    periodo: bloqueo.periodo,
    causas: CAUSAS_TERMINACION,
    defaults: DEFAULTS_FINIQUITO,
    form: {
      fechaBaja: toDateInputValue(doc.fechaBaja),
      fechaIngreso: toDateInputValue(doc.fechaIngreso),
      causaTerminacion: doc.causaTerminacion,
      salarioDiario: p.salarioDiario ?? '',
      salarioBaseIndemnizacion: p.salarioBaseIndemnizacion ?? '',
      salarioBasePrimaAntiguedad: p.salarioBasePrimaAntiguedad ?? '',
      diasAguinaldo: p.diasAguinaldo ?? DEFAULTS_FINIQUITO.diasAguinaldo,
      porcentajePrimaVacacional: p.porcentajePrimaVacacional ?? DEFAULTS_FINIQUITO.porcentajePrimaVacacional,
      diasVacacionesPendientes: p.diasVacacionesPendientes ?? 0,
      diasPendientes: p.diasPendientes ?? 0,
      fondoAhorroSaldo: p.fondoAhorroSaldo ?? '',
      descuentoEmpresa: p.descuentoEmpresa ?? p.prestamoSaldo ?? '',
      aplicaIndemnizacionTresMeses: !!p.aplicaIndemnizacionTresMeses,
      aplica20DiasPorAnio: !!p.aplica20DiasPorAnio,
      aplicaPrimaAntiguedad: p.aplicaPrimaAntiguedad === true,
      negociacionActiva: !!n.activa,
      gratificacion: n.gratificacion ?? 0,
      gratificacionEsSeparacion: !!n.gratificacionEsSeparacion,
      negociacionNotas: n.notas || '',
      notas: doc.notas || ''
    },
    money,
    toDateInputValue,
    canEdit: true
  });
}

async function recalcularAction(req, res) {
  if (!canEdit(req.session)) {
    return flashRedirect(req, res, '/nomina/finiquitos', 'error', 'Sin permiso');
  }
  try {
    const result = await finiquitoService.recalcular(req.params.id, {
      tenantId: req.session.tenantId,
      fechaBaja: parseDate(req.body.fechaBaja) || undefined,
      causaTerminacion: String(req.body.causaTerminacion || '').toUpperCase() || undefined,
      parametros: parseBodyParams(req.body),
      negociacion: parseNegociacion(req.body),
      notas: String(req.body.notas || '').trim(),
      user: { id: req.session.userid || '', label: req.session.user || '' },
      reinjectarPeriodo: true
    });
    const msg = result.emit
      ? 'Recálculo aplicado; el recibo del período quedó actualizado.'
      : 'Recálculo aplicado. Puedes vincular al período cuando esté listo.';
    return flashRedirect(req, res, `/nomina/finiquitos/${req.params.id}`, 'success', msg);
  } catch (err) {
    return flashRedirect(req, res, `/nomina/finiquitos/${req.params.id}/editar`, 'error', err.message);
  }
}

async function eliminarAction(req, res) {
  if (!canEdit(req.session)) {
    return flashRedirect(req, res, '/nomina/finiquitos', 'error', 'Sin permiso');
  }
  try {
    const result = await finiquitoService.eliminarCalculo(req.params.id, {
      tenantId: req.session.tenantId,
      user: { id: req.session.userid || '', label: req.session.user || '' }
    });
    const msg = result.teniaPeriodo
      ? `Cálculo ${result.numEmpleado} eliminado y recibo quitado del período.`
      : `Cálculo ${result.numEmpleado} eliminado.`;
    return flashRedirect(req, res, '/nomina/finiquitos', 'success', msg);
  } catch (err) {
    return flashRedirect(req, res, `/nomina/finiquitos/${req.params.id}`, 'error', err.message);
  }
}

async function show(req, res) {
  if (!canView(req.session)) {
    return flashRedirect(req, res, '/', 'error', 'Sin permiso');
  }
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  const doc = await finiquitoService.obtener(req.session.tenantId, req.params.id);
  if (!doc) return flashRedirect(req, res, '/nomina/finiquitos', 'error', 'No encontrado');

  const bloqueo = await finiquitoService.resolverBloqueoEdicion(doc, req.session.tenantId);
  const periodo = bloqueo.periodo;

  res.render('Nomina/finiquitos/show', {
    session: req.session,
    empresa,
    doc,
    periodo,
    bloqueo,
    causas: CAUSAS_TERMINACION,
    conceptosCat: CONCEPTOS_FINIQUITO,
    estatusLabels: Object.fromEntries(ESTATUS_FINIQUITO.map((e) => [e.value, e.label])),
    money,
    canEdit: canEdit(req.session)
  });
}

module.exports = {
  list,
  newForm,
  preview,
  create,
  show,
  editForm,
  recalcularAction,
  eliminarAction,
  emitirPeriodo
};

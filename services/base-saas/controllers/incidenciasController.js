const getIncidenciaModel = require('../models/incidencia');
const getEmpleadoModel = require('../models/empleado');
const getTipoIncidenciaModel = require('../models/tipoIncidencia');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { ensureTiposIncidenciaForTenant, listAllTiposForTenant } = require('../services/tiposIncidenciaService');
const { recalcularSaldoEmpleado, calcularDiasSolicitud } = require('../services/vacacionesService');
const { parseOptionalObjectId, trimString, parseDate, parseCheckbox } = require('../libs/formHelpers');
const { startOfDay, endOfDay, formatTimeHHMM } = require('../libs/timeHelpers');
const { toDateInputValue } = require('../libs/formHelpers');
const { ESTATUS_INCIDENCIA } = require('../config/incidenciasCatalog');
const { userIsSupervisorOrAdmin, getEquipoEmpleadoIds } = require('../libs/portalSession');
const { findOneByTenant, findOneDocByTenant } = require('../libs/tenantScope');

function defaultFechaQuery(req) {
  return trimString(req.query.fechaDesde) || new Date().toISOString().slice(0, 10);
}

async function listIncidencias(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const estatus = trimString(req.query.estatus) || 'todos';
  const fechaDesde = parseDate(req.query.fechaDesde) || startOfDay(new Date());
  const fechaHasta = parseDate(req.query.fechaHasta) || endOfDay(new Date());

  const Incidencia = await getIncidenciaModel();
  const Empleado = await getEmpleadoModel();

  const filter = {
    tenantId: req.session.tenantId,
    fechaInicio: { $gte: startOfDay(fechaDesde), $lte: endOfDay(fechaHasta) }
  };
  if (estatus !== 'todos') filter.estatus = estatus;

  const [incidencias, empleados, tipos] = empresa
    ? await Promise.all([
        Incidencia.find(filter).sort({ fechaInicio: -1, createdAt: -1 }).lean(),
        Empleado.find({ tenantId: req.session.tenantId }).sort({ lastName: 1 }).lean(),
        ensureTiposIncidenciaForTenant(req.session.tenantId, empresa._id)
      ])
    : [[], [], []];

  const empMap = new Map(empleados.map((e) => [String(e._id), `${e.firstName} ${e.lastName}`]));
  const tipoMap = new Map(tipos.map((t) => [t.clave, t.nombre]));

  res.render('Incidencias/index', {
    incidencias,
    empleados: empleados.filter((e) => e.estatus === 'activo'),
    tipos: tipos.filter((t) => !t.esAutomatica),
    empMap,
    tipoMap,
    estatus,
    estatusOptions: ESTATUS_INCIDENCIA,
    fechaDesde: toDateInputValue(fechaDesde),
    fechaHasta: toDateInputValue(fechaHasta),
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createIncidencia(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/incidencias');
    }

    const empleadoId = parseOptionalObjectId(req.body.empleadoId);
    const tipoId = parseOptionalObjectId(req.body.tipoIncidenciaId);
    const fechaInicio = parseDate(req.body.fechaInicio);
    const fechaFin = parseDate(req.body.fechaFin) || fechaInicio;

    if (!empleadoId || !tipoId || !fechaInicio) {
      req.flash('error', 'Empleado, tipo y fecha inicio son obligatorios');
      return res.redirect('/incidencias');
    }

    const TipoIncidencia = await getTipoIncidenciaModel();
    const tipo = await TipoIncidencia.findOne({ _id: tipoId, tenantId: req.session.tenantId }).lean();
    if (!tipo) {
      req.flash('error', 'Tipo de incidencia no válido');
      return res.redirect('/incidencias');
    }

    const Incidencia = await getIncidenciaModel();
    const estatus = tipo.requiereAprobacion ? 'pendiente' : 'aprobada';

    await Incidencia.create({
      tenantId: req.session.tenantId,
      empleadoId,
      tipoIncidenciaId: tipo._id,
      codigo: tipo.clave,
      fechaInicio: startOfDay(fechaInicio),
      fechaFin: startOfDay(fechaFin),
      diasAfectados: calcularDiasSolicitud(fechaInicio, fechaFin),
      motivo: trimString(req.body.motivo),
      documentoReferencia: trimString(req.body.documentoReferencia),
      origen: 'manual_rrhh',
      estatus,
      solicitadoPorUserId: req.session.userid || '',
      fechaResolucion: estatus === 'aprobada' ? new Date() : undefined,
      resueltoPorUserId: estatus === 'aprobada' ? req.session.userid || '' : ''
    });

    if (tipo.clave === 'VAC' && estatus === 'aprobada') {
      await recalcularSaldoEmpleado(req.session.tenantId, empleadoId);
    }

    req.flash('success', 'Incidencia registrada');
    res.redirect('/incidencias');
  } catch (err) {
    console.error('[incidencias]', err);
    req.flash('error', 'Error al registrar incidencia');
    res.redirect('/incidencias');
  }
}

async function listPendientes(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Incidencia = await getIncidenciaModel();
  const Empleado = await getEmpleadoModel();
  const { startOfDay, endOfDay } = require('../libs/timeHelpers');
  const { parseOptionalObjectId, trimString } = require('../libs/formHelpers');

  let empleadoFilter = {};
  if (!userIsSupervisorOrAdmin(req) && req.session.empleadoId) {
    const equipoIds = await getEquipoEmpleadoIds(req.session.tenantId, req.session.empleadoId);
    empleadoFilter = { empleadoId: { $in: equipoIds } };
  }

  const periodoId = parseOptionalObjectId(req.query.periodoId);
  let periodoNomina = null;
  let rangoFiltro = null;
  if (periodoId && empresa) {
    const getPeriodoNominaModel = require('../models/periodoNomina');
    const PeriodoNomina = await getPeriodoNominaModel();
    periodoNomina = await PeriodoNomina.findOne({
      _id: periodoId,
      tenantId: req.session.tenantId,
      empresaId: empresa._id
    }).lean();
    if (periodoNomina) {
      rangoFiltro = {
        fechaInicio: { $lte: endOfDay(periodoNomina.fechaFin) },
        fechaFin: { $gte: startOfDay(periodoNomina.fechaInicio) }
      };
    }
  }

  const incidencias = empresa
    ? await Incidencia.find({
        tenantId: req.session.tenantId,
        estatus: 'pendiente',
        ...empleadoFilter,
        ...(rangoFiltro || {})
      })
        .sort({ fechaInicio: 1 })
        .lean()
    : [];

  const empleados = empresa
    ? await Empleado.find({ tenantId: req.session.tenantId }).lean()
    : [];
  const empMap = new Map(empleados.map((e) => [String(e._id), `${e.firstName} ${e.lastName}`]));

  const porCodigo = {};
  for (const i of incidencias) {
    const k = i.codigo || '?';
    porCodigo[k] = (porCodigo[k] || 0) + 1;
  }

  res.render('Incidencias/pendientes', {
    incidencias,
    empMap,
    periodoNomina,
    porCodigo,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function resolverIncidencia(req, res, estatus) {
  try {
    const Incidencia = await getIncidenciaModel();
    const incidencia = await Incidencia.findOne({
      _id: req.params.id,
      tenantId: req.session.tenantId,
      estatus: 'pendiente'
    });
    if (!incidencia) {
      req.flash('error', 'Incidencia no encontrada o ya resuelta');
      return res.redirect('/incidencias/pendientes');
    }

    incidencia.estatus = estatus;
    incidencia.notasResolucion = trimString(req.body.notasResolucion);
    incidencia.resueltoPorUserId = req.session.userid || '';
    incidencia.fechaResolucion = new Date();
    await incidencia.save();

    if (incidencia.codigo === 'VAC' && estatus === 'aprobada') {
      await recalcularSaldoEmpleado(req.session.tenantId, incidencia.empleadoId);
    }

    req.flash('success', estatus === 'aprobada' ? 'Incidencia aprobada' : 'Incidencia rechazada');
    res.redirect('/incidencias/pendientes');
  } catch (err) {
    console.error('[incidencias]', err);
    req.flash('error', 'Error al resolver incidencia');
    res.redirect('/incidencias/pendientes');
  }
}

async function aprobarIncidencia(req, res) {
  return resolverIncidencia(req, res, 'aprobada');
}

async function rechazarIncidencia(req, res) {
  return resolverIncidencia(req, res, 'rechazada');
}

async function aprobarMasivo(req, res) {
  return resolverMasivo(req, res, 'aprobada');
}

async function rechazarMasivo(req, res) {
  return resolverMasivo(req, res, 'rechazada');
}

async function resolverMasivo(req, res, estatus) {
  const esAprobar = estatus === 'aprobada';
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : req.body.ids ? [req.body.ids] : [];
    if (!ids.length) {
      req.flash('error', 'Selecciona al menos una incidencia');
      return res.redirect('/incidencias/pendientes');
    }

    const Incidencia = await getIncidenciaModel();
    const incidencias = await Incidencia.find({
      _id: { $in: ids },
      tenantId: req.session.tenantId,
      estatus: 'pendiente'
    });

    const notaDefault = esAprobar ? 'Aprobación masiva' : 'Rechazo masivo';
    for (const inc of incidencias) {
      inc.estatus = estatus;
      inc.resueltoPorUserId = req.session.userid || '';
      inc.fechaResolucion = new Date();
      inc.notasResolucion = trimString(req.body.notasResolucion) || notaDefault;
      await inc.save();
      if (esAprobar && inc.codigo === 'VAC') {
        await recalcularSaldoEmpleado(req.session.tenantId, inc.empleadoId);
      }
    }

    req.flash(
      'success',
      esAprobar
        ? `${incidencias.length} incidencia(s) aprobadas`
        : `${incidencias.length} incidencia(s) rechazadas`
    );
    res.redirect('/incidencias/pendientes');
  } catch (err) {
    console.error('[incidencias]', err);
    req.flash('error', esAprobar ? 'Error en aprobación masiva' : 'Error en rechazo masivo');
    res.redirect('/incidencias/pendientes');
  }
}

async function listTipos(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const tipos = empresa ? await listAllTiposForTenant(req.session.tenantId, empresa._id) : [];
  res.render('Incidencias/tipos', { tipos, empresa, error: error || null, session: req.session });
}

function buildTipoPayload(body, tenantId, empresaId) {
  return {
    tenantId,
    empresaId,
    clave: trimString(body.clave).toUpperCase(),
    nombre: trimString(body.nombre),
    afectaPago: parseCheckbox(body, 'afectaPago'),
    requiereAprobacion: parseCheckbox(body, 'requiereAprobacion'),
    requiereDocumento: parseCheckbox(body, 'requiereDocumento'),
    esAutomatica: parseCheckbox(body, 'esAutomatica'),
    activo: true
  };
}

async function createTipo(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/incidencias/tipos');
    }

    const payload = buildTipoPayload(req.body, req.session.tenantId, empresa._id);
    if (!payload.clave || !payload.nombre) {
      req.flash('error', 'Clave y nombre son obligatorios');
      return res.redirect('/incidencias/tipos');
    }

    const TipoIncidencia = await getTipoIncidenciaModel();
    await TipoIncidencia.create(payload);
    req.flash('success', 'Tipo de incidencia creado');
    res.redirect('/incidencias/tipos');
  } catch (err) {
    console.error('[incidencias/tipos]', err);
    req.flash('error', err.code === 11000 ? 'Ya existe un tipo con esa clave' : 'Error al crear tipo');
    res.redirect('/incidencias/tipos');
  }
}

async function editTipo(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const TipoIncidencia = await getTipoIncidenciaModel();
  const tipo = await findOneByTenant(TipoIncidencia, req.session.tenantId, req.params.id);
  if (!tipo) return res.status(404).send('Tipo no encontrado');

  res.render('Incidencias/tipo-edit', { tipo, empresa, error: error || null, session: req.session });
}

async function updateTipo(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/incidencias/tipos');
    }

    const TipoIncidencia = await getTipoIncidenciaModel();
    const tipo = await findOneDocByTenant(TipoIncidencia, req.session.tenantId, req.params.id);
    if (!tipo) return res.status(404).send('Tipo no encontrado');

    tipo.nombre = trimString(req.body.nombre);
    tipo.afectaPago = parseCheckbox(req.body, 'afectaPago');
    tipo.requiereAprobacion = parseCheckbox(req.body, 'requiereAprobacion');
    tipo.requiereDocumento = parseCheckbox(req.body, 'requiereDocumento');
    tipo.esAutomatica = parseCheckbox(req.body, 'esAutomatica');
    await tipo.save();

    req.flash('success', 'Tipo actualizado');
    res.redirect('/incidencias/tipos');
  } catch (err) {
    console.error('[incidencias/tipos]', err);
    req.flash('error', 'Error al actualizar tipo');
    res.redirect(`/incidencias/tipos/${req.params.id}/edit`);
  }
}

async function toggleTipo(req, res) {
  const TipoIncidencia = await getTipoIncidenciaModel();
  const tipo = await findOneDocByTenant(TipoIncidencia, req.session.tenantId, req.params.id);
  if (!tipo) return res.status(404).send('Tipo no encontrado');

  tipo.activo = !tipo.activo;
  await tipo.save();
  req.flash('success', tipo.activo ? 'Tipo activado' : 'Tipo desactivado');
  res.redirect('/incidencias/tipos');
}

module.exports = {
  listIncidencias,
  createIncidencia,
  listPendientes,
  aprobarIncidencia,
  rechazarIncidencia,
  aprobarMasivo,
  rechazarMasivo,
  listTipos,
  createTipo,
  editTipo,
  updateTipo,
  toggleTipo
};

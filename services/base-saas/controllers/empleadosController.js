const getEmpleadoModel = require('../models/empleado');
const getDepartamentoModel = require('../models/departamento');
const getPuestoModel = require('../models/puesto');
const getSubsidiariaModel = require('../models/subsidiaria');
const getTurnoModel = require('../models/turno');
const getGrupoDispositivosModel = require('../models/grupoDispositivos');
const {
  requireEmpresaForTenant,
  findOneByTenant,
  findOneDocByTenant
} = require('../libs/tenantScope');
const { buildEmpleadoPayload } = require('../libs/empleadoPayload');
const { toDateInputValue } = require('../libs/formHelpers');
const { tenantHasFeature } = require('../libs/tenantFeatureFlags');
const { TIPOS_CREDITO_INFONAVIT } = require('../config/nominaCatalogos');
const { MOTIVOS_BAJA, TIPOS_CONTRATO, TIPOS_EMPLEADO, ESTATUS_EMPLEADO, TIPOS_REGISTRO } = require('../config/catalogos');
const { getEnumItems, ensureSystemEnums } = require('../services/nomina/systemEnumService');

function enumOptionsOrFallback(items, fallback) {
  if (items && items.length) {
    return items.map((i) => ({ value: i.value, label: i.label || i.value }));
  }
  return fallback;
}

function labelFromOptions(options, value) {
  if (!value) return '—';
  const found = (options || []).find((o) => o.value === value);
  return found ? found.label : value;
}
const {
  syncAsignacionFromBody,
  loadPlantillasActivas,
  loadAsignacionEmpleado
} = require('../services/asignacionPlantillaService');
const { resolveTurnoVigente } = require('../services/turnoResolverService');
const {
  registrarAlta,
  registrarCambioAutomatico,
  listHistorialEmpleado
} = require('../services/historialLaboralService');
const getTipoMovimientoLaboralModel = require('../models/tipoMovimientoLaboral');
const {
  listTiposPeriodo,
  ensureTiposPeriodoForTenant
} = require('../services/tipoPeriodoNominaService');

async function loadEmpleadoEnums() {
  await ensureSystemEnums();
  const [tipoContratoItems, tipoEmpleadoItems] = await Promise.all([
    getEnumItems('tipo_contrato'),
    getEnumItems('tipo_empleado')
  ]);
  return {
    tiposContrato: enumOptionsOrFallback(tipoContratoItems, TIPOS_CONTRATO),
    tiposEmpleado: enumOptionsOrFallback(tipoEmpleadoItems, TIPOS_EMPLEADO)
  };
}

function showNominaConfig(req) {
  const flags = req.tenant?.featureFlags || req.session?.featureFlags || {};
  return tenantHasFeature(flags, 'nomina');
}

function labelTipoCreditoInfonavit(value) {
  return TIPOS_CREDITO_INFONAVIT.find((t) => t.value === value)?.label || '—';
}

async function loadEmpleadoCatalogs(tenantId, empresa) {
  if (!empresa) {
    return {
      empleados: [],
      departamentos: [],
      puestos: [],
      subsidiarias: [],
      supervisores: [],
      turnos: [],
      gruposDispositivos: [],
      plantillas: [],
      tiposPeriodo: []
    };
  }

  await ensureTiposPeriodoForTenant(tenantId, empresa._id);

  const Empleado = await getEmpleadoModel();
  const Departamento = await getDepartamentoModel();
  const Puesto = await getPuestoModel();
  const Subsidiaria = await getSubsidiariaModel();
  const Turno = await getTurnoModel();
  const GrupoDispositivos = await getGrupoDispositivosModel();
  const [empleados, departamentos, puestos, subsidiarias, turnos, gruposDispositivos, plantillas, tiposPeriodo] =
    await Promise.all([
    Empleado.find({ tenantId }).sort({ lastName: 1, firstName: 1 }).lean(),
    Departamento.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    Puesto.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean(),
    Turno.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    GrupoDispositivos.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    loadPlantillasActivas(tenantId),
    listTiposPeriodo(tenantId, true)
  ]);

  const supervisores = empleados.filter((e) => e.estatus === 'activo');

  return {
    empleados,
    departamentos,
    puestos,
    subsidiarias,
    supervisores,
    turnos,
    gruposDispositivos,
    plantillas,
    tiposPeriodo
  };
}

function buildLookupMaps(departamentos, puestos, subsidiarias, empleados) {
  return {
    deptMap: new Map(departamentos.map((d) => [String(d._id), d.nombre])),
    puestoMap: new Map(puestos.map((p) => [String(p._id), p.nombre])),
    subMap: new Map(subsidiarias.map((s) => [String(s._id), s.nombre])),
    supervisorMap: new Map(
      empleados.map((e) => [String(e._id), `${e.firstName} ${e.lastName}`.trim()])
    )
  };
}

async function loadCatalogMaps(tenantId, empresaId) {
  const Departamento = await getDepartamentoModel();
  const Puesto = await getPuestoModel();
  const Subsidiaria = await getSubsidiariaModel();
  const Empleado = await getEmpleadoModel();
  const Turno = await getTurnoModel();

  const [departamentos, puestos, subsidiarias, empleados, turnos, tiposPeriodo] = await Promise.all([
    Departamento.find({ tenantId }).lean(),
    Puesto.find({ tenantId }).lean(),
    empresaId ? Subsidiaria.find({ empresaId }).lean() : [],
    Empleado.find({ tenantId }).lean(),
    Turno.find({ tenantId }).lean(),
    listTiposPeriodo(tenantId, false)
  ]);

  const maps = buildLookupMaps(departamentos, puestos, subsidiarias, empleados);
  maps.turnoMap = new Map(turnos.map((t) => [String(t._id), t.nombre]));
  maps.tipoPeriodoMap = new Map(
    tiposPeriodo.map((t) => [
      String(t._id),
      `${t.nombre} (${t.tipoMotor}${t.codigoLegado != null ? ` · ${t.codigoLegado}` : ''})`
    ])
  );
  return maps;
}

async function listEmpleados(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const estatus = String(req.query.estatus || 'activo').trim();
  const Empleado = await getEmpleadoModel();
  const catalogs = await loadEmpleadoCatalogs(req.session.tenantId, empresa);

  let filter = { tenantId: req.session.tenantId };
  if (estatus !== 'todos') filter.estatus = estatus;

  const empleados = empresa
    ? await Empleado.find(filter).sort({ lastName: 1, firstName: 1 }).lean()
    : [];

  const maps = empresa
    ? await loadCatalogMaps(req.session.tenantId, empresa._id)
    : { ...buildLookupMaps([], [], [], []), turnoMap: new Map(), tipoPeriodoMap: new Map() };

  const enumsEmp = await loadEmpleadoEnums();

  res.render('Personal/empleados', {
    empleados,
    ...catalogs,
    ...maps,
    ...enumsEmp,
    empresa,
    estatus,
    estatusOptions: ESTATUS_EMPLEADO,
    tiposRegistro: TIPOS_REGISTRO,
    toDateInputValue,
    showNominaConfig: showNominaConfig(req),
    tiposCreditoInfonavit: TIPOS_CREDITO_INFONAVIT,
    error: error || null,
    session: req.session
  });
}

async function createEmpleado(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/personal-empleados');
    }

    const Empleado = await getEmpleadoModel();
    const payload = buildEmpleadoPayload(req.body, req.session.tenantId, empresa._id);
    const empleado = await Empleado.create(payload);
    await syncAsignacionFromBody(req.session.tenantId, empresa._id, empleado._id, req.body);
    await registrarAlta(req.session.tenantId, empresa._id, empleado.toObject(), {
      registradoPor: req.session.username || req.session.userName || ''
    });
    req.flash('success', 'Empleado creado');
    res.redirect('/personal-empleados');
  } catch (err) {
    console.error('[empleados]', err);
    req.flash('error', err.code === 11000 ? 'El número de empleado o código externo ya existe' : 'Error al crear empleado');
    res.redirect('/personal-empleados');
  }
}

async function showEmpleado(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Empleado = await getEmpleadoModel();
  const empleado = await findOneByTenant(Empleado, req.session.tenantId, req.params.id);
  if (!empleado) return res.status(404).send('Empleado no encontrado');

  const catalogs = await loadEmpleadoCatalogs(req.session.tenantId, empresa);
  const maps = empresa
    ? await loadCatalogMaps(req.session.tenantId, empresa._id)
    : { ...buildLookupMaps([], [], [], []), turnoMap: new Map(), tipoPeriodoMap: new Map() };

  let grupoNombre = '—';
  if (empleado.grupoDispositivosId && empresa) {
    const GrupoDispositivos = await getGrupoDispositivosModel();
    const grupo = await GrupoDispositivos.findOne({
      _id: empleado.grupoDispositivosId,
      tenantId: req.session.tenantId
    }).lean();
    if (grupo) grupoNombre = grupo.nombre;
  }

  const tipoRegistroLabel =
    TIPOS_REGISTRO.find((t) => t.value === empleado.tipoRegistro)?.label || empleado.tipoRegistro || '—';

  const asignacionCtx = await loadAsignacionEmpleado(req.session.tenantId, empleado._id);
  const turnoVigente = empresa
    ? await resolveTurnoVigente(req.session.tenantId, empleado, new Date())
    : null;
  const turnoVigenteLabel = turnoVigente?.esDescansoForzado
    ? 'Descanso'
    : turnoVigente?.turno
      ? maps.turnoMap.get(String(turnoVigente.turno._id)) || turnoVigente.turno.nombre
      : '—';

  const [historialReciente, tiposMov, enumsEmp] = await Promise.all([
    listHistorialEmpleado(req.session.tenantId, empleado._id, 5),
    getTipoMovimientoLaboralModel().then((M) => M.find({ tenantId: req.session.tenantId }).lean()),
    loadEmpleadoEnums()
  ]);
  const tipoMovMap = new Map(tiposMov.map((t) => [t.codigo, t.nombre]));

  res.render('Personal/empleado-show', {
    empleado,
    ...maps,
    ...enumsEmp,
    labelTipoContrato: labelFromOptions(enumsEmp.tiposContrato, empleado.tipoContrato),
    labelTipoEmpleado: labelFromOptions(enumsEmp.tiposEmpleado, empleado.tipoEmpleado),
    grupoNombre,
    tipoRegistroLabel,
    asignacionCtx,
    turnoVigenteLabel,
    turnoVigenteOrigen: turnoVigente?.origen || 'ninguno',
    historialReciente,
    tipoMovMap,
    empresa,
    showNominaConfig: showNominaConfig(req),
    labelTipoCreditoInfonavit,
    error: error || null,
    session: req.session,
    toDateInputValue
  });
}

async function editEmpleado(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Empleado = await getEmpleadoModel();
  const empleado = await findOneByTenant(Empleado, req.session.tenantId, req.params.id);
  if (!empleado) return res.status(404).send('Empleado no encontrado');

  const catalogs = await loadEmpleadoCatalogs(req.session.tenantId, empresa);
  catalogs.supervisores = catalogs.supervisores.filter((e) => String(e._id) !== String(empleado._id));
  const asignacionCtx = await loadAsignacionEmpleado(req.session.tenantId, empleado._id);
  const enumsEmp = await loadEmpleadoEnums();

  res.render('Personal/empleado-edit', {
    empleado,
    ...catalogs,
    ...enumsEmp,
    asignacionCtx,
    tiposRegistro: TIPOS_REGISTRO,
    empresa,
    motivosBaja: MOTIVOS_BAJA,
    tiposContrato: enumsEmp.tiposContrato,
    estatusOptions: ESTATUS_EMPLEADO,
    showNominaConfig: showNominaConfig(req),
    tiposCreditoInfonavit: TIPOS_CREDITO_INFONAVIT,
    error: error || null,
    session: req.session,
    toDateInputValue
  });
}

async function updateEmpleado(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/personal-empleados');
    }

    const Empleado = await getEmpleadoModel();
    const empleado = await findOneDocByTenant(Empleado, req.session.tenantId, req.params.id);
    if (!empleado) return res.status(404).send('Empleado no encontrado');

    const supervisorId = req.body.supervisorId || null;
    if (supervisorId && String(supervisorId) === String(empleado._id)) {
      req.flash('error', 'Un empleado no puede ser su propio supervisor');
      return res.redirect(`/personal-empleados/${empleado._id}/edit`);
    }

    const antes = empleado.toObject();
    const payload = buildEmpleadoPayload(req.body, req.session.tenantId, empresa._id);
    Object.assign(empleado, payload);
    await empleado.save();
    await syncAsignacionFromBody(req.session.tenantId, empresa._id, empleado._id, req.body);
    await registrarCambioAutomatico(req.session.tenantId, empresa._id, antes, empleado.toObject(), {
      registradoPor: req.session.username || req.session.userName || ''
    });

    req.flash('success', 'Empleado actualizado');
    res.redirect(`/personal-empleados/${empleado._id}`);
  } catch (err) {
    console.error('[empleados]', err);
    req.flash('error', err.code === 11000 ? 'El número de empleado o código externo ya existe' : 'Error al actualizar empleado');
    res.redirect(`/personal-empleados/${req.params.id}/edit`);
  }
}

async function bajaEmpleado(req, res) {
  try {
    const Empleado = await getEmpleadoModel();
    const empleado = await findOneDocByTenant(Empleado, req.session.tenantId, req.params.id);
    if (!empleado) return res.status(404).send('Empleado no encontrado');

    const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
    const antes = empleado.toObject();
    empleado.estatus = 'baja';
    empleado.activo = false;
    empleado.fechaBaja = new Date();
    empleado.motivoBaja = String(req.body.motivoBaja || '').trim() || 'Baja registrada';
    await empleado.save();
    if (empresa) {
      await registrarCambioAutomatico(req.session.tenantId, empresa._id, antes, empleado.toObject(), {
        observaciones: empleado.motivoBaja,
        registradoPor: req.session.username || req.session.userName || ''
      });
    }

    req.flash('success', 'Empleado dado de baja');
    res.redirect('/personal-empleados?estatus=baja');
  } catch (err) {
    console.error('[empleados]', err);
    req.flash('error', 'Error al registrar la baja');
    res.redirect(`/personal-empleados/${req.params.id}`);
  }
}

async function reactivarEmpleado(req, res) {
  try {
    const Empleado = await getEmpleadoModel();
    const empleado = await findOneDocByTenant(Empleado, req.session.tenantId, req.params.id);
    if (!empleado) return res.status(404).send('Empleado no encontrado');

    const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
    const antes = empleado.toObject();
    empleado.estatus = 'activo';
    empleado.activo = true;
    empleado.fechaBaja = null;
    empleado.motivoBaja = '';
    await empleado.save();
    if (empresa) {
      await registrarCambioAutomatico(req.session.tenantId, empresa._id, antes, empleado.toObject(), {
        observaciones: 'Reactivación de empleado',
        registradoPor: req.session.username || req.session.userName || ''
      });
    }

    req.flash('success', 'Empleado reactivado');
    res.redirect(`/personal-empleados/${empleado._id}`);
  } catch (err) {
    console.error('[empleados]', err);
    req.flash('error', 'Error al reactivar empleado');
    res.redirect(`/personal-empleados/${req.params.id}`);
  }
}

module.exports = {
  listEmpleados,
  createEmpleado,
  showEmpleado,
  editEmpleado,
  updateEmpleado,
  bajaEmpleado,
  reactivarEmpleado
};

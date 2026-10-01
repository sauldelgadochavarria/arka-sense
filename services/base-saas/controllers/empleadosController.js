const getEmpleadoModel = require('../models/empleado');
const getDepartamentoModel = require('../models/departamento');
const getPuestoModel = require('../models/puesto');
const getSubsidiariaModel = require('../models/subsidiaria');
const getTurnoModel = require('../models/turno');
const getGrupoDispositivosModel = require('../models/grupoDispositivos');
const getCentroCostoModel = require('../models/centroCosto');
const {
  requireEmpresaForTenant,
  findOneByTenant,
  findOneDocByTenant
} = require('../libs/tenantScope');
const { buildEmpleadoPayload } = require('../libs/empleadoPayload');
const { validateEmpleadoImssIsn, labelEntidadFederativa } = require('../libs/empleadoImssIsnValidation');
const { toDateInputValue } = require('../libs/formHelpers');
const { tenantHasFeature } = require('../libs/tenantFeatureFlags');
const {
  TIPOS_CREDITO_INFONAVIT,
  TIPOS_CREDITO_FONACOT,
  TIPOS_CUOTA_SINDICAL,
  CUOTA_SINDICAL_TOPE30_OPTS,
  CUOTA_SINDICAL_BASE_OPTS
} = require('../config/nominaCatalogos');
const { MOTIVOS_BAJA, TIPOS_CONTRATO, TIPOS_EMPLEADO, ESTATUS_EMPLEADO, TIPOS_REGISTRO } = require('../config/catalogos');
const { POLITICAS_MARCAJE_GEO } = require('../config/asistencia');
const {
  ENTIDADES_FEDERATIVAS,
  ESTADOS_CIVILES,
  TIPOS_BASE_COTIZACION
} = require('../config/empleadoCatalogos');
const { resolverBaseImss } = require('../libs/sdiHelpers');
const { getEnumItems, ensureSystemEnums } = require('../services/nomina/systemEnumService');

async function loadUmaVigente(tenantId) {
  try {
    const { obtenerParametrosVigentes } = require('../services/nomina/tablasFiscalesService');
    const p = await obtenerParametrosVigentes(tenantId, new Date());
    return Number(p?.uma) || 0;
  } catch {
    return 0;
  }
}

function empleadoFormExtras(umaVigente = 0) {
  return {
    entidadesFederativas: ENTIDADES_FEDERATIVAS,
    estadosCiviles: ESTADOS_CIVILES,
    tiposBaseCotizacion: TIPOS_BASE_COTIZACION,
    umaVigente
  };
}

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
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getReciboNominaModel = require('../models/reciboNomina');
const getPeriodoNominaModel = require('../models/periodoNomina');
const {
  listTiposPeriodo,
  ensureTiposPeriodoForTenant
} = require('../services/tipoPeriodoNominaService');

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function labelPeriodoNomina(p = {}) {
  const tipo = p.tipoPeriodo || '';
  const num = p.numeroPeriodo != null ? `#${p.numeroPeriodo}` : '';
  const anio = p.anio != null ? `/${p.anio}` : '';
  return `${tipo} ${num}${anio}`.trim() || '—';
}

/**
 * Historial de nóminas del empleado (histórico + recibos de períodos abiertos).
 */
async function listHistorialNominasEmpleado(tenantId, empleadoId, { limit = 60 } = {}) {
  const Historico = await getNominaHistoricoReciboModel();
  const Recibo = await getReciboNominaModel();
  const Periodo = await getPeriodoNominaModel();

  const [historicos, recibosAbiertos] = await Promise.all([
    Historico.find({ tenantId, empleadoId })
      .select(
        '_id periodoId origen anio mes periodo fechaCierre totalPercepciones totalDeducciones netoPagar'
      )
      .sort({ 'periodo.fechaFin': -1, fechaCierre: -1, anio: -1, mes: -1 })
      .limit(limit)
      .lean(),
    Recibo.find({ tenantId, empleadoId })
      .select('_id periodoId totalPercepciones totalDeducciones netoPagar updatedAt')
      .sort({ updatedAt: -1 })
      .limit(40)
      .lean()
  ]);

  const periodoIdsAbiertos = [
    ...new Set(recibosAbiertos.map((r) => String(r.periodoId || '')).filter(Boolean))
  ];
  const periodosAbiertos = periodoIdsAbiertos.length
    ? await Periodo.find({
        _id: { $in: periodoIdsAbiertos },
        estatus: { $ne: 'cerrado' }
      })
        .select('_id tipoPeriodo tipoNomina numeroPeriodo anio fechaInicio fechaFin estatus')
        .lean()
    : [];
  const perAbiertoById = new Map(periodosAbiertos.map((p) => [String(p._id), p]));

  const rows = [];
  const histPeriodoIds = new Set(
    historicos.map((h) => (h.periodoId ? String(h.periodoId) : '')).filter(Boolean)
  );

  for (const h of historicos) {
    const p = h.periodo || {};
    const fecha =
      p.fechaFin || p.fechaInicio || h.fechaCierre || (h.anio && h.mes ? new Date(h.anio, h.mes - 1, 1) : null);
    rows.push({
      periodoLabel: labelPeriodoNomina({
        tipoPeriodo: p.tipoPeriodo,
        numeroPeriodo: p.numeroPeriodo,
        anio: h.anio
      }),
      tipo: p.tipoNomina || (h.origen === 'importacion' ? 'importacion' : 'ordinaria'),
      fecha,
      fechaInicio: p.fechaInicio || null,
      fechaFin: p.fechaFin || null,
      subtotal: money(h.totalPercepciones),
      descuentos: money(h.totalDeducciones),
      neto: money(h.netoPagar),
      origen: h.origen || 'cierre',
      detalleUrl:
        h.periodoId && h._id
          ? `/nomina/periodos/${h.periodoId}/recibos/${h._id}`
          : null
    });
  }

  for (const r of recibosAbiertos) {
    const pid = r.periodoId ? String(r.periodoId) : '';
    if (!pid || histPeriodoIds.has(pid)) continue;
    const p = perAbiertoById.get(pid);
    if (!p) continue;
    rows.push({
      periodoLabel: labelPeriodoNomina({
        tipoPeriodo: p.tipoPeriodo,
        numeroPeriodo: p.numeroPeriodo,
        anio: p.anio
      }),
      tipo: p.tipoNomina || 'ordinaria',
      fecha: p.fechaFin || p.fechaInicio || r.updatedAt,
      fechaInicio: p.fechaInicio || null,
      fechaFin: p.fechaFin || null,
      subtotal: money(r.totalPercepciones),
      descuentos: money(r.totalDeducciones),
      neto: money(r.netoPagar),
      origen: 'abierto',
      detalleUrl: `/nomina/periodos/${p._id}/recibos/${r._id}`
    });
  }

  rows.sort((a, b) => {
    const ta = a.fecha ? new Date(a.fecha).getTime() : 0;
    const tb = b.fecha ? new Date(b.fecha).getTime() : 0;
    return tb - ta;
  });

  return rows.slice(0, limit);
}

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
      puntosAcceso: [],
      plantillas: [],
      tiposPeriodo: [],
      tablasPrestaciones: [],
      centrosCosto: []
    };
  }

  await ensureTiposPeriodoForTenant(tenantId, empresa._id);

  const Empleado = await getEmpleadoModel();
  const Departamento = await getDepartamentoModel();
  const Puesto = await getPuestoModel();
  const Subsidiaria = await getSubsidiariaModel();
  const Turno = await getTurnoModel();
  const GrupoDispositivos = await getGrupoDispositivosModel();
  const getPuntoAccesoModel = require('../models/puntoAcceso');
  const PuntoAcceso = await getPuntoAccesoModel();
  const getTablaPrestacionesModel = require('../models/tablaPrestaciones');
  const TablaPrestaciones = await getTablaPrestacionesModel();
  const CentroCosto = await getCentroCostoModel();
  const empresaScope = { tenantId, empresaId: empresa._id };
  const [empleados, departamentos, puestos, subsidiarias, turnos, gruposDispositivos, puntosAcceso, plantillas, tiposPeriodo, tablasPrestaciones, centrosCosto] =
    await Promise.all([
    Empleado.find(empresaScope).sort({ lastName: 1, firstName: 1 }).lean(),
    Departamento.find({ ...empresaScope, activo: true }).sort({ nombre: 1 }).lean(),
    Puesto.find({ ...empresaScope, activo: true }).sort({ nombre: 1 }).lean(),
    Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean(),
    Turno.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    GrupoDispositivos.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    PuntoAcceso.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    loadPlantillasActivas(tenantId),
    listTiposPeriodo(tenantId, true, empresa._id),
    // Prestaciones: catálogo global del tenant (compartido entre empresas)
    TablaPrestaciones.find({ tenantId, activo: true })
      .sort({ ambito: 1, nombre: 1 })
      .lean(),
    CentroCosto.find({ ...empresaScope, activo: true }).sort({ codigo: 1 }).lean()
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
    puntosAcceso,
    plantillas,
    tiposPeriodo,
    tablasPrestaciones,
    centrosCosto
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
    Departamento.find(empresaId ? { tenantId, empresaId } : { tenantId }).lean(),
    Puesto.find(empresaId ? { tenantId, empresaId } : { tenantId }).lean(),
    empresaId ? Subsidiaria.find({ empresaId }).lean() : [],
    Empleado.find(empresaId ? { tenantId, empresaId } : { tenantId }).lean(),
    Turno.find({ tenantId }).lean(),
    listTiposPeriodo(tenantId, false, empresaId || null)
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
  const { empresa, error } = await requireEmpresaForTenant(req);
  const estatus = String(req.query.estatus || 'activo').trim();
  const Empleado = await getEmpleadoModel();
  const catalogs = await loadEmpleadoCatalogs(req.session.tenantId, empresa);

  let filter = { tenantId: req.session.tenantId };
  if (empresa) filter.empresaId = empresa._id;
  const subId = req.session?.subsidiariaActiva?._id;
  if (subId) {
    filter.$or = [
      { subsidiariaId: subId },
      { subsidiariaId: null },
      { subsidiariaId: { $exists: false } }
    ];
  }
  if (estatus !== 'todos') filter.estatus = estatus;

  const empleados = empresa
    ? await Empleado.find(filter).sort({ lastName: 1, firstName: 1 }).lean()
    : [];

  const maps = empresa
    ? await loadCatalogMaps(req.session.tenantId, empresa._id)
    : { ...buildLookupMaps([], [], [], []), turnoMap: new Map(), tipoPeriodoMap: new Map() };

  const enumsEmp = await loadEmpleadoEnums();
  const umaVigente = await loadUmaVigente(req.session.tenantId);

  res.render('Personal/empleados', {
    empleados,
    ...catalogs,
    ...maps,
    ...enumsEmp,
    ...empleadoFormExtras(umaVigente),
    empresa,
    estatus,
    estatusOptions: ESTATUS_EMPLEADO,
    tiposRegistro: TIPOS_REGISTRO,
    politicasMarcajeGeo: POLITICAS_MARCAJE_GEO,
    toDateInputValue,
    showNominaConfig: showNominaConfig(req),
    tiposCreditoInfonavit: TIPOS_CREDITO_INFONAVIT,
    tiposCreditoFonacot: TIPOS_CREDITO_FONACOT,
    tiposCuotaSindical: TIPOS_CUOTA_SINDICAL,
    cuotaSindicalTope30Opts: CUOTA_SINDICAL_TOPE30_OPTS,
    cuotaSindicalBaseOpts: CUOTA_SINDICAL_BASE_OPTS,
    error: error || null,
    session: req.session
  });
}

async function createEmpleado(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error) {
      req.flash('error', error);
      return res.redirect('/personal-empleados');
    }

    const Empleado = await getEmpleadoModel();
    const payload = buildEmpleadoPayload(req.body, req.session.tenantId, empresa._id);
    const issues = validateEmpleadoImssIsn(payload, empresa);
    const empleado = await Empleado.create(payload);
    await syncAsignacionFromBody(req.session.tenantId, empresa._id, empleado._id, req.body);
    await registrarAlta(req.session.tenantId, empresa._id, empleado.toObject(), {
      registradoPor: req.session.username || req.session.userName || ''
    });
    if (issues.length) {
      req.flash(
        'error',
        `Empleado creado. Completa datos IMSS/ISN: ${issues.join('. ')}`
      );
    } else {
      req.flash('success', 'Empleado creado');
    }
    res.redirect(`/personal-empleados/${empleado._id}`);
  } catch (err) {
    console.error('[empleados]', err);
    req.flash('error', err.code === 11000 ? 'El número de empleado o código externo ya existe' : 'Error al crear empleado');
    res.redirect('/personal-empleados');
  }
}

async function showEmpleado(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
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

  const [historialReciente, tiposMov, enumsEmp, umaVigente, historialNominas] = await Promise.all([
    listHistorialEmpleado(req.session.tenantId, empleado._id, 5),
    getTipoMovimientoLaboralModel().then((M) => M.find({ tenantId: req.session.tenantId }).lean()),
    loadEmpleadoEnums(),
    loadUmaVigente(req.session.tenantId),
    listHistorialNominasEmpleado(req.session.tenantId, empleado._id, { limit: 48 })
  ]);
  const tipoMovMap = new Map(tiposMov.map((t) => [t.codigo, t.nombre]));
  const baseImss = resolverBaseImss(empleado, umaVigente, 25);
  const labelTipoSalario =
    TIPOS_BASE_COTIZACION.find((t) => t.value === (empleado.tipoSalario || 'fijo'))?.label ||
    empleado.tipoSalario ||
    '—';
  const labelEstadoCivil =
    ESTADOS_CIVILES.find((e) => e.value === empleado.estadoCivil)?.label || empleado.estadoCivil || '—';
  const labelEntidadNac =
    ENTIDADES_FEDERATIVAS.find((e) => e.value === empleado.entidadNacimiento)?.label ||
    empleado.entidadNacimiento ||
    '—';
  const labelEntidadDom = labelEntidadFederativa(empleado.domicilio?.entidad);

  let tablaPrestacionesResuelta = null;
  if (empresa) {
    try {
      const { resolverTablaPrestaciones } = require('../services/sdiCalculoService');
      tablaPrestacionesResuelta = await resolverTablaPrestaciones(
        req.session.tenantId,
        empresa._id,
        empleado
      );
    } catch (_) {
      /* opcional */
    }
  }

  res.render('Personal/empleado-show', {
    empleado,
    ...maps,
    ...enumsEmp,
    ...empleadoFormExtras(umaVigente),
    labelTipoContrato: labelFromOptions(enumsEmp.tiposContrato, empleado.tipoContrato),
    labelTipoEmpleado: labelFromOptions(enumsEmp.tiposEmpleado, empleado.tipoEmpleado),
    labelTipoSalario,
    labelEstadoCivil,
    labelEntidadNac,
    labelEntidadDom,
    baseImss,
    grupoNombre,
    tipoRegistroLabel,
    asignacionCtx,
    turnoVigenteLabel,
    turnoVigenteOrigen: turnoVigente?.origen || 'ninguno',
    historialReciente,
    historialNominas,
    tipoMovMap,
    tablaPrestacionesResuelta,
    empresa,
    showNominaConfig: showNominaConfig(req),
    labelTipoCreditoInfonavit,
    error: error || null,
    session: req.session,
    toDateInputValue
  });
}

async function editEmpleado(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const Empleado = await getEmpleadoModel();
  const empleado = await findOneByTenant(Empleado, req.session.tenantId, req.params.id);
  if (!empleado) return res.status(404).send('Empleado no encontrado');

  const catalogs = await loadEmpleadoCatalogs(req.session.tenantId, empresa);
  catalogs.supervisores = catalogs.supervisores.filter((e) => String(e._id) !== String(empleado._id));
  const asignacionCtx = await loadAsignacionEmpleado(req.session.tenantId, empleado._id);
  const enumsEmp = await loadEmpleadoEnums();
  const umaVigente = await loadUmaVigente(req.session.tenantId);

  res.render('Personal/empleado-edit', {
    empleado,
    ...catalogs,
    ...enumsEmp,
    ...empleadoFormExtras(umaVigente),
    asignacionCtx,
    tiposRegistro: TIPOS_REGISTRO,
    politicasMarcajeGeo: POLITICAS_MARCAJE_GEO,
    empresa,
    motivosBaja: MOTIVOS_BAJA,
    tiposContrato: enumsEmp.tiposContrato,
    estatusOptions: ESTATUS_EMPLEADO,
    showNominaConfig: showNominaConfig(req),
    tiposCreditoInfonavit: TIPOS_CREDITO_INFONAVIT,
    tiposCreditoFonacot: TIPOS_CREDITO_FONACOT,
    tiposCuotaSindical: TIPOS_CUOTA_SINDICAL,
    cuotaSindicalTope30Opts: CUOTA_SINDICAL_TOPE30_OPTS,
    cuotaSindicalBaseOpts: CUOTA_SINDICAL_BASE_OPTS,
    error: error || null,
    session: req.session,
    toDateInputValue
  });
}

async function updateEmpleado(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
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
    const issues = validateEmpleadoImssIsn(payload, empresa);
    Object.assign(empleado, payload);
    // Nested paths: asegurar que Mongoose detecte cambios
    empleado.markModified('domicilio');
    empleado.markModified('nominaConfig');
    empleado.markModified('datosBancarios');
    await empleado.save();
    await syncAsignacionFromBody(req.session.tenantId, empresa._id, empleado._id, req.body);
    await registrarCambioAutomatico(req.session.tenantId, empresa._id, antes, empleado.toObject(), {
      registradoPor: req.session.username || req.session.userName || ''
    });

    if (issues.length) {
      req.flash('success', 'Empleado actualizado');
      req.flash(
        'error',
        `Guardado OK. Falta completar IMSS/ISN (no bloquea el expediente): ${issues.join('. ')}`
      );
    } else {
      req.flash('success', 'Empleado actualizado');
    }
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

    const { empresa } = await requireEmpresaForTenant(req);
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

    const { empresa } = await requireEmpresaForTenant(req);
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

async function calcularSdiAction(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) {
      return res.status(400).json({ error: error || 'Sin empresa' });
    }
    const Empleado = await getEmpleadoModel();
    const empleado = await findOneByTenant(Empleado, req.session.tenantId, req.params.id);
    if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' });

    const body = req.body || {};
    const tipoSalario = String(body.tipoSalario || empleado.tipoSalario || 'fijo').toLowerCase();
    const salarioDiario =
      body.salarioDiario != null && body.salarioDiario !== ''
        ? Number(body.salarioDiario)
        : Number(empleado.salarioDiario) || 0;

    const uma = await loadUmaVigente(req.session.tenantId);
    const { calcularSdiEmpleado } = require('../services/sdiCalculoService');
    const result = await calcularSdiEmpleado({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      empleado: { ...empleado, tipoSalario, salarioDiario },
      uma,
      topeUma: 25,
      promedioVariableOverride:
        body.promedioVariable != null && body.promedioVariable !== ''
          ? Number(body.promedioVariable)
          : null
    });

    if (body.aplicar === true || body.aplicar === '1') {
      await Empleado.updateOne(
        { _id: empleado._id },
        { $set: { sdi: result.sdi, tipoSalario, updatedAt: new Date() } }
      );
    }

    return res.json(result);
  } catch (err) {
    console.error('[calcular-sdi]', err);
    return res.status(500).json({ error: err.message || 'Error al calcular SDI' });
  }
}

module.exports = {
  listEmpleados,
  createEmpleado,
  showEmpleado,
  editEmpleado,
  updateEmpleado,
  bajaEmpleado,
  reactivarEmpleado,
  calcularSdiAction
};

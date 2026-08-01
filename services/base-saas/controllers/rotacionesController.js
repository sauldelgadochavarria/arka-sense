const getPlantillaRotacionModel = require('../models/plantillaRotacion');
const getAsignacionRotacionModel = require('../models/asignacionRotacion');
const getOverrideTurnoModel = require('../models/overrideTurno');
const getEmpleadoModel = require('../models/empleado');
const getDepartamentoModel = require('../models/departamento');
const getTurnoModel = require('../models/turno');
const { requireEmpresaForTenant, findOneByTenant, findOneDocByTenant } = require('../libs/tenantScope');
const { trimString, parseOptionalObjectId, parseDate } = require('../libs/formHelpers');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');
const { DIAS_SEMANA } = require('../config/asistencia');
const { TIPOS_PLANTILLA, normalizeTipoPlantilla } = require('../config/plantillasHorario');
const {
  buildPlantillaPayload,
  slotMapFromPlantilla,
  parseFechaAncla,
  describePlantillaResumen,
  buildPreviewPlantilla,
  getPlantillaTipo
} = require('../services/rotacionService');
const { upsertAsignacion } = require('../services/asignacionPlantillaService');
const { resolveTurnoVigente } = require('../services/turnoResolverService');

function defaultFechaQuery(req) {
  return trimString(req.query.fecha) || new Date().toISOString().slice(0, 10);
}

async function loadTurnosMap(tenantId) {
  const Turno = await getTurnoModel();
  const turnos = await Turno.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean();
  return {
    turnos,
    turnoMap: new Map(turnos.map((t) => [String(t._id), t.nombre]))
  };
}

async function listRotaciones(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const PlantillaRotacion = await getPlantillaRotacionModel();
  const AsignacionRotacion = await getAsignacionRotacionModel();
  const { turnoMap } = await loadTurnosMap(req.session.tenantId);

  const [plantillas, asignaciones] = empresa
    ? await Promise.all([
        PlantillaRotacion.find({ tenantId: req.session.tenantId }).sort({ nombre: 1 }).lean(),
        AsignacionRotacion.find({ tenantId: req.session.tenantId, activo: true }).lean()
      ])
    : [[], []];

  const plantillasConResumen = plantillas.map((p) => ({
    ...p,
    tipoLabel: TIPOS_PLANTILLA.find((t) => t.value === getPlantillaTipo(p))?.label || p.tipo,
    resumen: describePlantillaResumen(p, turnoMap)
  }));

  res.render('Asistencia/rotaciones', {
    plantillas: plantillasConResumen,
    tiposPlantilla: TIPOS_PLANTILLA,
    asignacionesCount: asignaciones.length,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createPlantilla(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/asistencia-rotaciones');
    }

    const tipo = normalizeTipoPlantilla(req.body.tipo);
    const numSemanas = Math.max(1, Math.min(12, Number(req.body.numSemanas) || 2));
    const PlantillaRotacion = await getPlantillaRotacionModel();
    const plantilla = await PlantillaRotacion.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      nombre: trimString(req.body.nombre),
      descripcion: trimString(req.body.descripcion),
      tipo,
      turnoFijoId: null,
      cicloSlots: tipo === 'secuencia' ? [{ esDescanso: false, turnoId: null }] : [],
      numSemanas: tipo === 'matriz' ? numSemanas : 1,
      slots: [],
      activo: true
    });
    const msg =
      tipo === 'fijo'
        ? 'Plantilla de turno fijo creada.'
        : tipo === 'secuencia'
          ? 'Plantilla de secuencia creada. Configura el ciclo de turnos.'
          : 'Plantilla creada. Completa la matriz de turnos.';
    req.flash('success', msg);
    res.redirect(`/asistencia-rotaciones/${plantilla._id}/edit`);
  } catch (err) {
    console.error('[rotaciones]', err);
    req.flash('error', err.userMessage || (err.code === 11000 ? 'Ya existe una plantilla con ese nombre' : 'Error al crear plantilla'));
    res.redirect('/asistencia-rotaciones');
  }
}

async function editPlantilla(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const PlantillaRotacion = await getPlantillaRotacionModel();
  const plantilla = await findOneByTenant(PlantillaRotacion, req.session.tenantId, req.params.id);
  if (!plantilla) return res.status(404).send('Plantilla no encontrada');

  const { turnos, turnoMap } = await loadTurnosMap(req.session.tenantId);
  const slotMap = slotMapFromPlantilla(plantilla);
  const tipo = getPlantillaTipo(plantilla);
  const previewAncla = startOfDay(new Date());
  const preview = buildPreviewPlantilla(plantilla, previewAncla, previewAncla, 14, turnoMap);

  res.render('Asistencia/rotacion-edit', {
    plantilla,
    tipo,
    tiposPlantilla: TIPOS_PLANTILLA,
    turnos,
    turnoMap,
    slotMap,
    preview,
    diasSemana: DIAS_SEMANA,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function updatePlantilla(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/asistencia-rotaciones');
    }

    const PlantillaRotacion = await getPlantillaRotacionModel();
    const plantilla = await findOneDocByTenant(PlantillaRotacion, req.session.tenantId, req.params.id);
    if (!plantilla) return res.status(404).send('Plantilla no encontrada');

    const payload = buildPlantillaPayload(req.body, req.session.tenantId, empresa._id);
    plantilla.nombre = payload.nombre;
    plantilla.descripcion = payload.descripcion;
    plantilla.tipo = payload.tipo;
    plantilla.turnoFijoId = payload.turnoFijoId;
    plantilla.cicloSlots = payload.cicloSlots;
    plantilla.numSemanas = payload.numSemanas;
    plantilla.slots = payload.slots;
    await plantilla.save();

    req.flash('success', 'Plantilla actualizada');
    res.redirect(`/asistencia-rotaciones/${plantilla._id}/edit`);
  } catch (err) {
    console.error('[rotaciones]', err);
    req.flash('error', err.userMessage || 'Error al actualizar plantilla');
    res.redirect(`/asistencia-rotaciones/${req.params.id}/edit`);
  }
}

async function togglePlantilla(req, res) {
  const PlantillaRotacion = await getPlantillaRotacionModel();
  const plantilla = await findOneDocByTenant(PlantillaRotacion, req.session.tenantId, req.params.id);
  if (!plantilla) return res.status(404).send('Plantilla no encontrada');

  plantilla.activo = !plantilla.activo;
  await plantilla.save();
  req.flash('success', plantilla.activo ? 'Plantilla activada' : 'Plantilla desactivada');
  res.redirect('/asistencia-rotaciones');
}

async function listAsignaciones(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const PlantillaRotacion = await getPlantillaRotacionModel();
  const AsignacionRotacion = await getAsignacionRotacionModel();
  const Empleado = await getEmpleadoModel();
  const Departamento = await getDepartamentoModel();
  const { turnoMap } = await loadTurnosMap(req.session.tenantId);

  const [plantillas, asignaciones, empleados, departamentos] = empresa
    ? await Promise.all([
        PlantillaRotacion.find({ tenantId: req.session.tenantId, activo: true }).sort({ nombre: 1 }).lean(),
        AsignacionRotacion.find({ tenantId: req.session.tenantId }).sort({ updatedAt: -1 }).lean(),
        Empleado.find({ tenantId: req.session.tenantId, estatus: 'activo' }).sort({ lastName: 1 }).lean(),
        Departamento.find({ tenantId: req.session.tenantId, activo: true }).sort({ nombre: 1 }).lean()
      ])
    : [[], [], [], []];

  const plantillaMap = new Map(
    plantillas.map((p) => [String(p._id), `${p.nombre} (${getPlantillaTipo(p)})`])
  );
  const empMap = new Map(empleados.map((e) => [String(e._id), `${e.firstName} ${e.lastName}`]));

  res.render('Asistencia/rotaciones-asignaciones', {
    plantillas,
    asignaciones,
    empleados,
    departamentos,
    plantillaMap,
    empMap,
    turnoMap,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createAsignacion(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/asistencia-rotaciones/asignaciones');
    }

    const empleadoId = parseOptionalObjectId(req.body.empleadoId);
    const plantillaId = parseOptionalObjectId(req.body.plantillaRotacionId);
    const fechaAncla = parseFechaAncla(req.body);

    if (!empleadoId || !plantillaId) {
      req.flash('error', 'Empleado y plantilla son obligatorios');
      return res.redirect('/asistencia-rotaciones/asignaciones');
    }

    await upsertAsignacion(req.session.tenantId, empresa._id, empleadoId, plantillaId, fechaAncla);
    req.flash('success', 'Asignación guardada');
    res.redirect('/asistencia-rotaciones/asignaciones');
  } catch (err) {
    console.error('[rotaciones/asignaciones]', err);
    req.flash('error', 'Error al asignar plantilla');
    res.redirect('/asistencia-rotaciones/asignaciones');
  }
}

async function createAsignacionMasiva(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/asistencia-rotaciones/asignaciones');
    }

    const departamentoId = parseOptionalObjectId(req.body.departamentoId);
    const plantillaId = parseOptionalObjectId(req.body.plantillaRotacionId);
    const fechaAncla = parseFechaAncla(req.body);

    if (!departamentoId || !plantillaId) {
      req.flash('error', 'Departamento y plantilla son obligatorios');
      return res.redirect('/asistencia-rotaciones/asignaciones');
    }

    const Empleado = await getEmpleadoModel();
    const empleados = await Empleado.find({
      tenantId: req.session.tenantId,
      departamentoId,
      estatus: 'activo',
      activo: true
    }).lean();

    for (const emp of empleados) {
      await upsertAsignacion(req.session.tenantId, empresa._id, emp._id, plantillaId, fechaAncla);
    }

    req.flash('success', `Plantilla asignada a ${empleados.length} empleado(s)`);
    res.redirect('/asistencia-rotaciones/asignaciones');
  } catch (err) {
    console.error('[rotaciones/asignaciones-masiva]', err);
    req.flash('error', 'Error en asignación masiva');
    res.redirect('/asistencia-rotaciones/asignaciones');
  }
}

async function toggleAsignacion(req, res) {
  const AsignacionRotacion = await getAsignacionRotacionModel();
  const asignacion = await findOneDocByTenant(AsignacionRotacion, req.session.tenantId, req.params.id);
  if (!asignacion) return res.status(404).send('Asignación no encontrada');

  asignacion.activo = !asignacion.activo;
  await asignacion.save();
  req.flash('success', asignacion.activo ? 'Asignación activada' : 'Asignación desactivada');
  res.redirect('/asistencia-rotaciones/asignaciones');
}

async function listCambios(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const OverrideTurno = await getOverrideTurnoModel();
  const Empleado = await getEmpleadoModel();
  const { turnos, turnoMap } = await loadTurnosMap(req.session.tenantId);

  const desde = parseDate(req.query.desde) || startOfDay(new Date());
  const hasta = parseDate(req.query.hasta) || endOfDay(new Date(Date.now() + 30 * 86400000));

  const [cambios, empleados] = empresa
    ? await Promise.all([
        OverrideTurno.find({
          tenantId: req.session.tenantId,
          fecha: { $gte: startOfDay(desde), $lte: endOfDay(hasta) }
        })
          .sort({ fecha: -1 })
          .lean(),
        Empleado.find({ tenantId: req.session.tenantId, estatus: 'activo' }).sort({ lastName: 1 }).lean()
      ])
    : [[], []];

  const empMap = new Map(empleados.map((e) => [String(e._id), `${e.firstName} ${e.lastName}`]));

  res.render('Asistencia/rotaciones-cambios', {
    cambios,
    empleados,
    turnos,
    turnoMap,
    empMap,
    desde: desde.toISOString().slice(0, 10),
    hasta: hasta.toISOString().slice(0, 10),
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createCambio(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/asistencia-rotaciones/cambios');
    }

    const empleadoId = parseOptionalObjectId(req.body.empleadoId);
    const fecha = parseDate(req.body.fecha);
    const rawTurno = req.body.turnoId;
    const esDescanso = rawTurno === 'descanso';
    const turnoId = esDescanso ? null : parseOptionalObjectId(rawTurno);

    if (!empleadoId || !fecha) {
      req.flash('error', 'Empleado y fecha son obligatorios');
      return res.redirect('/asistencia-rotaciones/cambios');
    }
    if (!esDescanso && !turnoId) {
      req.flash('error', 'Selecciona un turno o descanso');
      return res.redirect('/asistencia-rotaciones/cambios');
    }

    const OverrideTurno = await getOverrideTurnoModel();
    await OverrideTurno.findOneAndUpdate(
      { tenantId: req.session.tenantId, empleadoId, fecha: startOfDay(fecha) },
      {
        $set: {
          tenantId: req.session.tenantId,
          empresaId: empresa._id,
          empleadoId,
          fecha: startOfDay(fecha),
          turnoId,
          esDescanso,
          motivo: trimString(req.body.motivo),
          creadoPorUserId: req.session.userid || '',
          activo: true
        }
      },
      { upsert: true, new: true }
    );

    req.flash('success', 'Cambio de turno registrado para esa fecha');
    res.redirect('/asistencia-rotaciones/cambios');
  } catch (err) {
    console.error('[rotaciones/cambios]', err);
    req.flash('error', 'Error al registrar cambio');
    res.redirect('/asistencia-rotaciones/cambios');
  }
}

async function toggleCambio(req, res) {
  const OverrideTurno = await getOverrideTurnoModel();
  const cambio = await findOneDocByTenant(OverrideTurno, req.session.tenantId, req.params.id);
  if (!cambio) return res.status(404).send('Cambio no encontrado');

  cambio.activo = !cambio.activo;
  await cambio.save();
  req.flash('success', cambio.activo ? 'Cambio activado' : 'Cambio cancelado');
  res.redirect('/asistencia-rotaciones/cambios');
}

async function showMatriz(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const fechaStr = defaultFechaQuery(req);
  const fechaInicio = startOfDay(new Date(`${fechaStr}T12:00:00`));
  const diasVista = Math.min(28, Math.max(7, Number(req.query.dias) || 14));

  const Empleado = await getEmpleadoModel();
  const AsignacionRotacion = await getAsignacionRotacionModel();
  const { turnoMap } = await loadTurnosMap(req.session.tenantId);

  const asignaciones = empresa
    ? await AsignacionRotacion.find({ tenantId: req.session.tenantId, activo: true }).lean()
    : [];

  const empleadoIds = asignaciones.map((a) => a.empleadoId);
  const empleados = empleadoIds.length
    ? await Empleado.find({ _id: { $in: empleadoIds } }).sort({ lastName: 1 }).lean()
    : [];

  const fechas = [];
  for (let i = 0; i < diasVista; i += 1) {
    fechas.push(new Date(fechaInicio.getTime() + i * 86400000));
  }

  const filas = [];
  for (const empleado of empleados) {
    const celdas = [];
    for (const fecha of fechas) {
      const resolved = await resolveTurnoVigente(req.session.tenantId, empleado, fecha);
      let label = '—';
      if (resolved.esDescansoForzado) label = 'Descanso';
      else if (resolved.turno) label = turnoMap.get(String(resolved.turno._id)) || resolved.turno.nombre;
      celdas.push({ fecha, label, origen: resolved.origen });
    }
    filas.push({ empleado, celdas });
  }

  res.render('Asistencia/rotaciones-matriz', {
    filas,
    fechas,
    fecha: fechaStr,
    diasVista,
    empresa,
    error: error || null,
    session: req.session
  });
}

module.exports = {
  listRotaciones,
  createPlantilla,
  editPlantilla,
  updatePlantilla,
  togglePlantilla,
  listAsignaciones,
  createAsignacion,
  createAsignacionMasiva,
  toggleAsignacion,
  listCambios,
  createCambio,
  toggleCambio,
  showMatriz
};

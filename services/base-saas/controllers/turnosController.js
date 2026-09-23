const getTurnoModel = require('../models/turno');
const {
  requireEmpresaForTenant,
  findOneByTenant,
  findOneDocByTenant
} = require('../libs/tenantScope');
const { buildTurnoPayload } = require('../libs/turnoPayload');
const { describeVentanaTurno, labelTipoTurno } = require('../libs/turnoHelpers');
const { DIAS_SEMANA, TIPOS_TURNO, MODOS_TOLERANCIA } = require('../config/asistencia');
const { TIPOS_JORNADA_CFDI } = require('../libs/esquemaJornada');

function stripInternal(payload) {
  const { _esquemaWarnings, ...rest } = payload;
  return { data: rest, warnings: _esquemaWarnings || [] };
}

function flashTurnoError(req, err, fallback) {
  if (err.message === 'INVALID_SHIFT_TIME') {
    req.flash('error', 'Horario inválido (use HH:MM)');
    return;
  }
  if (err.code === 'TURNO_EXCEDE_ESQUEMA') {
    req.flash('error', err.message || 'El turno excede el tope diario del esquema (máx. 12 h)');
    return;
  }
  if (err.code === 11000) {
    req.flash('error', 'Ya existe un turno con ese nombre');
    return;
  }
  req.flash('error', fallback);
}
async function listTurnos(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Turno = await getTurnoModel();
  const turnos = empresa
    ? await Turno.find({ tenantId: req.session.tenantId }).sort({ nombre: 1 }).lean()
    : [];

  res.render('Asistencia/turnos', {
    turnos,
    diasSemana: DIAS_SEMANA,
    tiposTurno: TIPOS_TURNO,
    modosTolerancia: MODOS_TOLERANCIA,
    tiposJornadaCfdi: TIPOS_JORNADA_CFDI,
    labelTipoTurno: (tipo) => labelTipoTurno(tipo, TIPOS_TURNO),
    describeVentana: describeVentanaTurno,
    empresa,
    error: error || null,
    session: req.session
  });
}

function turnoFormLocals(empresa, error, req) {
  return {
    turno: null,
    diasSemana: DIAS_SEMANA,
    tiposTurno: TIPOS_TURNO,
    modosTolerancia: MODOS_TOLERANCIA,
    tiposJornadaCfdi: TIPOS_JORNADA_CFDI,
    describeVentana: describeVentanaTurno,
    empresa,
    error: error || null,
    session: req.session
  };
}

async function newTurno(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  res.render('Asistencia/turno-nuevo', turnoFormLocals(empresa, error, req));
}

async function createTurno(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/asistencia-turnos/nuevo');
    }

    const Turno = await getTurnoModel();
    const built = stripInternal(buildTurnoPayload(req.body, req.session.tenantId, empresa._id));
    await Turno.create({ ...built.data, activo: true });
    if (built.warnings.length) {
      req.flash('success', `Turno creado. Aviso: ${built.warnings.join(' · ')}`);
    } else {
      req.flash('success', 'Turno creado');
    }
    res.redirect('/asistencia-turnos');
  } catch (err) {
    console.error('[turnos]', err);
    flashTurnoError(req, err, 'Error al crear turno');
    res.redirect('/asistencia-turnos/nuevo');
  }
}

async function editTurno(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Turno = await getTurnoModel();
  const turno = await findOneByTenant(Turno, req.session.tenantId, req.params.id);
  if (!turno) return res.status(404).send('Turno no encontrado');

  res.render('Asistencia/turno-edit', {
    turno,
    diasSemana: DIAS_SEMANA,
    tiposTurno: TIPOS_TURNO,
    modosTolerancia: MODOS_TOLERANCIA,
    tiposJornadaCfdi: TIPOS_JORNADA_CFDI,
    describeVentana: describeVentanaTurno,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function updateTurno(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/asistencia-turnos');
    }

    const Turno = await getTurnoModel();
    const turno = await findOneDocByTenant(Turno, req.session.tenantId, req.params.id);
    if (!turno) return res.status(404).send('Turno no encontrado');

    const built = stripInternal(buildTurnoPayload(req.body, req.session.tenantId, empresa._id));
    Object.assign(turno, built.data);
    await turno.save();

    if (built.warnings.length) {
      req.flash('success', `Turno actualizado. Aviso: ${built.warnings.join(' · ')}`);
    } else {
      req.flash('success', 'Turno actualizado');
    }
    res.redirect('/asistencia-turnos');
  } catch (err) {
    console.error('[turnos]', err);
    flashTurnoError(req, err, 'Error al actualizar turno');
    res.redirect(`/asistencia-turnos/${req.params.id}/edit`);
  }
}

async function toggleTurno(req, res) {
  const Turno = await getTurnoModel();
  const turno = await findOneDocByTenant(Turno, req.session.tenantId, req.params.id);
  if (!turno) return res.status(404).send('Turno no encontrado');

  turno.activo = !turno.activo;
  await turno.save();
  req.flash('success', turno.activo ? 'Turno activado' : 'Turno desactivado');
  res.redirect('/asistencia-turnos');
}

module.exports = { listTurnos, newTurno, createTurno, editTurno, updateTurno, toggleTurno };

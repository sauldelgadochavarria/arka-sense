const getTurnoModel = require('../models/turno');
const {
  requireEmpresaForTenant,
  findOneByTenant,
  findOneDocByTenant
} = require('../libs/tenantScope');
const { buildTurnoPayload } = require('../libs/turnoPayload');
const { describeVentanaTurno, labelTipoTurno } = require('../libs/turnoHelpers');
const { DIAS_SEMANA, TIPOS_TURNO, MODOS_TOLERANCIA } = require('../config/asistencia');

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
    labelTipoTurno: (tipo) => labelTipoTurno(tipo, TIPOS_TURNO),
    describeVentana: describeVentanaTurno,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createTurno(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/asistencia-turnos');
    }

    const Turno = await getTurnoModel();
    const payload = buildTurnoPayload(req.body, req.session.tenantId, empresa._id);
    await Turno.create({ ...payload, activo: true });
    req.flash('success', 'Turno creado');
    res.redirect('/asistencia-turnos');
  } catch (err) {
    console.error('[turnos]', err);
    const msg = err.message === 'INVALID_SHIFT_TIME' ? 'Horario inválido (use HH:MM)' : 'Error al crear turno';
    req.flash('error', err.code === 11000 ? 'Ya existe un turno con ese nombre' : msg);
    res.redirect('/asistencia-turnos');
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

    const payload = buildTurnoPayload(req.body, req.session.tenantId, empresa._id);
    Object.assign(turno, payload);
    await turno.save();

    req.flash('success', 'Turno actualizado');
    res.redirect('/asistencia-turnos');
  } catch (err) {
    console.error('[turnos]', err);
    const msg = err.message === 'INVALID_SHIFT_TIME' ? 'Horario inválido (use HH:MM)' : 'Error al actualizar turno';
    req.flash('error', err.code === 11000 ? 'Ya existe un turno con ese nombre' : msg);
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

module.exports = { listTurnos, createTurno, editTurno, updateTurno, toggleTurno };

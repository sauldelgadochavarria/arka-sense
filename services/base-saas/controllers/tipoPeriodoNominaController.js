'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString, parseOptionalLegadoCode, parseCheckbox } = require('../libs/formHelpers');
const { TIPOS_PERIODO } = require('../config/prenomina');
const { PERIODICIDAD_SAT } = require('../config/tipoPeriodoDefaults');
const { DIAS_SEMANA_OPTS, MODOS_CALENDARIO, parseCalendarioFromBody } = require('../libs/calendarioPeriodo');
const {
  ensureTiposPeriodoForTenant,
  listTiposPeriodo,
  getTipoPeriodoById,
  crearTipoPeriodo,
  actualizarTipoPeriodo,
  toggleTipoPeriodo,
  nextCodigoLegado,
  listCodigosLegadoOcupados
} = require('../services/tipoPeriodoNominaService');

function formLocals(extra = {}) {
  return {
    tiposMotor: TIPOS_PERIODO,
    periodicidadSat: PERIODICIDAD_SAT,
    diasSemanaOpts: DIAS_SEMANA_OPTS,
    modosCalendario: MODOS_CALENDARIO,
    ...extra
  };
}

async function list(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (empresa) await ensureTiposPeriodoForTenant(req.session.tenantId, empresa._id);
  const tipos = empresa ? await listTiposPeriodo(req.session.tenantId) : [];

  res.render('Prenomina/tipos-periodo', {
    tipos,
    ...formLocals(),
    empresa,
    error: error || null,
    session: req.session
  });
}

async function newForm(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const sugeridoCodigoLegado = empresa
    ? await nextCodigoLegado(req.session.tenantId)
    : 1;
  const ocupados = empresa ? await listCodigosLegadoOcupados(req.session.tenantId) : [];
  res.render(
    'Prenomina/tipo-periodo-nuevo',
    formLocals({
      sugeridoCodigoLegado,
      codigosOcupadosJson: JSON.stringify(ocupados),
      empresa,
      error: error || null,
      session: req.session
    })
  );
}

async function create(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/prenomina/tipos-periodo');
    }

    const cal = parseCalendarioFromBody(req.body);
    await crearTipoPeriodo(req.session.tenantId, empresa._id, {
      codigoLegado: parseOptionalLegadoCode(req.body.codigoLegado),
      codigoExterno: trimString(req.body.codigoExterno),
      nombre: trimString(req.body.nombre),
      tipoMotor: trimString(req.body.tipoMotor),
      diasPeriodo: req.body.diasPeriodo,
      esSeptimo: parseCheckbox(req.body, 'esSeptimo'),
      diasLaborables: req.body.diasLaborables,
      leyenda: trimString(req.body.leyenda),
      periodicidadPagoSat: req.body.periodicidadPagoSat,
      aplicaAsistenciaPrenomina: parseCheckbox(req.body, 'aplicaAsistenciaPrenomina'),
      compartirConNomina: parseCheckbox(req.body, 'compartirConNomina'),
      ...cal
    });
    req.flash('success', 'Tipo de período creado');
  } catch (err) {
    req.flash('error', err.message || 'Error al crear tipo de período');
  }
  res.redirect('/prenomina/tipos-periodo');
}

async function edit(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const tipo = await getTipoPeriodoById(req.session.tenantId, req.params.id);
  if (!tipo) return res.status(404).send('Tipo de período no encontrado');

  const sugeridoCodigoLegado = await nextCodigoLegado(req.session.tenantId);
  const ocupados = await listCodigosLegadoOcupados(req.session.tenantId, tipo._id);

  res.render(
    'Prenomina/tipo-periodo-edit',
    formLocals({
      tipo,
      sugeridoCodigoLegado,
      codigosOcupadosJson: JSON.stringify(ocupados),
      empresa,
      error: error || null,
      session: req.session
    })
  );
}

async function update(req, res) {
  try {
    const cal = parseCalendarioFromBody(req.body);
    await actualizarTipoPeriodo(req.session.tenantId, req.params.id, {
      codigoLegado: parseOptionalLegadoCode(req.body.codigoLegado),
      codigoExterno: trimString(req.body.codigoExterno),
      nombre: trimString(req.body.nombre),
      tipoMotor: trimString(req.body.tipoMotor),
      diasPeriodo: req.body.diasPeriodo,
      esSeptimo: parseCheckbox(req.body, 'esSeptimo'),
      diasLaborables: req.body.diasLaborables,
      leyenda: trimString(req.body.leyenda),
      periodicidadPagoSat: req.body.periodicidadPagoSat,
      aplicaAsistenciaPrenomina: parseCheckbox(req.body, 'aplicaAsistenciaPrenomina'),
      compartirConNomina: parseCheckbox(req.body, 'compartirConNomina'),
      ...cal
    });
    req.flash('success', 'Tipo de período actualizado');
    res.redirect('/prenomina/tipos-periodo');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar');
    res.redirect(`/prenomina/tipos-periodo/${req.params.id}/edit`);
  }
}

async function toggle(req, res) {
  try {
    await toggleTipoPeriodo(req.session.tenantId, req.params.id);
    req.flash('success', 'Estado actualizado');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar');
  }
  res.redirect('/prenomina/tipos-periodo');
}

module.exports = { list, newForm, create, edit, update, toggle };

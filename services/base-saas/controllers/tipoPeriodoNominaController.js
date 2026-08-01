'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString, parseOptionalLegadoCode, parseCheckbox } = require('../libs/formHelpers');
const { TIPOS_PERIODO } = require('../config/prenomina');
const { PERIODICIDAD_SAT } = require('../config/tipoPeriodoDefaults');
const {
  ensureTiposPeriodoForTenant,
  listTiposPeriodo,
  getTipoPeriodoById,
  crearTipoPeriodo,
  actualizarTipoPeriodo,
  toggleTipoPeriodo
} = require('../services/tipoPeriodoNominaService');

async function list(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (empresa) await ensureTiposPeriodoForTenant(req.session.tenantId, empresa._id);
  const tipos = empresa ? await listTiposPeriodo(req.session.tenantId) : [];

  res.render('Prenomina/tipos-periodo', {
    tipos,
    tiposMotor: TIPOS_PERIODO,
    periodicidadSat: PERIODICIDAD_SAT,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function newForm(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  res.render('Prenomina/tipo-periodo-nuevo', {
    tiposMotor: TIPOS_PERIODO,
    periodicidadSat: PERIODICIDAD_SAT,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function create(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/prenomina/tipos-periodo');
    }

    await crearTipoPeriodo(req.session.tenantId, empresa._id, {
      codigoLegado: parseOptionalLegadoCode(req.body.codigoLegado),
      codigoExterno: trimString(req.body.codigoExterno),
      nombre: trimString(req.body.nombre),
      tipoMotor: trimString(req.body.tipoMotor),
      diasPeriodo: req.body.diasPeriodo,
      esSeptimo: parseCheckbox(req.body.esSeptimo),
      diasLaborables: req.body.diasLaborables,
      leyenda: trimString(req.body.leyenda),
      periodicidadPagoSat: req.body.periodicidadPagoSat,
      aplicaAsistenciaPrenomina: parseCheckbox(req.body.aplicaAsistenciaPrenomina),
      compartirConNomina: parseCheckbox(req.body.compartirConNomina)
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

  res.render('Prenomina/tipo-periodo-edit', {
    tipo,
    tiposMotor: TIPOS_PERIODO,
    periodicidadSat: PERIODICIDAD_SAT,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function update(req, res) {
  try {
    await actualizarTipoPeriodo(req.session.tenantId, req.params.id, {
      codigoLegado: parseOptionalLegadoCode(req.body.codigoLegado),
      codigoExterno: trimString(req.body.codigoExterno),
      nombre: trimString(req.body.nombre),
      tipoMotor: trimString(req.body.tipoMotor),
      diasPeriodo: req.body.diasPeriodo,
      esSeptimo: parseCheckbox(req.body.esSeptimo),
      diasLaborables: req.body.diasLaborables,
      leyenda: trimString(req.body.leyenda),
      periodicidadPagoSat: req.body.periodicidadPagoSat,
      aplicaAsistenciaPrenomina: parseCheckbox(req.body.aplicaAsistenciaPrenomina),
      compartirConNomina: parseCheckbox(req.body.compartirConNomina)
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

'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString, parseOptionalLegadoCode } = require('../libs/formHelpers');
const {
  listCentrosCosto,
  crearCentroCosto,
  getCentroCostoById,
  actualizarCentroCosto,
  toggleCentroCosto
} = require('../services/centroCostoService');

async function list(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const centros = empresa ? await listCentrosCosto(req.session.tenantId) : [];

  res.render('Prenomina/centros-costo', {
    centros,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function newForm(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  res.render('Prenomina/centro-costo-nuevo', {
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
      return res.redirect('/prenomina/centros-costo');
    }

    await crearCentroCosto(req.session.tenantId, empresa._id, {
      codigo: trimString(req.body.codigo),
      nombre: trimString(req.body.nombre),
      descripcion: trimString(req.body.descripcion),
      codigoLegado: req.body.codigoLegado,
      codigoExterno: trimString(req.body.codigoExterno),
      cuentaContableExterna: trimString(req.body.cuentaContableExterna)
    });
    req.flash('success', 'Centro de costo creado');
  } catch (err) {
    req.flash('error', err.code === 11000 ? 'Ya existe ese código' : err.message || 'Error al crear');
  }
  res.redirect('/prenomina/centros-costo');
}

async function edit(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const centro = await getCentroCostoById(req.session.tenantId, req.params.id);
  if (!centro) return res.status(404).send('Centro de costo no encontrado');

  res.render('Prenomina/centro-costo-edit', {
    centro,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function update(req, res) {
  try {
    await actualizarCentroCosto(req.session.tenantId, req.params.id, {
      codigo: trimString(req.body.codigo),
      nombre: trimString(req.body.nombre),
      descripcion: trimString(req.body.descripcion),
      codigoLegado: req.body.codigoLegado,
      codigoExterno: trimString(req.body.codigoExterno),
      cuentaContableExterna: trimString(req.body.cuentaContableExterna)
    });
    req.flash('success', 'Centro de costo actualizado');
    res.redirect('/prenomina/centros-costo');
  } catch (err) {
    req.flash('error', err.code === 11000 ? 'Ya existe ese código' : err.message || 'Error al actualizar');
    res.redirect(`/prenomina/centros-costo/${req.params.id}/edit`);
  }
}

async function toggle(req, res) {
  try {
    await toggleCentroCosto(req.session.tenantId, req.params.id);
    req.flash('success', 'Estado actualizado');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar');
  }
  res.redirect('/prenomina/centros-costo');
}

module.exports = { list, newForm, create, edit, update, toggle };

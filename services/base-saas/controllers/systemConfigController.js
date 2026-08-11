'use strict';

const { listSystemEnums, ensureSystemEnums, updateEnumItems } = require('../services/nomina/systemEnumService');
const {
  ensureConceptCatalog,
  ensureCompanyConceptConfigs,
  ensureDefaultFormulas
} = require('../services/nomina/conceptResolutionService');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString } = require('../libs/formHelpers');

async function listEnums(req, res) {
  await ensureSystemEnums();
  try {
    const { ensureFormulaFunctionsSeeded } = require('../services/nomina/formulaFunctionsService');
    await ensureFormulaFunctionsSeeded();
  } catch (_) {
    /* catálogo funciones opcional */
  }
  const enums = await listSystemEnums();
  res.render('ConfigSistema/enums', { enums, session: req.session });
}

async function editEnum(req, res) {
  const enums = await listSystemEnums();
  const grupo = enums.find((e) => e.grupo === req.params.grupo);
  if (!grupo) {
    req.flash('error', 'Grupo de enum no encontrado');
    return res.redirect('/config-sistema/enums');
  }
  res.render('ConfigSistema/enum-edit', { grupo, session: req.session });
}

async function saveEnum(req, res) {
  try {
    const values = [].concat(req.body.value || []);
    const labels = [].concat(req.body.label || []);
    const descripciones = [].concat(req.body.descripcion || []);
    const ordenes = [].concat(req.body.orden || []);
    const items = values.map((v, i) => ({
      value: String(v || '').trim(),
      label: String(labels[i] || v || '').trim(),
      descripcion: String(descripciones[i] || '').trim(),
      orden: Number(ordenes[i]) || i + 1,
      activo: true
    })).filter((it) => it.value);

    await updateEnumItems(req.params.grupo, items);
    req.flash('success', 'Enum actualizado');
  } catch (err) {
    req.flash('error', err.message === 'ENUM_NOT_EDITABLE' ? 'Este enum no es editable' : 'No se pudo guardar');
  }
  res.redirect(`/config-sistema/enums/${req.params.grupo}`);
}

async function bootstrapArquitectura(req, res) {
  try {
    await ensureSystemEnums();
    try {
      const { ensureFormulaFunctionsSeeded } = require('../services/nomina/formulaFunctionsService');
      await ensureFormulaFunctionsSeeded();
    } catch (_) {
      /* ignore */
    }
    await ensureConceptCatalog();
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error || !empresa) {
      req.flash('error', error || 'Sin empresa');
      return res.redirect('/config-sistema/enums');
    }
    await ensureCompanyConceptConfigs(req.session.tenantId, empresa._id);
    await ensureDefaultFormulas(req.session.tenantId, null);
    const { syncTenantConceptosFromCatalog } = require('../services/nomina/conceptResolutionService');
    await syncTenantConceptosFromCatalog(req.session.tenantId, empresa._id);
    req.flash('success', 'Arquitectura sembrada: enums, catálogo SUELDO/HE, fórmulas y conceptos tenant');
  } catch (err) {
    console.error('[config-sistema]', err);
    req.flash('error', 'Error al sembrar arquitectura');
  }
  res.redirect('/config-sistema/enums');
}

module.exports = { listEnums, editEnum, saveEnum, bootstrapArquitectura };

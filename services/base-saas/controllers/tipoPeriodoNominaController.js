'use strict';

const { requireEmpresaForTenant, sessionSubsidiariaId } = require('../libs/tenantScope');
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

function catalogBase(req) {
  const url = String(req.originalUrl || req.path || '');
  return url.startsWith('/nomina/') ? '/nomina/tipos-periodo' : '/prenomina/tipos-periodo';
}

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
  const { empresa, error } = await requireEmpresaForTenant(req);
  const subId = sessionSubsidiariaId(req);
  const base = catalogBase(req);
  if (empresa) await ensureTiposPeriodoForTenant(req.session.tenantId, empresa._id, subId);
  const tipos = empresa
    ? await listTiposPeriodo(req.session.tenantId, false, empresa._id, subId || null)
    : [];

  res.render('Prenomina/tipos-periodo', {
    tipos,
    catalogBase: base,
    subsidiariaId: subId,
    ...formLocals(),
    empresa,
    error: error || null,
    session: req.session
  });
}

async function newForm(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const subId = sessionSubsidiariaId(req);
  const base = catalogBase(req);
  const sugeridoCodigoLegado = empresa
    ? await nextCodigoLegado(req.session.tenantId, empresa._id, subId || null)
    : 1;
  const ocupados = empresa
    ? await listCodigosLegadoOcupados(req.session.tenantId, null, empresa._id, subId || null)
    : [];
  res.render(
    'Prenomina/tipo-periodo-nuevo',
    formLocals({
      catalogBase: base,
      subsidiariaId: subId,
      sugeridoCodigoLegado,
      codigosOcupadosJson: JSON.stringify(ocupados),
      empresa,
      error: error || null,
      session: req.session
    })
  );
}

async function create(req, res) {
  const base = catalogBase(req);
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error) {
      req.flash('error', error);
      return res.redirect(base);
    }
    const subId = sessionSubsidiariaId(req);

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
      subsidiariaId: subId || null,
      ...cal
    });
    req.flash('success', 'Tipo de período creado (catálogo compartido prenómina/nómina)');
  } catch (err) {
    req.flash('error', err.message || 'Error al crear tipo de período');
  }
  res.redirect(base);
}

async function edit(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const base = catalogBase(req);
  const subId = sessionSubsidiariaId(req);
  const tipo = await getTipoPeriodoById(req.session.tenantId, req.params.id);
  if (!tipo) return res.status(404).send('Tipo de período no encontrado');

  const sugeridoCodigoLegado = await nextCodigoLegado(
    req.session.tenantId,
    empresa ? empresa._id : null,
    tipo.subsidiariaId || subId || null
  );
  const ocupados = await listCodigosLegadoOcupados(
    req.session.tenantId,
    tipo._id,
    empresa ? empresa._id : null,
    tipo.subsidiariaId || subId || null
  );

  res.render(
    'Prenomina/tipo-periodo-edit',
    formLocals({
      tipo,
      catalogBase: base,
      subsidiariaId: subId,
      sugeridoCodigoLegado,
      codigosOcupadosJson: JSON.stringify(ocupados),
      empresa,
      error: error || null,
      session: req.session
    })
  );
}

async function update(req, res) {
  const base = catalogBase(req);
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
    res.redirect(base);
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar');
    res.redirect(`${base}/${req.params.id}/edit`);
  }
}

async function toggle(req, res) {
  const base = catalogBase(req);
  try {
    await toggleTipoPeriodo(req.session.tenantId, req.params.id);
    req.flash('success', 'Estado actualizado');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar');
  }
  res.redirect(base);
}

module.exports = { list, newForm, create, edit, update, toggle };

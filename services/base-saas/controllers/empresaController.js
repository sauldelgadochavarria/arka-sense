const getEmpresaModel = require('../models/empresa');
const {
  requireEmpresaForTenant,
  listEmpresasForTenant,
  setSessionEmpresa,
  snapshotEmpresa
} = require('../libs/tenantScope');
const { trimString, trimUpper } = require('../libs/formHelpers');
const { ENTIDADES_FEDERATIVAS } = require('../config/empleadoCatalogos');

async function showEmpresa(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const empresas = req.session.tenantId
    ? await listEmpresasForTenant(req.session.tenantId)
    : [];
  if (error && !empresas.length) {
    return res.render('Configurations/empresa', {
      empresa: null,
      empresas: [],
      entidadesFederativas: ENTIDADES_FEDERATIVAS,
      session: req.session
    });
  }
  res.render('Configurations/empresa', {
    empresa,
    empresas,
    entidadesFederativas: ENTIDADES_FEDERATIVAS,
    session: req.session
  });
}

async function updateEmpresa(req, res) {
  try {
    const Empresa = await getEmpresaModel();
    const { empresa: empresaLean, error } = await requireEmpresaForTenant(req);
    if (error || !empresaLean) {
      req.flash('error', error || 'Empresa no encontrada para este tenant');
      return res.redirect('/config-empresa');
    }
    const empresa = await Empresa.findById(empresaLean._id);
    if (!empresa) {
      req.flash('error', 'Empresa no encontrada para este tenant');
      return res.redirect('/config-empresa');
    }

    empresa.razonSocial = trimString(req.body.razonSocial) || empresa.razonSocial;
    empresa.nombreComercial = trimString(req.body.nombreComercial);
    empresa.rfc = trimUpper(req.body.rfc);
    empresa.domicilioFiscal = trimString(req.body.domicilioFiscal);
    empresa.ciudad = trimString(req.body.ciudad);
    empresa.estado = trimUpper(req.body.estado);
    empresa.codigoPostal = trimString(req.body.codigoPostal);
    empresa.giro = trimString(req.body.giro);
    empresa.telefono = trimString(req.body.telefono);
    empresa.registroPatronal = trimUpper(req.body.registroPatronal).replace(/\s+/g, '').slice(0, 11);

    if (!empresa.registroPatronal) {
      req.flash('error', 'El registro patronal IMSS es obligatorio');
      return res.redirect('/config-empresa');
    }

    if (req.body.primaRiesgoTrabajo !== undefined && req.body.primaRiesgoTrabajo !== '') {
      const prima = Number(req.body.primaRiesgoTrabajo);
      if (Number.isFinite(prima) && prima >= 0) {
        empresa.primaRiesgoTrabajo = Math.min(0.15, Math.max(0.005, prima));
      }
    }
    await empresa.save();
    req.session.empresaActiva = snapshotEmpresa(empresa.toObject ? empresa.toObject() : empresa);

    req.flash('success', 'Datos de empresa actualizados');
    res.redirect('/config-empresa');
  } catch (err) {
    console.error('[empresa]', err);
    req.flash('error', 'No se pudieron guardar los datos de empresa');
    res.redirect('/config-empresa');
  }
}

async function createEmpresa(req, res) {
  try {
    const tenantId = String(req.session.tenantId || '');
    if (!tenantId) throw new Error('Sin tenant');

    const razonSocial = trimString(req.body.razonSocial);
    const registroPatronal = trimUpper(req.body.registroPatronal).replace(/\s+/g, '').slice(0, 11);
    if (!razonSocial) throw new Error('Razón social requerida');
    if (!registroPatronal) throw new Error('Registro patronal IMSS obligatorio');

    const Empresa = await getEmpresaModel();
    const created = await Empresa.create({
      tenantId,
      razonSocial,
      nombreComercial: trimString(req.body.nombreComercial),
      rfc: trimUpper(req.body.rfc),
      domicilioFiscal: trimString(req.body.domicilioFiscal),
      ciudad: trimString(req.body.ciudad),
      estado: trimUpper(req.body.estado),
      codigoPostal: trimString(req.body.codigoPostal),
      giro: trimString(req.body.giro),
      telefono: trimString(req.body.telefono),
      registroPatronal,
      activo: true
    });

    await setSessionEmpresa(req, created._id);
    req.flash('success', 'Empresa creada. Ya puedes cargar sus trabajadores y períodos.');
    res.redirect('/config-empresa');
  } catch (err) {
    console.error('[empresa create]', err);
    req.flash('error', err.message || 'No se pudo crear la empresa');
    res.redirect('/config-empresa');
  }
}

module.exports = { showEmpresa, updateEmpresa, createEmpresa };

const getEmpresaModel = require('../models/empresa');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString, trimUpper } = require('../libs/formHelpers');

async function showEmpresa(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error) {
    return res.render('Configurations/empresa', { empresa: null, session: req.session });
  }
  res.render('Configurations/empresa', { empresa, session: req.session });
}

async function updateEmpresa(req, res) {
  try {
    const Empresa = await getEmpresaModel();
    const empresa = await Empresa.findOne({ tenantId: req.session.tenantId });
    if (!empresa) {
      req.flash('error', 'Empresa no encontrada para este tenant');
      return res.redirect('/config-empresa');
    }

    empresa.razonSocial = trimString(req.body.razonSocial) || empresa.razonSocial;
    empresa.nombreComercial = trimString(req.body.nombreComercial);
    empresa.rfc = trimUpper(req.body.rfc);
    empresa.domicilioFiscal = trimString(req.body.domicilioFiscal);
    empresa.ciudad = trimString(req.body.ciudad);
    empresa.estado = trimString(req.body.estado);
    empresa.codigoPostal = trimString(req.body.codigoPostal);
    empresa.giro = trimString(req.body.giro);
    empresa.telefono = trimString(req.body.telefono);
    if (req.body.primaRiesgoTrabajo !== undefined && req.body.primaRiesgoTrabajo !== '') {
      const prima = Number(req.body.primaRiesgoTrabajo);
      if (Number.isFinite(prima) && prima >= 0) {
        empresa.primaRiesgoTrabajo = Math.min(0.15, Math.max(0.005, prima));
      }
    }
    await empresa.save();

    req.flash('success', 'Datos de empresa actualizados');
    res.redirect('/config-empresa');
  } catch (err) {
    console.error('[empresa]', err);
    req.flash('error', 'No se pudieron guardar los datos de empresa');
    res.redirect('/config-empresa');
  }
}

module.exports = { showEmpresa, updateEmpresa };

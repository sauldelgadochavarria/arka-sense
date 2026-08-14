'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { parseOptionalObjectId } = require('../libs/formHelpers');
const getPeriodoNominaModel = require('../models/periodoNomina');
const getCorreoConfigModel = require('../models/correoConfig');
const { previewEnvio, enviarPeriodo } = require('../services/envioCorreoNominaService');
const { resolverCorreoConfig, modoDeConfig, maskCorreo } = require('../services/mailerService');

function flashRedirect(req, res, path, type, msg) {
  if (req.flash) req.flash(type, msg);
  return res.redirect(path);
}

function actor(session) {
  return {
    userId: session?.userid || session?.userId || '',
    userLabel: session?.user || session?.email || session?.username || ''
  };
}

async function loadPeriodosCerrados(tenantId, empresaId) {
  const Periodo = await getPeriodoNominaModel();
  return Periodo.find({ tenantId, empresaId, estatus: 'cerrado' })
    .sort({ anio: -1, numeroPeriodo: -1, fechaInicio: -1 })
    .limit(40)
    .lean();
}

async function wizard(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const periodos = empresa ? await loadPeriodosCerrados(req.session.tenantId, empresa._id) : [];
  const periodoId = parseOptionalObjectId(req.query.periodoId || req.body.periodoId);
  const correoConfigId = parseOptionalObjectId(req.query.correoConfigId || req.body.correoConfigId);
  let periodo = null;
  let preview = null;
  let runError = error || null;
  let perfiles = [];
  let mailCfg = null;

  if (empresa) {
    const Correo = await getCorreoConfigModel();
    perfiles = await Correo.find({ tenantId: req.session.tenantId, empresaId: empresa._id, activo: true })
      .sort({ esDefault: -1, codigo: 1 })
      .lean();
    mailCfg = await resolverCorreoConfig(req.session.tenantId, empresa._id, correoConfigId);
  }

  if (empresa && periodoId) {
    periodo = periodos.find((p) => String(p._id) === String(periodoId)) || null;
    if (!periodo) {
      runError = 'Período no encontrado o no está cerrado';
    } else {
      try {
        preview = await previewEnvio(req.session.tenantId, periodo);
      } catch (err) {
        runError = err.message || String(err);
      }
    }
  }

  res.render('Nomina/envio-correo', {
    session: req.session,
    empresa,
    error: runError,
    periodos,
    periodo,
    preview,
    perfiles: perfiles.map(maskCorreo),
    mailCfg: mailCfg ? maskCorreo(mailCfg) : null,
    modo: modoDeConfig(mailCfg)
  });
}

async function enviar(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const periodoId = parseOptionalObjectId(req.body.periodoId || req.params.periodoId);
  if (error || !empresa) {
    return flashRedirect(req, res, '/nomina/envio-correo', 'error', error || 'Sin empresa');
  }
  if (!periodoId) {
    return flashRedirect(req, res, '/nomina/envio-correo', 'error', 'Selecciona un período');
  }
  const alcance = req.body.alcance === 'todos' ? 'todos' : 'pendientes';
  const historicoId = parseOptionalObjectId(req.body.historicoId);
  const correoConfigId = parseOptionalObjectId(req.body.correoConfigId);
  const { userId, userLabel } = actor(req.session);
  const q = correoConfigId ? `&correoConfigId=${correoConfigId}` : '';
  try {
    const result = await enviarPeriodo({
      tenantId: req.session.tenantId,
      empresa,
      periodoId,
      alcance,
      userId,
      userLabel,
      historicoId,
      correoConfigId
    });
    const msg = historicoId
      ? result.enviadosAhora
        ? 'Recibo reenviado'
        : `No se pudo reenviar: ${result.resultados[0]?.error || 'error'}`
      : `Envío ${alcance}: ${result.enviadosAhora} ok, ${result.erroresAhora} error(es). Período: ${result.resumen.estatus}.`;
    const type = result.erroresAhora && !result.enviadosAhora ? 'error' : 'success';
    return flashRedirect(req, res, `/nomina/envio-correo?periodoId=${periodoId}${q}`, type, msg);
  } catch (err) {
    return flashRedirect(
      req,
      res,
      `/nomina/envio-correo?periodoId=${periodoId}${q}`,
      'error',
      err.message || 'No se pudo enviar'
    );
  }
}

module.exports = { wizard, enviar };

'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { CARGAS_INICIALES, getCargaByCodigo, buildCsvTemplate, listCargasParaHub } = require('../config/cargasIniciales');
const {
  crearYValidar,
  aplicarJob,
  listJobs,
  getJob
} = require('../services/cargas/cargaInicialService');

function sessionUser(req) {
  return {
    userId: String(req.session.userid || req.session.userId || ''),
    userLabel: String(req.session.user || req.session.userid || '')
  };
}

async function index(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) {
    return res.render('Configurations/cargas/index', {
      empresa: null,
      cargas: listCargasParaHub(),
      jobs: [],
      session: req.session
    });
  }
  const jobs = await listJobs(req.session.tenantId, { limit: 20 });
  res.render('Configurations/cargas/index', {
    empresa,
    cargas: listCargasParaHub(),
    jobs,
    session: req.session
  });
}

async function proximamenteCreditos(req, res) {
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  res.render('Configurations/cargas/proximamente', {
    empresa: empresa || null,
    titulo: 'Créditos y saldos',
    descripcion:
      'Carga inicial de Infonavit, préstamos y fondo de ahorro. Queda pendiente para no olvidarlo en el roadmap.',
    session: req.session
  });
}

async function showTipo(req, res) {
  const carga = getCargaByCodigo(req.params.tipo);
  if (!carga) {
    req.flash('error', 'Tipo de carga no encontrado');
    return res.redirect('/config-empresa/cargas');
  }
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  const jobs = empresa ? await listJobs(req.session.tenantId, { tipo: carga.codigo, limit: 15 }) : [];
  res.render('Configurations/cargas/tipo', {
    empresa,
    carga,
    jobs,
    session: req.session
  });
}

async function downloadTemplate(req, res) {
  const carga = getCargaByCodigo(req.params.tipo);
  if (!carga) {
    req.flash('error', 'Tipo no encontrado');
    return res.redirect('/config-empresa/cargas');
  }
  const csv = buildCsvTemplate(carga);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="plantilla-${carga.codigo}.csv"`);
  res.send(csv);
}

async function dryRun(req, res) {
  const carga = getCargaByCodigo(req.params.tipo);
  if (!carga || !carga.aplica) {
    req.flash('error', 'Tipo de carga no disponible');
    return res.redirect('/config-empresa/cargas');
  }
  try {
    const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
    if (!empresa) throw new Error('Sin empresa');
    const { userId, userLabel } = sessionUser(req);
    const job = await crearYValidar({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      tipo: carga.codigo,
      csvText: req.body.csvText,
      archivoNombre: req.body.archivoNombre || `${carga.codigo}.csv`,
      userId,
      userLabel
    });
    req.flash(
      job.filasError ? 'error' : 'success',
      `Validación: ${job.filasOk} OK · ${job.filasError} error(es)`
    );
    return res.redirect(`/config-empresa/cargas/jobs/${job._id}`);
  } catch (err) {
    req.flash('error', err.message || 'No se pudo validar el CSV');
    return res.redirect(`/config-empresa/cargas/${carga.codigo}`);
  }
}

async function showJob(req, res) {
  const job = await getJob(req.session.tenantId, req.params.id);
  if (!job) {
    req.flash('error', 'Job no encontrado');
    return res.redirect('/config-empresa/cargas');
  }
  const carga = getCargaByCodigo(job.tipo);
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  res.render('Configurations/cargas/job', {
    empresa,
    carga,
    job,
    session: req.session
  });
}

async function applyJobAction(req, res) {
  try {
    const { userId, userLabel } = sessionUser(req);
    const job = await aplicarJob(req.session.tenantId, req.params.id, { userId, userLabel });
    req.flash(
      job.estatus === 'ok' ? 'success' : 'error',
      `Aplicación: ${job.filasAplicadas || 0} fila(s) · estatus ${job.estatus}`
    );
    return res.redirect(`/config-empresa/cargas/jobs/${job._id}`);
  } catch (err) {
    req.flash('error', err.message || 'No se pudo aplicar');
    return res.redirect(`/config-empresa/cargas/jobs/${req.params.id}`);
  }
}

module.exports = {
  index,
  showTipo,
  downloadTemplate,
  dryRun,
  showJob,
  applyJobAction,
  proximamenteCreditos
};

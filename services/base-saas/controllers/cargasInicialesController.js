'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { getCargaByCodigo, buildCsvTemplate, listCargasParaHub } = require('../config/cargasIniciales');
const {
  crearYValidar,
  aplicarJob,
  listJobs,
  getJob
} = require('../services/cargas/cargaInicialService');
const { crearYValidarDesdeZip, parseImportOptions } = require('../services/cargas/cfdiNominaImportService');
const { encolarZipMasivo } = require('../services/cargas/cfdiNominaMasivoService');

function sessionUser(req) {
  return {
    userId: String(req.session.userid || req.session.userId || ''),
    userLabel: String(req.session.user || req.session.userid || '')
  };
}

async function index(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
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
  const { empresa } = await requireEmpresaForTenant(req);
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
  if (carga.codigo === 'cfdi_nomina_zip') {
    return showCfdiNomina(req, res);
  }
  if (carga.codigo === 'cfdi_nomina_zip_masivo') {
    return showCfdiNominaMasivo(req, res);
  }
  const { empresa } = await requireEmpresaForTenant(req);
  const jobs = empresa ? await listJobs(req.session.tenantId, { tipo: carga.codigo, limit: 15 }) : [];
  res.render('Configurations/cargas/tipo', {
    empresa,
    carga,
    jobs,
    session: req.session
  });
}

async function showCfdiNomina(req, res) {
  const carga = getCargaByCodigo('cfdi_nomina_zip');
  const { empresa } = await requireEmpresaForTenant(req);
  const jobs = empresa ? await listJobs(req.session.tenantId, { tipo: 'cfdi_nomina_zip', limit: 15 }) : [];
  const anioActual = new Date().getFullYear();
  res.render('Configurations/cargas/cfdi-nomina', {
    empresa,
    carga,
    jobs,
    anioActual,
    session: req.session
  });
}

async function showCfdiNominaMasivo(req, res) {
  const carga = getCargaByCodigo('cfdi_nomina_zip_masivo');
  const { empresa } = await requireEmpresaForTenant(req);
  const jobs = empresa
    ? await listJobs(req.session.tenantId, { tipo: 'cfdi_nomina_zip_masivo', limit: 15 })
    : [];
  const anioActual = new Date().getFullYear();
  res.render('Configurations/cargas/cfdi-nomina-masivo', {
    empresa,
    carga,
    jobs,
    anioActual,
    session: req.session
  });
}

async function dryRunCfdiZip(req, res) {
  try {
    const { empresa } = await requireEmpresaForTenant(req);
    if (!empresa) throw new Error('Sin empresa');
    if (!req.file?.buffer) throw new Error('Sube un archivo ZIP con los XML');
    const { userId, userLabel } = sessionUser(req);
    const anio = Number(req.body.anio) || new Date().getFullYear();
    const opciones = parseImportOptions(req.body);
    const job = await crearYValidarDesdeZip({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      zipBuffer: req.file.buffer,
      archivoNombre: req.file.originalname || 'cfdi.zip',
      anio,
      userId,
      userLabel,
      opciones
    });
    req.flash(
      job.filasOk ? 'success' : 'error',
      `Validación CFDI: ${job.filasOk} recibos OK · ${job.filasError} error(es) · omitidos ${(job.resumen && job.resumen.omitidos) || 0}`
    );
    return res.redirect(`/config-empresa/cargas/jobs/${job._id}`);
  } catch (err) {
    req.flash('error', err.message || 'No se pudo validar el ZIP');
    return res.redirect('/config-empresa/cargas/cfdi_nomina_zip');
  }
}

async function encolarCfdiZipMasivo(req, res) {
  try {
    const { empresa } = await requireEmpresaForTenant(req);
    if (!empresa) throw new Error('Sin empresa');
    if (!req.file?.path && !req.file?.buffer) throw new Error('Sube un archivo ZIP con los XML');
    const { userId, userLabel } = sessionUser(req);
    const anio = Number(req.body.anio) || new Date().getFullYear();
    const opciones = parseImportOptions(req.body);
    const job = await encolarZipMasivo({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      zipPath: req.file.path || null,
      zipBuffer: req.file.buffer || null,
      archivoNombre: req.file.originalname || 'cfdi-masivo.zip',
      anio,
      userId,
      userLabel,
      opciones
    });
    req.flash(
      'success',
      'ZIP encolado. El parseo corre en segundo plano; esta página se actualizará sola.'
    );
    return res.redirect(`/config-empresa/cargas/jobs/${job._id}`);
  } catch (err) {
    req.flash('error', err.message || 'No se pudo encolar el ZIP masivo');
    return res.redirect('/config-empresa/cargas/cfdi_nomina_zip_masivo');
  }
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
    const { empresa } = await requireEmpresaForTenant(req);
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
  const { empresa } = await requireEmpresaForTenant(req);
  res.render('Configurations/cargas/job', {
    empresa,
    carga,
    job,
    session: req.session
  });
}

/** JSON liviano para polling de progreso (masivo). */
async function jobStatusJson(req, res) {
  const job = await getJob(req.session.tenantId, req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
  return res.json({
    ok: true,
    id: String(job._id),
    tipo: job.tipo,
    estatus: job.estatus,
    modo: job.modo,
    filasOk: job.filasOk || 0,
    filasError: job.filasError || 0,
    filasAplicadas: job.filasAplicadas || 0,
    totalFilas: job.totalFilas || 0,
    notas: job.notas || '',
    progreso: job.progreso || null,
    aplicadoAt: job.aplicadoAt || null
  });
}

async function applyJobAction(req, res) {
  try {
    const { userId, userLabel } = sessionUser(req);
    const opcionesOverride =
      req.body && req.body.opcionesForm
        ? parseImportOptions(req.body)
        : null;
    const job = await aplicarJob(req.session.tenantId, req.params.id, {
      userId,
      userLabel,
      opcionesOverride
    });
    const asyncMasivo =
      job.tipo === 'cfdi_nomina_zip_masivo' &&
      ['encolado', 'aplicando'].includes(job.estatus);
    req.flash(
      asyncMasivo ? 'success' : job.estatus === 'ok' ? 'success' : 'error',
      asyncMasivo
        ? 'Apply encolado. El progreso se actualiza en esta página.'
        : `Aplicación: ${job.filasAplicadas || 0} fila(s) · estatus ${job.estatus}`
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
  showCfdiNomina,
  showCfdiNominaMasivo,
  downloadTemplate,
  dryRun,
  dryRunCfdiZip,
  encolarCfdiZipMasivo,
  showJob,
  jobStatusJson,
  applyJobAction,
  proximamenteCreditos
};

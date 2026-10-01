'use strict';

const { requireEmpresaForTenant, sessionSubsidiariaId } = require('../libs/tenantScope');
const { getCargaByCodigo, buildCsvTemplate, listCargasParaHub } = require('../config/cargasIniciales');
const {
  crearYValidar,
  aplicarJob,
  listJobs,
  getJob
} = require('../services/cargas/cargaInicialService');
const { crearYValidarDesdeZip, parseImportOptions } = require('../services/cargas/cfdiNominaImportService');
const { encolarZipMasivo } = require('../services/cargas/cfdiNominaMasivoService');
const { religarXmlDesdeZip } = require('../services/cargas/cfdiXmlReligarService');
const getCargaInicialJobModel = require('../models/cargaInicialJob');
const fs = require('fs');
const fsp = require('fs').promises;

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
  const jobs = await listJobs(req.session.tenantId, {
    empresaId: empresa._id,
    subsidiariaId: sessionSubsidiariaId(req),
    limit: 20
  });
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
  const jobs = empresa
    ? await listJobs(req.session.tenantId, {
        tipo: carga.codigo,
        empresaId: empresa._id,
        subsidiariaId: sessionSubsidiariaId(req),
        limit: 15
      })
    : [];
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
  const jobs = empresa
    ? await listJobs(req.session.tenantId, {
        tipo: 'cfdi_nomina_zip',
        empresaId: empresa._id,
        subsidiariaId: sessionSubsidiariaId(req),
        limit: 15
      })
    : [];
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
    ? await listJobs(req.session.tenantId, {
        tipo: 'cfdi_nomina_zip_masivo',
        empresaId: empresa._id,
        subsidiariaId: sessionSubsidiariaId(req),
        limit: 15
      })
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
      opciones,
      subsidiariaId: sessionSubsidiariaId(req)
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
      opciones,
      subsidiariaId: sessionSubsidiariaId(req)
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
      opcionesOverride,
      // Solo rellena si el job no guardó subsidiaria al subir el ZIP
      subsidiariaIdFallback: sessionSubsidiariaId(req)
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

/**
 * Religa XML a históricos ya importados (por UUID).
 * Acepta ZIP nuevo o reutiliza archivoPath del job si aún existe.
 */
async function religarXmlJobAction(req, res) {
  const tenantId = req.session.tenantId;
  const jobId = req.params.id;
  try {
    const { empresa } = await requireEmpresaForTenant(req);
    if (!empresa) throw new Error('Sin empresa');

    const Job = await getCargaInicialJobModel();
    const job = await Job.findOne({ _id: jobId, tenantId });
    if (!job) throw new Error('Job no encontrado');
    if (!['cfdi_nomina_zip', 'cfdi_nomina_zip_masivo'].includes(job.tipo)) {
      throw new Error('Solo aplica a jobs CFDI');
    }

    const zipPathUpload = req.file?.path || null;
    const zipBuffer = req.file?.buffer || null;
    const zipPathJob =
      job.archivoPath && fs.existsSync(job.archivoPath) ? job.archivoPath : null;

    if (!zipPathUpload && !zipBuffer && !zipPathJob) {
      throw new Error('Sube el ZIP original de los CFDI (el del job ya no está en disco)');
    }

    job.estatus = 'aplicando';
    job.notas = 'Religando XML a históricos…';
    job.progreso = {
      ...(job.progreso || {}),
      fase: 'religar_xml',
      procesados: 0,
      total: 0,
      exitos: 0,
      errores: 0,
      mensaje: 'Iniciando religado de XML…'
    };
    await job.save();

    const zipPath = zipPathUpload || zipPathJob || null;
    const empresaId = empresa._id;
    const jid = job._id;

    setImmediate(() => {
      (async () => {
        try {
          const result = await religarXmlDesdeZip({
            tenantId,
            empresaId,
            zipPath,
            zipBuffer: zipPath ? null : zipBuffer,
            jobId: jid,
            onProgress: async (p) => {
              await Job.updateOne(
                { _id: jid },
                {
                  $set: {
                    'progreso.fase': 'religar_xml',
                    'progreso.total': p.total,
                    'progreso.procesados': p.procesados,
                    'progreso.exitos': p.ligados,
                    'progreso.mensaje': p.mensaje
                  }
                }
              );
            }
          });
          await Job.updateOne(
            { _id: jid },
            {
              $set: {
                estatus: 'ok',
                notas: `XML religados: ${result.ligados} · ya tenían ${result.yaTenian} · sin histórico ${result.sinHistorico} · parse err ${result.parseError} · errores ${result.errores}`,
                'progreso.fase': 'religar_xml_ok',
                'progreso.mensaje': `Listo · ${result.ligados} XML ligados`,
                'progreso.exitos': result.ligados,
                'resumen.religarXml': result
              }
            }
          );
        } catch (err) {
          await Job.updateOne(
            { _id: jid },
            {
              $set: {
                estatus: 'parcial',
                notas: `Error al religar XML: ${err.message || err}`,
                'progreso.fase': 'religar_xml_error',
                'progreso.mensaje': err.message || 'error'
              }
            }
          );
        } finally {
          if (zipPathUpload) {
            await fsp.unlink(zipPathUpload).catch(() => {});
          }
        }
      })().catch((err) => console.error('[religar-xml]', jid, err));
    });

    req.flash('success', 'Religado de XML en curso. El progreso se actualiza en esta página.');
    return res.redirect(`/config-empresa/cargas/jobs/${jobId}`);
  } catch (err) {
    req.flash('error', err.message || 'No se pudo religar XML');
    return res.redirect(`/config-empresa/cargas/jobs/${jobId}`);
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
  religarXmlJobAction,
  proximamenteCreditos
};

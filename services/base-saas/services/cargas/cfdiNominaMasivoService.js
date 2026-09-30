'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const getCargaInicialJobModel = require('../../models/cargaInicialJob');
const getCargaCfdiStagingModel = require('../../models/cargaCfdiStaging');
const getEmpresaModel = require('../../models/empresa');
const { parseNomina12Xml } = require('../cfdi/nomina12Parser');
const {
  parseImportOptions,
  opcionesLabels,
  aplicarJobCfdi
} = require('./cfdiNominaImportService');

// Re-export opcionesLabels if not exported - need to check
const MAX_ZIP_BYTES = 500 * 1024 * 1024;
const MAX_XML_FILES = 50000;
const BATCH_STAGING = 150;
const PROGRESS_EVERY = 100;

function docsRoot() {
  return process.env.DOCUMENTOS_PATH || process.env.BASE_DOCUMENTOS_PATH || '/data/documentos';
}

function zipDir(tenantId) {
  return path.join(docsRoot(), 'cargas-cfdi', String(tenantId || 'unknown'));
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function setProgreso(jobId, patch) {
  const Job = await getCargaInicialJobModel();
  const $set = {};
  for (const [k, v] of Object.entries(patch || {})) {
    $set[`progreso.${k}`] = v;
  }
  if (patch.estatus) $set.estatus = patch.estatus;
  if (patch.notas != null) $set.notas = patch.notas;
  await Job.updateOne({ _id: jobId }, { $set });
}

/**
 * Encola ZIP masivo: guarda archivo y deja job en `encolado`.
 * Acepta `zipBuffer` o `zipPath` (multer disk).
 */
async function encolarZipMasivo({
  tenantId,
  empresaId,
  zipBuffer = null,
  zipPath = null,
  archivoNombre = 'cfdi-masivo.zip',
  anio = new Date().getFullYear(),
  userId = '',
  userLabel = '',
  opciones: opcionesIn = {}
}) {
  const hasBuf = Buffer.isBuffer(zipBuffer) && zipBuffer.length;
  const hasPath = zipPath && fs.existsSync(zipPath);
  if (!hasBuf && !hasPath) throw new Error('ZIP vacío');
  if (hasBuf && zipBuffer.length > MAX_ZIP_BYTES) {
    throw new Error(`ZIP demasiado grande (máx ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB)`);
  }
  if (hasPath) {
    const st = await fsp.stat(zipPath);
    if (st.size > MAX_ZIP_BYTES) {
      throw new Error(`ZIP demasiado grande (máx ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB)`);
    }
  }

  const opciones = parseImportOptions(opcionesIn);
  const Job = await getCargaInicialJobModel();
  const job = await Job.create({
    tenantId,
    empresaId,
    tipo: 'cfdi_nomina_zip_masivo',
    estatus: 'encolado',
    modo: 'dry_run',
    archivoNombre: archivoNombre || 'cfdi-masivo.zip',
    userId,
    userLabel,
    notas: 'Encolado: esperando worker de parseo…',
    progreso: {
      fase: 'espera',
      total: 0,
      procesados: 0,
      exitos: 0,
      errores: 0,
      omitidos: 0,
      mensaje: 'En cola'
    },
    resumen: { anio, opciones, async: true }
  });

  const dir = zipDir(tenantId);
  await ensureDir(dir);
  const archivoPath = path.join(dir, `${job._id}.zip`);
  if (hasPath) {
    await fsp.rename(zipPath, archivoPath).catch(async () => {
      await fsp.copyFile(zipPath, archivoPath);
      await fsp.unlink(zipPath).catch(() => {});
    });
  } else {
    await fsp.writeFile(archivoPath, zipBuffer);
  }
  job.archivoPath = archivoPath;
  await job.save();

  setImmediate(() => {
    procesarParseMasivo(job._id).catch((err) => {
      console.error('[cfdi-masivo parse]', job._id, err);
    });
  });

  return job;
}

async function procesarParseMasivo(jobId) {
  const Job = await getCargaInicialJobModel();
  const Staging = await getCargaCfdiStagingModel();

  const claimed = await Job.findOneAndUpdate(
    { _id: jobId, tipo: 'cfdi_nomina_zip_masivo', estatus: { $in: ['encolado', 'parseando'] } },
    {
      $set: {
        estatus: 'parseando',
        'progreso.fase': 'parse',
        'progreso.mensaje': 'Abriendo ZIP…',
        notas: 'Parseando XML en segundo plano…'
      }
    },
    { new: true }
  );
  if (!claimed) return;

  const anio = Number(claimed.resumen?.anio) || new Date().getFullYear();
  const opciones = parseImportOptions(claimed.resumen?.opciones || {});

  try {
    if (!claimed.archivoPath || !fs.existsSync(claimed.archivoPath)) {
      throw new Error('Archivo ZIP no encontrado en disco');
    }

    // Reintento seguro: limpia staging previo del job
    await Staging.deleteMany({ jobId: claimed._id });

    const zip = new AdmZip(claimed.archivoPath);
    const entries = zip.getEntries().filter((e) => {
      if (e.isDirectory) return false;
      const name = e.entryName || '';
      if (!/\.xml$/i.test(name)) return false;
      if (/__MACOSX|\.DS_Store/i.test(name)) return false;
      return true;
    });

    if (!entries.length) throw new Error('El ZIP no contiene archivos .xml');
    if (entries.length > MAX_XML_FILES) {
      throw new Error(`Demasiados XML (${entries.length}). Máximo ${MAX_XML_FILES}.`);
    }

    await Job.updateOne(
      { _id: jobId },
      {
        $set: {
          totalFilas: entries.length,
          'progreso.total': entries.length,
          'progreso.procesados': 0,
          'progreso.mensaje': `0 / ${entries.length}`
        }
      }
    );

    const Empresa = await getEmpresaModel();
    const empresa = await Empresa.findById(claimed.empresaId).lean();
    const rfcEmpresa = String(empresa?.rfc || '').toUpperCase();

    const byUuid = new Set();
    const errores = [];
    const omitidosMuestra = [];
    const muestraOk = [];
    const deptos = new Set();
    const puestos = new Set();
    const conceptos = new Map();
    let exitos = 0;
    let omitidos = 0;
    let errCount = 0;
    let totalNeto = 0;
    let noCuadra = 0;
    let batch = [];
    let fila = 0;
    let rfcEmisorMuestra = '';

    async function flushBatch() {
      if (!batch.length) return;
      try {
        await Staging.insertMany(batch, { ordered: false });
      } catch (_) {
        /* duplicados uuid ok */
      }
      batch = [];
    }

    for (const e of entries) {
      fila += 1;
      const name = e.entryName || `xml_${fila}`;
      let text = '';
      try {
        text = e.getData().toString('utf8');
      } catch (err) {
        errCount += 1;
        if (errores.length < 80) {
          errores.push({ fila, campo: 'xml', mensaje: err.message || 'read_error', valor: name });
        }
        continue;
      }

      const parsed = parseNomina12Xml(text, { anioFiltro: anio });
      if (!parsed.ok) {
        if (parsed.error === 'fuera_de_anio') {
          omitidos += 1;
          if (omitidosMuestra.length < 20) {
            omitidosMuestra.push({
              fila,
              archivo: name,
              motivo: `año ${parsed.anio}`,
              uuid: parsed.uuid || ''
            });
          }
        } else {
          errCount += 1;
          if (errores.length < 80) {
            errores.push({
              fila,
              campo: 'xml',
              mensaje: parsed.error || 'error_parse',
              valor: name
            });
          }
        }
      } else {
        const d = parsed.data;
        if (opciones.excluirExtraordinarias && String(d.tipoNomina).toUpperCase() === 'E') {
          omitidos += 1;
          if (omitidosMuestra.length < 20) {
            omitidosMuestra.push({ fila, archivo: name, motivo: 'extraordinaria', uuid: d.uuid });
          }
        } else if (byUuid.has(d.uuid)) {
          omitidos += 1;
          if (omitidosMuestra.length < 20) {
            omitidosMuestra.push({ fila, archivo: name, motivo: 'uuid_dup', uuid: d.uuid });
          }
        } else {
          byUuid.add(d.uuid);
          if (rfcEmpresa && d.emisor.rfc && rfcEmpresa !== d.emisor.rfc) {
            d.bitacora.push({
              tipo: 'rfc_emisor_distinto',
              detalle: `${d.emisor.rfc} vs ${rfcEmpresa}`
            });
          }
          if (!rfcEmisorMuestra) rfcEmisorMuestra = d.emisor.rfc || '';
          totalNeto += d.totales.totalXml || 0;
          if (!d.totales.cuadra) noCuadra += 1;
          if (d.empleado.departamento) deptos.add(String(d.empleado.departamento).toUpperCase());
          if (d.empleado.puesto) puestos.add(String(d.empleado.puesto).toUpperCase());
          for (const c of d.conceptos || []) {
            const k = `${c.tipo}|${c.conceptoCodigo}`;
            if (!conceptos.has(k)) conceptos.set(k, c);
          }
          batch.push({
            tenantId: claimed.tenantId,
            jobId: claimed._id,
            uuid: d.uuid,
            anio: d.anio,
            payload: d,
            bitacora: d.bitacora || [],
            estatus: 'ok'
          });
          exitos += 1;
          if (muestraOk.length < 12) {
            muestraOk.push({
              uuid: d.uuid,
              numEmpleado: d.empleado.numEmpleado,
              nombre: d.empleado.nombre,
              neto: d.totales.totalXml,
              fechaPago: d.fechaPago,
              cuadra: d.totales.cuadra
            });
          }
          if (batch.length >= BATCH_STAGING) await flushBatch();
        }
      }

      if (fila % PROGRESS_EVERY === 0 || fila === entries.length) {
        await Job.updateOne(
          { _id: jobId },
          {
            $set: {
              'progreso.procesados': fila,
              'progreso.exitos': exitos,
              'progreso.errores': errCount,
              'progreso.omitidos': omitidos,
              'progreso.mensaje': `${fila} / ${entries.length} · OK ${exitos}`
            }
          }
        );
      }
    }

    await flushBatch();

    const lab = opcionesLabels(opciones);

    const estatus = exitos === 0 ? 'error' : 'validado';
    await Job.updateOne(
      { _id: jobId },
      {
        $set: {
          estatus,
          filasOk: exitos,
          filasError: errCount,
          errores,
          muestraOk,
          notas:
            exitos > 0
              ? `Parse async OK: ${exitos} recibos · omitidos ${omitidos} · errores ${errCount}. Listo para aplicar.`
              : 'Ningún XML válido.',
          'progreso.fase': 'listo',
          'progreso.procesados': entries.length,
          'progreso.exitos': exitos,
          'progreso.errores': errCount,
          'progreso.omitidos': omitidos,
          'progreso.mensaje': 'Parse terminado',
          resumen: {
            anio,
            opciones,
            opcionesResumen: lab,
            async: true,
            xmlEnZip: entries.length,
            recibosOk: exitos,
            omitidos,
            omitidosMuestra,
            conceptosDetectados: conceptos.size,
            conceptosMuestra: [...conceptos.values()].slice(0, 30),
            departamentos: [...deptos].sort().slice(0, 200),
            puestos: [...puestos].sort().slice(0, 200),
            totalNeto: Math.round(totalNeto * 100) / 100,
            recibosNoCuadran: noCuadra,
            rfcEmpresa,
            rfcEmisorMuestra,
            planAplicacion: {
              empresa: opciones.importEmpresa,
              empleados: opciones.importEmpleados ? 'según modo' : 'omitido',
              organizacion: opciones.importOrganizacion ? `${deptos.size}/${puestos.size}` : 'omitido',
              conceptos: opciones.importConceptos ? `${conceptos.size}` : 'omitido',
              historico: opciones.importHistorico ? `${exitos}` : 'omitido',
              acumulados: opciones.importAcumulados ? 'sí' : 'omitido'
            },
            conciliacion: {
              recibosOk: exitos,
              recibosOmitidos: omitidos,
              recibosError: errCount
            }
          }
        }
      }
    );
  } catch (err) {
    await Job.updateOne(
      { _id: jobId },
      {
        $set: {
          estatus: 'error',
          notas: err.message || 'Error en parse masivo',
          'progreso.fase': 'error',
          'progreso.mensaje': err.message || 'error'
        }
      }
    );
  }
}

async function encolarApplyMasivo(tenantId, jobId, { userId = '', userLabel = '', opcionesOverride = null } = {}) {
  const Job = await getCargaInicialJobModel();
  const job = await Job.findOne({ _id: jobId, tenantId, tipo: 'cfdi_nomina_zip_masivo' });
  if (!job) throw new Error('Job masivo no encontrado');
  // Permitir reaplicar jobs ya terminados (ok/parcial) para completar bloques (p.ej. períodos)
  if (!['validado', 'parcial', 'ok', 'error'].includes(job.estatus)) {
    throw new Error(`El job no está listo para aplicar (estatus: ${job.estatus})`);
  }
  if (['encolado', 'parseando', 'aplicando'].includes(job.estatus) && job.modo === 'aplicar') {
    throw new Error('Ya hay un apply en curso para este job');
  }

  const opciones = parseImportOptions(opcionesOverride || job.resumen?.opciones || {});
  job.estatus = 'encolado';
  job.modo = 'aplicar';
  job.resumen = { ...(job.resumen || {}), opciones, applyAsync: true };
  job.progreso = {
    fase: 'espera_apply',
    total: job.filasOk || 0,
    procesados: 0,
    exitos: 0,
    errores: 0,
    omitidos: 0,
    mensaje: 'Apply en cola'
  };
  job.notas = 'Encolado: apply masivo…';
  job.userId = userId || job.userId;
  job.userLabel = userLabel || job.userLabel;
  await job.save();

  setImmediate(() => {
    procesarApplyMasivo(job._id).catch((err) => {
      console.error('[cfdi-masivo apply]', job._id, err);
    });
  });

  return job.toObject ? job.toObject() : job;
}

async function procesarApplyMasivo(jobId) {
  const Job = await getCargaInicialJobModel();
  const claimed = await Job.findOneAndUpdate(
    {
      _id: jobId,
      tipo: 'cfdi_nomina_zip_masivo',
      estatus: { $in: ['encolado', 'aplicando'] },
      modo: 'aplicar'
    },
    {
      $set: {
        estatus: 'aplicando',
        'progreso.fase': 'apply',
        'progreso.mensaje': 'Aplicando…',
        notas: 'Aplicando en segundo plano…'
      }
    },
    { new: true }
  );
  if (!claimed) return;

  try {
    // Reutiliza el apply del flujo lite (misma staging / mismas reglas) con progreso
    await aplicarJobCfdi(claimed.tenantId, claimed._id, {
      userId: claimed.userId,
      userLabel: claimed.userLabel,
      opcionesOverride: claimed.resumen?.opciones || null,
      allowTipos: ['cfdi_nomina_zip', 'cfdi_nomina_zip_masivo'],
      onProgress: async (p) => {
        await Job.updateOne(
          { _id: jobId },
          {
            $set: {
              'progreso.fase': 'apply',
              'progreso.total': p.total || 0,
              'progreso.procesados': p.procesados || 0,
              'progreso.exitos': p.exitos || 0,
              'progreso.errores': p.errores || 0,
              'progreso.omitidos': p.omitidos || 0,
              'progreso.mensaje': p.mensaje || 'Aplicando…',
              filasAplicadas: p.exitos || 0
            }
          }
        );
      }
    });
    await Job.updateOne(
      { _id: jobId },
      {
        $set: {
          'progreso.fase': 'done',
          'progreso.mensaje': 'Apply terminado'
        }
      }
    );
  } catch (err) {
    await Job.updateOne(
      { _id: jobId },
      {
        $set: {
          estatus: 'error',
          notas: err.message || 'Error en apply masivo',
          'progreso.fase': 'error',
          'progreso.mensaje': err.message || 'error'
        }
      }
    );
  }
}

async function recuperarJobsMasivosPendientes() {
  const Job = await getCargaInicialJobModel();
  const pendientes = await Job.find({
    tipo: 'cfdi_nomina_zip_masivo',
    estatus: { $in: ['encolado', 'parseando', 'aplicando'] }
  })
    .sort({ createdAt: 1 })
    .limit(10)
    .lean();

  for (const job of pendientes) {
    if (job.modo === 'aplicar' || job.estatus === 'aplicando') {
      setImmediate(() => {
        procesarApplyMasivo(job._id).catch((e) => console.error('[cfdi-masivo recovery apply]', e));
      });
    } else {
      setImmediate(() => {
        procesarParseMasivo(job._id).catch((e) => console.error('[cfdi-masivo recovery parse]', e));
      });
    }
  }
}

let workerIniciado = false;
function iniciarWorkerCfdiMasivo() {
  if (workerIniciado) return;
  workerIniciado = true;
  setTimeout(() => {
    recuperarJobsMasivosPendientes().catch((err) => console.error('[cfdi-masivo worker]', err));
  }, 4000);
}

module.exports = {
  encolarZipMasivo,
  encolarApplyMasivo,
  procesarParseMasivo,
  procesarApplyMasivo,
  iniciarWorkerCfdiMasivo,
  MAX_ZIP_BYTES,
  MAX_XML_FILES
};

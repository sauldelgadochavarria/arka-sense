'use strict';

/**
 * Religa XML CFDI a históricos ya importados (por UUID), sin reaplicar la carga completa.
 */

const fs = require('fs');
const AdmZip = require('adm-zip');
const getNominaHistoricoReciboModel = require('../../models/nominaHistoricoRecibo');
const getCargaCfdiStagingModel = require('../../models/cargaCfdiStaging');
const { parseNomina12Xml } = require('../cfdi/nomina12Parser');
const { guardarCfdiArchivo } = require('../cfdiArchivoService');

const MAX_ZIP_BYTES = 500 * 1024 * 1024;

function extractXmlEntries(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const out = [];
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const name = e.entryName || '';
    if (!/\.xml$/i.test(name)) continue;
    if (name.includes('__MACOSX') || /(^|\/)\./.test(name)) continue;
    try {
      out.push({ name, text: e.getData().toString('utf8') });
    } catch (_) {
      /* skip */
    }
  }
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {object} [opts.empresaId]
 * @param {Buffer} [opts.zipBuffer]
 * @param {string} [opts.zipPath]
 * @param {string|object} [opts.jobId] — si se indica, también actualiza staging.xmlText
 * @param {function} [opts.onProgress]
 */
async function religarXmlDesdeZip({
  tenantId,
  empresaId = null,
  zipBuffer = null,
  zipPath = null,
  jobId = null,
  onProgress = null
} = {}) {
  if (!tenantId) throw new Error('tenantId requerido');

  let buf = zipBuffer;
  if (!buf && zipPath) {
    if (!fs.existsSync(zipPath)) throw new Error(`ZIP no encontrado: ${zipPath}`);
    buf = fs.readFileSync(zipPath);
  }
  if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('ZIP vacío');
  if (buf.length > MAX_ZIP_BYTES) {
    throw new Error(`ZIP demasiado grande (máx ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB)`);
  }

  const entries = extractXmlEntries(buf);
  if (!entries.length) throw new Error('El ZIP no contiene archivos .xml');

  const Historico = await getNominaHistoricoReciboModel();
  const Staging = jobId ? await getCargaCfdiStagingModel() : null;

  let ligados = 0;
  let yaTenian = 0;
  let sinHistorico = 0;
  let parseError = 0;
  let errores = 0;
  const muestraErrores = [];

  for (let i = 0; i < entries.length; i += 1) {
    const { name, text } = entries[i];
    if (typeof onProgress === 'function' && (i % 200 === 0 || i + 1 === entries.length)) {
      await onProgress({
        total: entries.length,
        procesados: i + 1,
        ligados,
        mensaje: `${i + 1} / ${entries.length} · ligados ${ligados}`
      });
    }

    const parsed = parseNomina12Xml(text);
    if (!parsed.ok || !parsed.data?.uuid) {
      parseError += 1;
      continue;
    }
    const uuid = String(parsed.data.uuid).toUpperCase();
    const xmlRaw = String(text || '').trim();
    if (!xmlRaw) continue;

    try {
      if (Staging) {
        await Staging.updateOne(
          { jobId, uuid },
          { $set: { xmlText: xmlRaw } }
        ).catch(() => {});
      }

      const hist = await Historico.findOne({
        tenantId,
        $or: [{ claveImportacion: uuid }, { 'timbrado.uuid': uuid }]
      })
        .select('_id empleadoId empresaId periodoId timbrado')
        .lean();

      if (!hist) {
        sinHistorico += 1;
        continue;
      }

      if (hist.timbrado?.archivoXmlId) {
        yaTenian += 1;
        // Igual reescribe el binario por si quedó huérfano
      }

      const xmlDoc = await guardarCfdiArchivo({
        tenantId,
        empresaId: empresaId || hist.empresaId || null,
        periodoId: hist.periodoId || null,
        historicoId: hist._id,
        empleadoId: hist.empleadoId || null,
        uuid,
        tipo: 'xml',
        contentType: 'application/xml; charset=utf-8',
        nombreArchivo: `${uuid}.xml`,
        data: xmlRaw
      });

      if (xmlDoc?._id) {
        await Historico.updateOne(
          { _id: hist._id },
          { $set: { 'timbrado.archivoXmlId': xmlDoc._id, 'timbrado.uuid': uuid } }
        );
        ligados += 1;
      }
    } catch (err) {
      errores += 1;
      if (muestraErrores.length < 40) {
        muestraErrores.push({
          archivo: name,
          uuid,
          mensaje: err.message || 'error'
        });
      }
    }

    if (i % 50 === 0) {
      await new Promise((r) => setImmediate(r));
    }
  }

  return {
    xmlEnZip: entries.length,
    ligados,
    yaTenian,
    sinHistorico,
    parseError,
    errores,
    muestraErrores
  };
}

module.exports = {
  religarXmlDesdeZip,
  extractXmlEntries
};

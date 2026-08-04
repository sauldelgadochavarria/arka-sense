'use strict';

const getCargaInicialJobModel = require('../../models/cargaInicialJob');
const { getCargaByCodigo } = require('../../config/cargasIniciales');
const { parseCsv } = require('./csvParse');
const empleadosH = require('./handlers/empleados');
const historialH = require('./handlers/historialLaboral');
const acumuladosH = require('./handlers/acumulados');
const historicoH = require('./handlers/historicoRecibos');

const MAX_CSV_CHARS = 1_500_000;
const MAX_ERRORES_UI = 80;
const MAX_MUESTRA = 15;

function clipErrores(errores) {
  return (errores || []).slice(0, MAX_ERRORES_UI);
}

async function validateByTipo(tipo, tenantId, empresaId, rows) {
  switch (tipo) {
    case 'empleados':
      return empleadosH.validateEmpleados(tenantId, empresaId, rows);
    case 'historial_laboral':
      return historialH.validateHistorial(tenantId, empresaId, rows);
    case 'acumulados':
      return acumuladosH.validateAcumulados(tenantId, empresaId, rows);
    case 'historico_recibos':
      return historicoH.validateHistorico(tenantId, empresaId, rows);
    default:
      throw new Error(`Tipo de carga no soportado: ${tipo}`);
  }
}

async function applyByTipo(tipo, tenantId, empresaId, validos, userLabel) {
  switch (tipo) {
    case 'empleados':
      return empleadosH.applyEmpleados(tenantId, empresaId, validos);
    case 'historial_laboral':
      return historialH.applyHistorial(tenantId, empresaId, validos, userLabel);
    case 'acumulados':
      return acumuladosH.applyAcumulados(tenantId, empresaId, validos);
    case 'historico_recibos':
      return historicoH.applyHistorico(tenantId, empresaId, validos);
    default:
      throw new Error(`Tipo de carga no soportado: ${tipo}`);
  }
}

async function crearYValidar({
  tenantId,
  empresaId,
  tipo,
  csvText,
  archivoNombre = '',
  userId = '',
  userLabel = ''
}) {
  const meta = getCargaByCodigo(tipo);
  if (!meta || !meta.aplica) throw new Error('Tipo de carga no disponible');

  const contenido = String(csvText || '');
  if (!contenido.trim()) throw new Error('El CSV está vacío');
  if (contenido.length > MAX_CSV_CHARS) {
    throw new Error(`CSV demasiado grande (máx ~${Math.round(MAX_CSV_CHARS / 1000)} KB)`);
  }

  const { headers, rows } = parseCsv(contenido);
  if (!headers.length || !rows.length) throw new Error('No se detectaron filas de datos');

  const faltantes = meta.columnas.filter((c) => !headers.includes(c));
  // Solo exigir columnas clave mínimas (las primeras 3 del catálogo)
  const clave = meta.columnas.slice(0, Math.min(3, meta.columnas.length));
  const claveFaltante = clave.filter((c) => !headers.includes(c));
  if (claveFaltante.length) {
    throw new Error(`Faltan columnas obligatorias: ${claveFaltante.join(', ')}`);
  }

  const result = await validateByTipo(tipo, tenantId, empresaId, rows);
  const errores = clipErrores(result.errores);
  const filasOk = result.validos.length;
  const filasError = result.errores.length;
  const estatus = filasError === 0 ? 'validado' : filasOk > 0 ? 'parcial' : 'error';

  const Job = await getCargaInicialJobModel();
  const doc = await Job.create({
    tenantId,
    empresaId,
    tipo,
    estatus: estatus === 'parcial' && filasOk > 0 ? 'validado' : estatus,
    modo: 'dry_run',
    archivoNombre: archivoNombre || `${tipo}.csv`,
    contenidoCsv: contenido,
    totalFilas: rows.length,
    filasOk,
    filasError,
    errores,
    resumen: {
      ...(result.resumen || {}),
      columnasDetectadas: headers,
      columnasCatalogoFaltantes: faltantes
    },
    muestraOk: result.validos.slice(0, MAX_MUESTRA),
    userId,
    userLabel,
    notas: filasError
      ? `Dry-run con ${filasError} error(es). Puedes aplicar solo las filas válidas.`
      : 'Dry-run OK. Listo para aplicar.'
  });

  // Guardar validos en resumen para apply (sin reparsear lógica)
  doc.resumen = { ...doc.resumen, _validos: result.validos };
  await doc.save();

  return doc;
}

async function aplicarJob(tenantId, jobId, { userId = '', userLabel = '' } = {}) {
  const Job = await getCargaInicialJobModel();
  const job = await Job.findOne({ _id: jobId, tenantId });
  if (!job) throw new Error('Job no encontrado');
  if (!['validado', 'parcial'].includes(job.estatus) && job.estatus !== 'ok') {
    // permitir reintento solo si validado
  }
  if (!['validado', 'parcial'].includes(job.estatus)) {
    throw new Error(`El job no está listo para aplicar (estatus: ${job.estatus})`);
  }

  let validos = job.resumen && job.resumen._validos;
  if (!Array.isArray(validos) || !validos.length) {
    const { rows } = parseCsv(job.contenidoCsv);
    const result = await validateByTipo(job.tipo, tenantId, job.empresaId, rows);
    validos = result.validos;
    if (result.errores.length && !validos.length) {
      throw new Error('No hay filas válidas para aplicar');
    }
  }

  job.estatus = 'aplicando';
  job.modo = 'aplicar';
  await job.save();

  const applied = await applyByTipo(job.tipo, tenantId, job.empresaId, validos, userLabel || job.userLabel);
  const erroresApply = clipErrores(applied.errores || []);

  job.filasAplicadas = applied.aplicadas || 0;
  job.errores = [...(job.errores || []), ...erroresApply].slice(0, MAX_ERRORES_UI);
  job.filasError = (job.filasError || 0) + erroresApply.length;
  job.aplicadoAt = new Date();
  job.userId = userId || job.userId;
  job.userLabel = userLabel || job.userLabel;
  job.estatus =
    erroresApply.length === 0 ? 'ok' : applied.aplicadas > 0 ? 'parcial' : 'error';
  job.notas = `Aplicadas ${applied.aplicadas} fila(s).`;
  // no guardar _validos eternos enormes
  if (job.resumen && job.resumen._validos) {
    const { _validos, ...rest } = job.resumen;
    job.resumen = { ...rest, aplicadas: applied.aplicadas };
  }
  await job.save();
  return job;
}

async function listJobs(tenantId, { tipo = null, limit = 30 } = {}) {
  const Job = await getCargaInicialJobModel();
  const q = { tenantId };
  if (tipo) q.tipo = tipo;
  return Job.find(q).sort({ createdAt: -1 }).limit(limit).lean();
}

async function getJob(tenantId, jobId) {
  const Job = await getCargaInicialJobModel();
  return Job.findOne({ _id: jobId, tenantId }).lean();
}

module.exports = {
  crearYValidar,
  aplicarJob,
  listJobs,
  getJob
};

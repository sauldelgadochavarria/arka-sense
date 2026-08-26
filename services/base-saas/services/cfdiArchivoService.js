'use strict';

const crypto = require('crypto');
const getNominaCfdiArchivoModel = require('../models/nominaCfdiArchivo');
const { buildCfdiNominaPayload } = require('./cfdi/nomina12Builder');

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data == null) return Buffer.alloc(0);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(data);
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * XML CFDI 4.0 + Nómina 1.2 (simulación / pre-timbrado).
 * Usa el builder unificado; incluye SeparacionIndemnizacion cuando aplica.
 */
function buildXmlSimulado({
  uuid,
  serie = '',
  folio = '',
  fechaTimbrado = new Date(),
  rfcEmisor = '',
  nombreEmisor = '',
  rfcReceptor = '',
  nombreReceptor = '',
  total = 0,
  tipoNomina = 'O',
  fechaPago = null,
  fechaInicialPago = null,
  fechaFinalPago = null,
  numDiasPagados = 0,
  separacionIndemnizacion = null,
  percepcionesXml = '',
  deduccionesXml = ''
}) {
  void percepcionesXml;
  void deduccionesXml;

  const payload = buildCfdiNominaPayload({
    empresa: {
      rfc: rfcEmisor,
      razonSocial: nombreEmisor,
      codigoPostal: '00000'
    },
    empleado: { rfc: rfcReceptor, nombre: nombreReceptor },
    periodo: {
      tipoNomina: tipoNomina === 'E' ? 'finiquito' : 'ordinaria',
      fechaInicio: fechaInicialPago || fechaTimbrado,
      fechaFin: fechaFinalPago || fechaTimbrado,
      fechaPago: fechaPago || fechaTimbrado,
      diasPeriodo: numDiasPagados
    },
    recibo: { netoPagar: total, diasPagados: numDiasPagados },
    conceptos: [],
    separacionIndemnizacion,
    serie,
    folio,
    fechaEmision: fechaTimbrado,
    incluirTfdSimulado: true,
    uuidSimulado: uuid
  });

  return payload.xml;
}

async function guardarCfdiArchivo({
  tenantId,
  empresaId = null,
  periodoId = null,
  loteId = null,
  historicoId = null,
  reciboId = null,
  empleadoId = null,
  uuid = '',
  tipo,
  contentType,
  nombreArchivo,
  data
}) {
  if (!tenantId) throw new Error('tenantId requerido');
  if (!['xml', 'pdf'].includes(tipo)) throw new Error('tipo debe ser xml|pdf');
  if (!historicoId && !reciboId) throw new Error('historicoId o reciboId requerido');

  const contenido = toBuffer(data);
  if (!contenido.length) throw new Error(`Archivo ${tipo} vacío`);

  const CfdiArchivo = await getNominaCfdiArchivoModel();
  const filter = historicoId
    ? { tenantId, historicoId, tipo }
    : { tenantId, reciboId, tipo, historicoId: null };

  const payload = {
    tenantId,
    empresaId,
    periodoId,
    loteId,
    historicoId: historicoId || null,
    reciboId: reciboId || null,
    empleadoId,
    uuid: String(uuid || '').toUpperCase(),
    tipo,
    contentType: contentType || (tipo === 'xml' ? 'application/xml' : 'application/pdf'),
    nombreArchivo: nombreArchivo || `${tipo}_${uuid || 'cfdi'}`,
    tamanio: contenido.length,
    sha256: sha256Hex(contenido),
    contenido
  };

  const doc = await CfdiArchivo.findOneAndUpdate(
    filter,
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).select('_id tipo nombreArchivo tamanio sha256 contentType uuid historicoId reciboId');

  return doc;
}

async function metaCfdiArchivo(tenantId, archivoId) {
  const CfdiArchivo = await getNominaCfdiArchivoModel();
  return CfdiArchivo.findOne({ _id: archivoId, tenantId })
    .select('-contenido')
    .lean();
}

async function obtenerCfdiArchivoParaDescarga(tenantId, archivoId) {
  const CfdiArchivo = await getNominaCfdiArchivoModel();
  return CfdiArchivo.findOne({ _id: archivoId, tenantId }).lean();
}

async function enlazarArchivosAHistorico(tenantId, pairs) {
  if (!pairs?.length) return 0;
  const CfdiArchivo = await getNominaCfdiArchivoModel();
  let n = 0;
  for (const { reciboId, historicoId } of pairs) {
    if (!reciboId || !historicoId) continue;
    const r = await CfdiArchivo.updateMany(
      { tenantId, reciboId, $or: [{ historicoId: null }, { historicoId: { $exists: false } }] },
      { $set: { historicoId } }
    );
    n += r.modifiedCount || 0;
  }
  return n;
}

module.exports = {
  buildXmlSimulado,
  guardarCfdiArchivo,
  metaCfdiArchivo,
  obtenerCfdiArchivoParaDescarga,
  enlazarArchivosAHistorico,
  sha256Hex
};

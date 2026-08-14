'use strict';

const crypto = require('crypto');
const getNominaCfdiArchivoModel = require('../models/nominaCfdiArchivo');

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
 * XML mínimo de simulación (no es CFDI válido SAT; sirve para retención/descarga hasta PAC real).
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
  total = 0
}) {
  const fecha = (fechaTimbrado instanceof Date ? fechaTimbrado : new Date(fechaTimbrado)).toISOString();
  const esc = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Serie="${esc(serie)}" Folio="${esc(folio)}" Total="${Number(total).toFixed(2)}"
  Fecha="${esc(fecha)}">
  <cfdi:Emisor Rfc="${esc(rfcEmisor)}" Nombre="${esc(nombreEmisor)}"/>
  <cfdi:Receptor Rfc="${esc(rfcReceptor)}" Nombre="${esc(nombreReceptor)}"/>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="${esc(uuid)}" FechaTimbrado="${esc(fecha)}"/>
  </cfdi:Complemento>
</cfdi:Comprobante>
`;
}

/**
 * Upsert de un archivo CFDI. Filtro: historicoId+tipo o reciboId+tipo.
 */
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

/**
 * Metadatos sin binario (para listados / stamps).
 */
async function metaCfdiArchivo(tenantId, archivoId) {
  const CfdiArchivo = await getNominaCfdiArchivoModel();
  return CfdiArchivo.findOne({ _id: archivoId, tenantId })
    .select('-contenido')
    .lean();
}

/**
 * Descarga: solo este documento (incluye BinData).
 */
async function obtenerCfdiArchivoParaDescarga(tenantId, archivoId) {
  const CfdiArchivo = await getNominaCfdiArchivoModel();
  return CfdiArchivo.findOne({ _id: archivoId, tenantId }).lean();
}

/**
 * Tras cerrar período: enlaza archivos del recibo operativo al histórico.
 */
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

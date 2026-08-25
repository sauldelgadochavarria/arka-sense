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
 * XML de simulación CFDI 4.0 + complemento Nómina 1.2 (parcial).
 * Incluye nomina12:SeparacionIndemnizacion cuando aplica (claves 022/023/025).
 * No es CFDI firmado válido SAT; sirve para retención/descarga y validar el nodo.
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
  const {
    buildSeparacionIndemnizacionXml,
    buildPercepcionesSeparacionXml
  } = require('./cfdi/separacionIndemnizacionBuilder');

  const fecha = (fechaTimbrado instanceof Date ? fechaTimbrado : new Date(fechaTimbrado)).toISOString();
  const esc = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  const ymd = (d) => {
    const x = d instanceof Date ? d : d ? new Date(d) : new Date(fechaTimbrado);
    if (Number.isNaN(x.getTime())) return fecha.slice(0, 10);
    return x.toISOString().slice(0, 10);
  };

  const sepData =
    separacionIndemnizacion && separacionIndemnizacion.aplica !== false && Number(separacionIndemnizacion.TotalPagado) > 0
      ? { aplica: true, ...separacionIndemnizacion }
      : null;

  const sepXml = sepData ? buildSeparacionIndemnizacionXml(sepData) : '';
  const percSepXml = sepData ? buildPercepcionesSeparacionXml(sepData) : '';
  const totalSepAttr = sepData
    ? ` TotalSeparacionIndemnizacion="${Number(sepData.TotalSeparacionIndemnizacion || sepData.TotalPagado).toFixed(2)}"`
    : '';

  const percInner = [percepcionesXml, percSepXml].filter(Boolean).join('\n      ');
  const percBlock = percInner
    ? `<nomina12:Percepciones TotalSueldos="0.00" TotalGravado="0.00" TotalExento="0.00"${totalSepAttr}>
      ${percInner}
      ${sepXml}
    </nomina12:Percepciones>`
    : sepXml
      ? `<nomina12:Percepciones TotalSueldos="0.00" TotalGravado="0.00" TotalExento="0.00"${totalSepAttr}>
      ${percSepXml}
      ${sepXml}
    </nomina12:Percepciones>`
      : '';

  const dedBlock = deduccionesXml
    ? `<nomina12:Deducciones TotalOtrasDeducciones="0.00" TotalImpuestosRetenidos="0.00">
      ${deduccionesXml}
    </nomina12:Deducciones>`
    : '';

  const nominaBlock =
    percBlock || dedBlock
      ? `
  <cfdi:Complemento>
    <nomina12:Nomina Version="1.2" TipoNomina="${esc(tipoNomina)}"
      FechaPago="${esc(ymd(fechaPago || fechaTimbrado))}"
      FechaInicialPago="${esc(ymd(fechaInicialPago || fechaTimbrado))}"
      FechaFinalPago="${esc(ymd(fechaFinalPago || fechaTimbrado))}"
      NumDiasPagados="${Number(numDiasPagados) || 1}">
      ${percBlock}
      ${dedBlock}
    </nomina12:Nomina>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="${esc(uuid)}" FechaTimbrado="${esc(fecha)}"/>
  </cfdi:Complemento>`
      : `
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="${esc(uuid)}" FechaTimbrado="${esc(fecha)}"/>
  </cfdi:Complemento>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:nomina12="http://www.sat.gob.mx/nomina12"
  xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Serie="${esc(serie)}" Folio="${esc(folio)}" Total="${Number(total).toFixed(2)}"
  Fecha="${esc(fecha)}" TipoDeComprobante="N" Moneda="MXN" SubTotal="${Number(total).toFixed(2)}">
  <cfdi:Emisor Rfc="${esc(rfcEmisor)}" Nombre="${esc(nombreEmisor)}"/>
  <cfdi:Receptor Rfc="${esc(rfcReceptor)}" Nombre="${esc(nombreReceptor)}" UsoCFDI="CN01"/>
  ${nominaBlock}
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

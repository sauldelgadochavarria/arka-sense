'use strict';

/**
 * Descarga de CFDI del propio empleado (app móvil).
 * XML: archivo timbrado o importado. PDF: representación del recibo, sin fórmulas.
 */

const PDFDocument = require('pdfkit');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getNominaCfdiArchivoModel = require('../models/nominaCfdiArchivo');
const getEmpresaModel = require('../models/empresa');
const getConceptCatalogModel = require('../models/conceptCatalog');
const getEmpleadoModel = require('../models/empleado');
const { buildReciboPdfContext, formatMoney } = require('./reciboPdfService');

function archivoBuffer(doc) {
  if (!doc?.contenido) return null;
  return Buffer.isBuffer(doc.contenido)
    ? doc.contenido
    : Buffer.from(doc.contenido.buffer || doc.contenido);
}

function nombreSeguro(name, fallback) {
  const raw = String(name || fallback || 'archivo').replace(/[^\w.\-]+/g, '_');
  return raw.slice(0, 120) || fallback;
}

async function historicoDelEmpleado(tenantId, empleadoId, historicoId) {
  const Historico = await getNominaHistoricoReciboModel();
  return Historico.findOne({
    _id: historicoId,
    tenantId,
    empleadoId
  }).lean();
}

async function xmlDeHistorico(tenantId, hist) {
  const Cfdi = await getNominaCfdiArchivoModel();
  const or = [{ historicoId: hist._id, tipo: 'xml' }];
  if (hist.timbrado?.archivoXmlId) or.unshift({ _id: hist.timbrado.archivoXmlId, tipo: 'xml' });
  const uuid = String(hist.timbrado?.uuid || '').trim();
  if (uuid) {
    or.push({ uuid: uuid.toUpperCase(), tipo: 'xml', empleadoId: hist.empleadoId });
  }
  const doc = await Cfdi.findOne({ tenantId, $or: or }).lean();
  if (!doc) return null;
  if (doc.empleadoId && String(doc.empleadoId) !== String(hist.empleadoId)) return null;
  return doc;
}

async function idsConXml(tenantId, empleadoId, rows) {
  const ids = new Set();
  const pendientes = [];
  for (const r of rows) {
    if (r.timbrado?.archivoXmlId) ids.add(String(r._id));
    else pendientes.push(r._id);
  }
  if (!pendientes.length) return ids;
  const Cfdi = await getNominaCfdiArchivoModel();
  const found = await Cfdi.find({
    tenantId,
    empleadoId,
    tipo: 'xml',
    historicoId: { $in: pendientes }
  })
    .select('historicoId')
    .lean();
  for (const f of found) ids.add(String(f.historicoId));
  return ids;
}

async function descargarXmlEmpleado({ tenantId, empleadoId, historicoId }) {
  const hist = await historicoDelEmpleado(tenantId, empleadoId, historicoId);
  if (!hist) return { status: 404, error: 'Recibo no encontrado' };
  const doc = await xmlDeHistorico(tenantId, hist);
  const buf = archivoBuffer(doc);
  if (!buf?.length) return { status: 404, error: 'Este recibo no tiene XML de CFDI' };
  const num = hist.empleado?.numEmpleado || 'empleado';
  const fallback = `cfdi_${num}_${hist.anio}${String(hist.mes).padStart(2, '0')}.xml`;
  return {
    status: 200,
    buffer: buf,
    filename: nombreSeguro(doc.nombreArchivo, fallback),
    contentType: doc.contentType || 'application/xml; charset=utf-8'
  };
}

function money(n) {
  return `$${formatMoney(n)}`;
}

function drawLines(doc, title, rows, yRef) {
  if (!rows?.length) return;
  if (yRef.y > 680) {
    doc.addPage();
    yRef.y = 48;
  }
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0F3D3E').text(title, 48, yRef.y);
  yRef.y += 18;
  doc.font('Helvetica').fontSize(9).fillColor('#1A1A1A');
  for (const row of rows) {
    if (yRef.y > 720) {
      doc.addPage();
      yRef.y = 48;
    }
    const label = String(row.nombre || row.codigo || '').slice(0, 72);
    doc.text(label, 48, yRef.y, { width: 380, lineBreak: false });
    doc.text(money(row.importe), 430, yRef.y, { width: 130, align: 'right', lineBreak: false });
    yRef.y += 14;
  }
  yRef.y += 8;
}

async function renderPdfBuffer(ctx) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const emp = ctx.empleado || {};
    const empresa = ctx.empresa || {};
    const periodo = ctx.periodo || {};
    const rec = ctx.recibo || {};
    const cfdi = ctx.cfdi || {};

    doc.font('Helvetica-Bold').fontSize(16).fillColor('#0F3D3E').text('Recibo de nómina', 48, 48);
    doc.font('Helvetica').fontSize(10).fillColor('#333333');
    doc.text(empresa.razonSocial || ' ', 48, 72, { width: 520 });
    if (empresa.rfc) doc.text(`RFC ${empresa.rfc}`, 48, 86);

    let y = 112;
    const linea = (label, value) => {
      if (!value) return;
      doc.font('Helvetica').fontSize(9).fillColor('#555555').text(label, 48, y, { width: 110, lineBreak: false });
      doc.font('Helvetica').fontSize(9).fillColor('#111111').text(String(value), 160, y, { width: 390 });
      y += 14;
    };
    const quien = [emp.nombre, emp.numEmpleado ? `(${emp.numEmpleado})` : ''].filter(Boolean).join(' ');
    linea('Empleado', quien);
    linea('RFC', emp.rfc);
    const rango = [periodo.fechaInicio, periodo.fechaFin].filter(Boolean).join(' – ');
    const perLabel = [
      periodo.numeroPeriodo !== '' && periodo.numeroPeriodo != null ? `P${periodo.numeroPeriodo}` : '',
      periodo.tipoNominaLabel || ''
    ]
      .filter(Boolean)
      .join(' · ');
    linea('Periodo', [perLabel, rango].filter(Boolean).join('  '));
    if (cfdi.uuid) linea('UUID', cfdi.uuid);

    y += 10;
    const yRef = { y };
    drawLines(doc, 'Percepciones', ctx.percepciones, yRef);
    drawLines(doc, 'Deducciones', ctx.deducciones, yRef);
    drawLines(doc, 'Otros pagos', ctx.otrosPagos, yRef);
    y = yRef.y + 6;
    if (y > 680) {
      doc.addPage();
      y = 48;
    }
    doc.moveTo(48, y).lineTo(564, y).strokeColor('#D0D7D8').stroke();
    y += 12;
    doc.font('Helvetica').fontSize(10).fillColor('#333333');
    doc.text('Percepciones', 48, y);
    doc.text(money(rec.totalPercepciones), 430, y, { width: 130, align: 'right' });
    y += 16;
    doc.text('Deducciones', 48, y);
    doc.text(money(rec.totalDeducciones), 430, y, { width: 130, align: 'right' });
    y += 18;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0F3D3E');
    doc.text('Neto a pagar', 48, y);
    doc.text(money(rec.netoPagar), 380, y, { width: 180, align: 'right' });
    if (rec.cantidadLetra) {
      y += 22;
      doc.font('Helvetica').fontSize(8).fillColor('#555555').text(rec.cantidadLetra, 48, y, { width: 516 });
      y += 16;
    }
    if (y > 700) {
      doc.addPage();
      y = 48;
    }
    doc.font('Helvetica').fontSize(8).fillColor('#777777').text(
      'Representación del recibo para el trabajador. El archivo XML es el CFDI.',
      48,
      y + 12,
      { width: 516 }
    );
    doc.end();
  });
}

async function descargarPdfEmpleado({ tenantId, empleadoId, historicoId }) {
  const hist = await historicoDelEmpleado(tenantId, empleadoId, historicoId);
  if (!hist) return { status: 404, error: 'Recibo no encontrado' };

  const Empresa = await getEmpresaModel();
  const Catalog = await getConceptCatalogModel();
  const Empleado = await getEmpleadoModel();
  const [empresa, catalogRows, live] = await Promise.all([
    hist.empresaId
      ? Empresa.findById(hist.empresaId).select('razonSocial nombreComercial rfc registroPatronal codigoPostal ciudad estado domicilioFiscal').lean()
      : null,
    Catalog.find({}).select('codigo nombre tipo naturaleza sat claveSAT').lean(),
    Empleado.findOne({ _id: empleadoId, tenantId }).select('rfc curp nss nombreSat firstName lastName apellidoPaterno apellidoMaterno').lean()
  ]);

  const catalogoNombres = Object.fromEntries(
    catalogRows.map((c) => [String(c.codigo).toUpperCase(), c.nombre])
  );
  const catalogoMeta = Object.fromEntries(
    catalogRows.map((c) => {
      const code = String(c.codigo).toUpperCase();
      return [
        code,
        {
          nombre: c.nombre,
          tipo: c.tipo || c.sat?.tipo || '',
          satTipo: c.sat?.tipo || '',
          naturaleza: c.naturaleza || '',
          claveSAT: (c.sat && c.sat.clave) || c.claveSAT || ''
        }
      ];
    })
  );

  const snap = hist.empleado || {};
  const ctx = buildReciboPdfContext({
    empresa: empresa || {},
    empleado: {
      ...snap,
      nombre: snap.nombre || '',
      numEmpleado: snap.numEmpleado || live?.numEmpleado || '',
      rfc: live?.rfc || '',
      curp: live?.curp || '',
      nss: live?.nss || '',
      nombreSat: live?.nombreSat || '',
      firstName: live?.firstName || '',
      lastName: live?.lastName || '',
      apellidoPaterno: live?.apellidoPaterno || '',
      apellidoMaterno: live?.apellidoMaterno || ''
    },
    periodo: { ...(hist.periodo || {}), anio: hist.anio },
    recibo: hist,
    conceptos: hist.conceptos || [],
    cfdi: hist.timbrado || {},
    catalogoNombres,
    catalogoMeta
  });

  const buffer = await renderPdfBuffer(ctx);
  const num = snap.numEmpleado || 'empleado';
  const filename = nombreSeguro(
    `recibo_${num}_${hist.anio}${String(hist.mes).padStart(2, '0')}.pdf`,
    'recibo.pdf'
  );
  return {
    status: 200,
    buffer,
    filename,
    contentType: 'application/pdf'
  };
}

module.exports = {
  idsConXml,
  descargarXmlEmpleado,
  descargarPdfEmpleado
};

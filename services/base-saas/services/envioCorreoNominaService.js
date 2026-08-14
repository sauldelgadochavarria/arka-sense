'use strict';

const getPeriodoNominaModel = require('../models/periodoNomina');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getEmpleadoModel = require('../models/empleado');
const { obtenerCfdiArchivoParaDescarga } = require('./cfdiArchivoService');
const getCorreoConfigModel = require('../models/correoConfig');
const { enviarCorreo, resolverCorreoConfig, modoDeConfig, toBuffer } = require('./mailerService');

function money(n) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolverEmail(emp = {}) {
  const a = String(emp.email || '').trim().toLowerCase();
  const b = String(emp.emailPersonal || '').trim().toLowerCase();
  if (a && a.includes('@')) return a;
  if (b && b.includes('@')) return b;
  return '';
}

function labelPeriodo(periodo) {
  const tipo = periodo.tipoPeriodo || '';
  const num = periodo.numeroPeriodo != null ? `#${periodo.numeroPeriodo}` : '';
  const anio = periodo.anio || '';
  return `${tipo} ${num} ${anio}`.trim();
}

function fechaCorta(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('es-MX');
  } catch {
    return '';
  }
}

async function loadItemsPeriodo(tenantId, periodo) {
  const Historico = await getNominaHistoricoReciboModel();
  const Empleado = await getEmpleadoModel();
  const rows = await Historico.find({
    tenantId,
    periodoId: periodo._id,
    origen: 'cierre'
  }).lean();

  const empIds = [...new Set(rows.map((r) => String(r.empleadoId)))];
  const empleados = empIds.length
    ? await Empleado.find({ _id: { $in: empIds } })
        .select('numEmpleado firstName lastName email emailPersonal')
        .lean()
    : [];
  const empById = new Map(empleados.map((e) => [String(e._id), e]));

  return rows.map((h) => {
    const emp = empById.get(String(h.empleadoId)) || {};
    const timbrado = h.timbrado || {};
    const correo = h.correo || {};
    const email = resolverEmail(emp);
    const esTimbrado = timbrado.estatus === 'timbrado' && !!timbrado.uuid;
    let omitidoMotivo = '';
    if (!esTimbrado) omitidoMotivo = 'Sin timbrar';
    else if (!email) omitidoMotivo = 'Sin correo en la ficha';
    else if (!timbrado.archivoXmlId && !timbrado.archivoPdfId) omitidoMotivo = 'Sin XML/PDF guardado';

    return {
      historicoId: h._id,
      empleadoId: h.empleadoId,
      numEmpleado: h.empleado?.numEmpleado || emp.numEmpleado || '',
      nombre: h.empleado?.nombre || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
      email,
      netoPagar: h.netoPagar || 0,
      uuid: timbrado.uuid || '',
      archivoXmlId: timbrado.archivoXmlId || null,
      archivoPdfId: timbrado.archivoPdfId || null,
      xmlNombre: timbrado.xmlNombre || '',
      pdfNombre: timbrado.pdfNombre || '',
      timbrado: esTimbrado,
      correo,
      omitidoMotivo,
      aplicable: esTimbrado && !!email && !omitidoMotivo
    };
  });
}

function debeEnviar(item, alcance) {
  if (!item.aplicable) return false;
  const est = item.correo?.estatus || 'pendiente';
  if (alcance === 'todos') return true;
  return est !== 'enviado';
}

function resumenDesdeItems(items) {
  let enviados = 0;
  let errores = 0;
  let omitidos = 0;
  let pendientes = 0;
  for (const it of items) {
    if (!it.timbrado) {
      omitidos += 1;
      continue;
    }
    if (it.omitidoMotivo && !it.aplicable) {
      omitidos += 1;
      continue;
    }
    const est = it.correo?.estatus || 'pendiente';
    if (est === 'enviado') enviados += 1;
    else if (est === 'error') errores += 1;
    else if (est === 'omitido') omitidos += 1;
    else pendientes += 1;
  }
  let estatus = 'pendiente';
  if (enviados && !pendientes && !errores) estatus = 'enviado';
  else if (enviados && (pendientes || errores)) estatus = 'parcial';
  else if (errores && !enviados) estatus = 'error';
  return { enviados, errores, omitidos, pendientes, estatus };
}

async function previewEnvio(tenantId, periodo) {
  const items = await loadItemsPeriodo(tenantId, periodo);
  const resumen = resumenDesdeItems(items);
  const yaEnviado = ['enviado', 'parcial'].includes(periodo.correo?.estatus) || resumen.enviados > 0;
  return {
    items,
    resumen,
    yaEnviado,
    labelPeriodo: labelPeriodo(periodo)
  };
}

function cuerpoHtml({ empresa, periodo, item }) {
  const razon = empresa?.razonSocial || empresa?.nombreComercial || 'Empresa';
  return `<!DOCTYPE html>
<html><body style="font-family:sans-serif;color:#222">
  <p>Hola ${esc(item.nombre || '')},</p>
  <p>Adjuntamos tu recibo de nómina de <strong>${esc(razon)}</strong>.</p>
  <ul>
    <li>Período: ${esc(labelPeriodo(periodo))} (${fechaCorta(periodo.fechaInicio)} – ${fechaCorta(periodo.fechaFin)})</li>
    <li>Neto: $${money(item.netoPagar)}</li>
    ${item.uuid ? `<li>UUID CFDI: ${esc(item.uuid)}</li>` : ''}
  </ul>
  <p>El XML es el comprobante fiscal; el PDF/HTML es la representación impresa.</p>
  <p>Saludos,<br>${esc(razon)}</p>
</body></html>`;
}

async function adjuntosDeItem(tenantId, item) {
  const out = [];
  for (const [id, fallbackName, fallbackType] of [
    [item.archivoXmlId, item.xmlNombre || `cfdi_${item.numEmpleado}.xml`, 'application/xml'],
    [item.archivoPdfId, item.pdfNombre || `recibo_${item.numEmpleado}.html`, 'text/html']
  ]) {
    if (!id) continue;
    const doc = await obtenerCfdiArchivoParaDescarga(tenantId, id);
    if (!doc?.contenido) continue;
    out.push({
      filename: doc.nombreArchivo || fallbackName,
      content: toBuffer(doc.contenido),
      contentType: doc.contentType || fallbackType
    });
  }
  return out;
}

async function enviarItem({ tenantId, empresa, periodo, item, userId, userLabel, mailConfig }) {
  const Historico = await getNominaHistoricoReciboModel();
  const modo = modoDeConfig(mailConfig);
  const intentos = (item.correo?.intentos || 0) + 1;
  const stampBase = {
    destinatario: item.email,
    enviadoPorUserId: userId || '',
    enviadoPorLabel: userLabel || '',
    intentos,
    modo
  };

  try {
    const attachments = await adjuntosDeItem(tenantId, item);
    if (!attachments.length) throw new Error('Sin archivos XML/PDF para adjuntar');
    await enviarCorreo({
      to: item.email,
      fromName: mailConfig.fromNombre || empresa?.razonSocial || empresa?.nombreComercial || '',
      subject: `Recibo de nómina ${labelPeriodo(periodo)} — ${item.numEmpleado || ''}`.trim(),
      html: cuerpoHtml({ empresa, periodo, item }),
      attachments,
      config: mailConfig
    });
    const stamp = {
      ...stampBase,
      estatus: 'enviado',
      enviadoAt: new Date(),
      errorMensaje: ''
    };
    await Historico.updateOne({ _id: item.historicoId, tenantId }, { $set: { correo: stamp } });
    return { ...item, correo: stamp, ok: true };
  } catch (err) {
    const stamp = {
      ...stampBase,
      estatus: 'error',
      enviadoAt: item.correo?.enviadoAt || null,
      errorMensaje: err.message || String(err)
    };
    await Historico.updateOne({ _id: item.historicoId, tenantId }, { $set: { correo: stamp } });
    return { ...item, correo: stamp, ok: false, error: stamp.errorMensaje };
  }
}

async function enviarPeriodo({
  tenantId,
  empresa,
  periodoId,
  alcance = 'pendientes',
  userId = '',
  userLabel = '',
  historicoId = null,
  correoConfigId = null
}) {
  const Periodo = await getPeriodoNominaModel();
  const periodo = await Periodo.findOne({ _id: periodoId, tenantId, empresaId: empresa._id });
  if (!periodo) throw new Error('Período no encontrado');
  if (periodo.estatus !== 'cerrado') {
    throw new Error('El período debe estar cerrado para enviar recibos');
  }

  const alcanceNorm = alcance === 'todos' ? 'todos' : 'pendientes';
  let items = await loadItemsPeriodo(tenantId, periodo);
  if (historicoId) {
    items = items.filter((i) => String(i.historicoId) === String(historicoId));
    if (!items.length) throw new Error('Recibo no encontrado en el período');
  }

  const cola = items.filter((i) => debeEnviar(i, historicoId ? 'todos' : alcanceNorm));
  if (!cola.length) {
    throw new Error(
      alcanceNorm === 'pendientes'
        ? 'No hay recibos pendientes de envío (timbrados con correo)'
        : 'No hay recibos timbrados con correo para enviar'
    );
  }

  const mailConfig = await resolverCorreoConfig(tenantId, empresa._id, correoConfigId);
  const resultados = [];
  for (const item of cola) {
    resultados.push(await enviarItem({ tenantId, empresa, periodo, item, userId, userLabel, mailConfig }));
  }

  const enviadosOk = resultados.filter((r) => r.ok).length;
  if (enviadosOk && mailConfig._id) {
    const Correo = await getCorreoConfigModel();
    await Correo.updateOne(
      { _id: mailConfig._id },
      { $inc: { totalEnviados: enviadosOk }, $set: { ultimaFechaUso: new Date() } }
    );
  }

  const after = await loadItemsPeriodo(tenantId, periodo);
  const resumen = resumenDesdeItems(after);
  const stampPeriodo = {
    ...resumen,
    enviadoAt: new Date(),
    ultimoAlcance: historicoId ? periodo.correo?.ultimoAlcance || alcanceNorm : alcanceNorm,
    enviadoPorUserId: userId,
    enviadoPorLabel: userLabel,
    modo: modoDeConfig(mailConfig)
  };
  periodo.correo = stampPeriodo;
  periodo.markModified('correo');
  await periodo.save();

  return {
    periodo: periodo.toObject(),
    enviadosAhora: resultados.filter((r) => r.ok).length,
    erroresAhora: resultados.filter((r) => !r.ok).length,
    resultados,
    resumen
  };
}

module.exports = {
  previewEnvio,
  enviarPeriodo,
  labelPeriodo
};

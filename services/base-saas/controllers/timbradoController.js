'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const {
  trimString,
  trimUpper,
  parseCheckbox,
  parseOptionalObjectId,
  parsePositiveNumber
} = require('../libs/formHelpers');
const getPacConfigModel = require('../models/pacConfig');
const getReciboPdfPlantillaModel = require('../models/reciboPdfPlantilla');
const getTimbradoLoteModel = require('../models/timbradoLote');
const getPeriodoNominaModel = require('../models/periodoNomina');
const getSubsidiariaModel = require('../models/subsidiaria');
const getTipoPeriodoNominaModel = require('../models/tipoPeriodoNomina');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getReciboNominaModel = require('../models/reciboNomina');
const getEmpleadoModel = require('../models/empleado');
const getConceptoAplicadoModel = require('../models/conceptoAplicado');
const getConceptCatalogModel = require('../models/conceptCatalog');
const { PAC_PROVEEDORES, PAC_SW_DEFAULTS, RECIBO_PDF_VARIABLES } = require('../config/timbradoCatalog');
const { PLANTILLA_PDF_CFDI } = require('../config/reciboPdfPlantillaCfdi');
const { crearYProcesarLote } = require('../services/timbradoService');
const { obtenerCfdiArchivoParaDescarga } = require('../services/cfdiArchivoService');
const {
  renderPlantillaHtml,
  buildReciboPdfContext,
  enrichEmpleadoPdf,
  mergeEmpleadoPdf,
  resolverPlantillaPdf
} = require('../services/reciboPdfService');

function flashRedirect(req, res, path, type, msg) {
  if (req.flash) req.flash(type, msg);
  return res.redirect(path);
}

/* ───────────── PAC ───────────── */

function pacFromBody(body, tenantId, empresaId) {
  const password = body.password != null ? String(body.password) : '';
  const keepPassword = password === '' || password === '********';
  const payload = {
    tenantId,
    empresaId,
    subsidiariaId: parseOptionalObjectId(body.subsidiariaId),
    codigo: trimUpper(body.codigo),
    nombre: trimString(body.nombre) || trimUpper(body.codigo),
    activo: body.activo == null ? true : parseCheckbox(body, 'activo'),
    ambiente: trimString(body.ambiente) || '1',
    proveedor: trimString(body.proveedor) || 'SW Sapien',
    formato: body.formato === 'XML' ? 'XML' : 'JSON',
    generarLayout: body.generarLayout == null ? true : parseCheckbox(body, 'generarLayout'),
    usuario: trimString(body.usuario),
    urlAuth: trimString(body.urlAuth),
    urlTimbrado: trimString(body.urlTimbrado),
    urlCancelacion: trimString(body.urlCancelacion),
    urlConsulta: trimString(body.urlConsulta),
    timeout: parsePositiveNumber(body.timeout) ?? 30,
    reintentos: parsePositiveNumber(body.reintentos) ?? 3,
    emailErrores: trimString(body.emailErrores),
    carpetaXml: trimString(body.carpetaXml),
    serieDefault: trimUpper(body.serieDefault),
    templateIngreso: trimString(body.templateIngreso),
    templateEgreso: trimString(body.templateEgreso),
    templatePago: trimString(body.templatePago),
    templateTraslado: trimString(body.templateTraslado),
    rfcSatTest: trimUpper(body.rfcSatTest),
    nombreSatTest: trimString(body.nombreSatTest),
    notas: trimString(body.notas),
    modoReal: parseCheckbox(body, 'modoReal')
  };
  if (!keepPassword) payload.password = password;
  return payload;
}

function maskPac(doc) {
  if (!doc) return doc;
  const o = { ...doc };
  o.password = doc.password ? '********' : '';
  return o;
}

async function listPac(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Pac = await getPacConfigModel();
  const rows = empresa
    ? await Pac.find({ tenantId: req.session.tenantId, empresaId: empresa._id }).sort({ codigo: 1 }).lean()
    : [];
  res.render('Nomina/timbrado/pac-list', {
    session: req.session,
    empresa,
    error,
    rows: rows.map(maskPac)
  });
}

async function newPacForm(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Subsidiaria = await getSubsidiariaModel();
  const subsidiarias = empresa
    ? await Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean()
    : [];
  res.render('Nomina/timbrado/pac-edit', {
    session: req.session,
    empresa,
    error,
    isNew: true,
    pac: { ...PAC_SW_DEFAULTS, codigo: 'SW-PROD', nombre: 'SW Sapien producción', activo: true, generarLayout: true },
    subsidiarias,
    proveedores: PAC_PROVEEDORES
  });
}

async function createPac(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/pac', 'error', error || 'Sin empresa');
  try {
    const Pac = await getPacConfigModel();
    const payload = pacFromBody(req.body, req.session.tenantId, empresa._id);
    if (!payload.codigo) throw new Error('Código requerido');
    if (!payload.password) payload.password = '';
    await Pac.create(payload);
    return flashRedirect(req, res, '/nomina/pac', 'success', 'PAC guardado');
  } catch (err) {
    return flashRedirect(req, res, '/nomina/pac/nuevo', 'error', err.message || 'Error al guardar');
  }
}

async function editPac(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Pac = await getPacConfigModel();
  const pac = await Pac.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa?._id
  }).lean();
  if (!pac) return res.status(404).send('PAC no encontrado');
  const Subsidiaria = await getSubsidiariaModel();
  const subsidiarias = empresa
    ? await Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean()
    : [];
  res.render('Nomina/timbrado/pac-edit', {
    session: req.session,
    empresa,
    error,
    isNew: false,
    pac: maskPac(pac),
    subsidiarias,
    proveedores: PAC_PROVEEDORES
  });
}

async function updatePac(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/pac', 'error', error || 'Sin empresa');
  try {
    const Pac = await getPacConfigModel();
    const payload = pacFromBody(req.body, req.session.tenantId, empresa._id);
    delete payload.tenantId;
    delete payload.empresaId;
    delete payload.codigo;
    await Pac.updateOne(
      { _id: req.params.id, tenantId: req.session.tenantId, empresaId: empresa._id },
      { $set: payload }
    );
    return flashRedirect(req, res, '/nomina/pac', 'success', 'PAC actualizado');
  } catch (err) {
    return flashRedirect(req, res, `/nomina/pac/${req.params.id}/edit`, 'error', err.message);
  }
}

async function togglePac(req, res) {
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  const Pac = await getPacConfigModel();
  const pac = await Pac.findOne({ _id: req.params.id, tenantId: req.session.tenantId, empresaId: empresa?._id });
  if (pac) {
    pac.activo = !pac.activo;
    await pac.save();
  }
  return res.redirect('/nomina/pac');
}

async function seedPacEjemplo(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/pac', 'error', error || 'Sin empresa');
  const Pac = await getPacConfigModel();
  const exists = await Pac.findOne({ tenantId: req.session.tenantId, empresaId: empresa._id, codigo: 'SW-DEMO' });
  if (!exists) {
    await Pac.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      codigo: 'SW-DEMO',
      nombre: 'SW Sapien demo (simulación)',
      ...PAC_SW_DEFAULTS,
      activo: true,
      generarLayout: true,
      modoReal: false,
      usuario: '',
      password: '',
      emailErrores: '',
      carpetaXml: '',
      notas: 'Ejemplo para pruebas en modo simulación'
    });
  }
  return flashRedirect(req, res, '/nomina/pac', 'success', 'PAC demo listo');
}

/* ───────────── Plantillas PDF ───────────── */

function plantillaFromBody(body, tenantId, empresaId) {
  return {
    tenantId,
    empresaId,
    codigo: trimUpper(body.codigo),
    nombre: trimString(body.nombre) || trimUpper(body.codigo),
    descripcion: trimString(body.descripcion),
    tipoPeriodoId: parseOptionalObjectId(body.tipoPeriodoId),
    rfcEmisor: trimUpper(body.rfcEmisor),
    razonSocialEmisor: trimString(body.razonSocialEmisor),
    plantillaHtml: body.plantillaHtml != null ? String(body.plantillaHtml) : '',
    cssExtra: body.cssExtra != null ? String(body.cssExtra) : '',
    activo: body.activo == null ? true : parseCheckbox(body, 'activo'),
    esDefault: parseCheckbox(body, 'esDefault'),
    orden: parsePositiveNumber(body.orden) ?? 100
  };
}

async function listPlantillas(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Plantilla = await getReciboPdfPlantillaModel();
  const Tipo = await getTipoPeriodoNominaModel();
  const rows = empresa
    ? await Plantilla.find({ tenantId: req.session.tenantId, empresaId: empresa._id }).sort({ orden: 1 }).lean()
    : [];
  const tipos = empresa
    ? await Tipo.find({ tenantId: req.session.tenantId, empresaId: empresa._id }).lean()
    : [];
  const tipoMap = new Map(tipos.map((t) => [String(t._id), t.nombre]));
  res.render('Nomina/timbrado/plantillas-list', {
    session: req.session,
    empresa,
    error,
    rows,
    tipoMap
  });
}

async function newPlantillaForm(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Tipo = await getTipoPeriodoNominaModel();
  const tipos = empresa
    ? await Tipo.find({ tenantId: req.session.tenantId, empresaId: empresa._id, activo: true })
        .sort({ nombre: 1 })
        .lean()
    : [];
  const prefTipo = parseOptionalObjectId(req.query.tipoPeriodoId);
  res.render('Nomina/timbrado/plantilla-edit', {
    session: req.session,
    empresa,
    error,
    isNew: true,
    plantilla: {
      codigo: 'RECIBO-STD',
      nombre: 'Recibo CFDI 4.0 / Nómina 1.2',
      plantillaHtml: PLANTILLA_PDF_CFDI,
      tipoPeriodoId: prefTipo,
      rfcEmisor: empresa?.rfc || '',
      razonSocialEmisor: empresa?.razonSocial || '',
      activo: true,
      esDefault: true,
      orden: 100
    },
    tipos,
    variables: RECIBO_PDF_VARIABLES
  });
}

async function createPlantilla(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/recibos-pdf', 'error', error || 'Sin empresa');
  try {
    const Plantilla = await getReciboPdfPlantillaModel();
    const payload = plantillaFromBody(req.body, req.session.tenantId, empresa._id);
    if (!payload.codigo) throw new Error('Código requerido');
    if (!payload.plantillaHtml) throw new Error('Plantilla HTML requerida');
    if (payload.esDefault) {
      await Plantilla.updateMany(
        { tenantId: req.session.tenantId, empresaId: empresa._id },
        { $set: { esDefault: false } }
      );
    }
    await Plantilla.create(payload);
    return flashRedirect(req, res, '/nomina/recibos-pdf', 'success', 'Plantilla creada');
  } catch (err) {
    return flashRedirect(req, res, '/nomina/recibos-pdf/nuevo', 'error', err.message);
  }
}

async function editPlantilla(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Plantilla = await getReciboPdfPlantillaModel();
  const plantilla = await Plantilla.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa?._id
  }).lean();
  if (!plantilla) return res.status(404).send('Plantilla no encontrada');
  const Tipo = await getTipoPeriodoNominaModel();
  const tipos = empresa
    ? await Tipo.find({ tenantId: req.session.tenantId, empresaId: empresa._id, activo: true })
        .sort({ nombre: 1 })
        .lean()
    : [];
  res.render('Nomina/timbrado/plantilla-edit', {
    session: req.session,
    empresa,
    error,
    isNew: false,
    plantilla,
    tipos,
    variables: RECIBO_PDF_VARIABLES
  });
}

async function updatePlantilla(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/recibos-pdf', 'error', error || 'Sin empresa');
  try {
    const Plantilla = await getReciboPdfPlantillaModel();
    const payload = plantillaFromBody(req.body, req.session.tenantId, empresa._id);
    delete payload.tenantId;
    delete payload.empresaId;
    delete payload.codigo;
    if (payload.esDefault) {
      await Plantilla.updateMany(
        { tenantId: req.session.tenantId, empresaId: empresa._id, _id: { $ne: req.params.id } },
        { $set: { esDefault: false } }
      );
    }
    await Plantilla.updateOne(
      { _id: req.params.id, tenantId: req.session.tenantId, empresaId: empresa._id },
      { $set: payload }
    );
    return flashRedirect(req, res, '/nomina/recibos-pdf', 'success', 'Plantilla actualizada');
  } catch (err) {
    return flashRedirect(req, res, `/nomina/recibos-pdf/${req.params.id}/edit`, 'error', err.message);
  }
}

async function togglePlantilla(req, res) {
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  const Plantilla = await getReciboPdfPlantillaModel();
  const doc = await Plantilla.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa?._id
  });
  if (doc) {
    doc.activo = !doc.activo;
    await doc.save();
  }
  return res.redirect('/nomina/recibos-pdf');
}

async function seedPlantillaEjemplo(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/recibos-pdf', 'error', error || 'Sin empresa');
  const Plantilla = await getReciboPdfPlantillaModel();
  const exists = await Plantilla.findOne({
    tenantId: req.session.tenantId,
    empresaId: empresa._id,
    codigo: 'RECIBO-STD'
  });
  if (!exists) {
    await Plantilla.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      codigo: 'RECIBO-STD',
      nombre: 'Recibo CFDI 4.0 / Nómina 1.2',
      plantillaHtml: PLANTILLA_PDF_CFDI,
      rfcEmisor: empresa.rfc || '',
      razonSocialEmisor: empresa.razonSocial || '',
      activo: true,
      esDefault: true,
      orden: 100
    });
  } else {
    exists.plantillaHtml = PLANTILLA_PDF_CFDI;
    exists.nombre = 'Recibo CFDI 4.0 / Nómina 1.2';
    await exists.save();
  }
  return flashRedirect(req, res, '/nomina/recibos-pdf', 'success', 'Plantilla CFDI 4.0 lista');
}

async function aplicarLayoutCfdi(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/recibos-pdf', 'error', error || 'Sin empresa');
  const Plantilla = await getReciboPdfPlantillaModel();
  const doc = await Plantilla.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa._id
  });
  if (!doc) return res.status(404).send('Plantilla no encontrada');
  doc.plantillaHtml = PLANTILLA_PDF_CFDI;
  if (!doc.nombre || /estándar|estandar|ejemplo/i.test(doc.nombre)) {
    doc.nombre = 'Recibo CFDI 4.0 / Nómina 1.2';
  }
  await doc.save();
  return flashRedirect(req, res, `/nomina/recibos-pdf/${doc._id}/edit`, 'success', 'Layout CFDI 4.0 aplicado');
}

async function previewPlantilla(req, res) {
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  const Plantilla = await getReciboPdfPlantillaModel();
  const plantilla = await Plantilla.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa?._id
  }).lean();
  if (!plantilla) return res.status(404).send('No encontrada');
  const ctx = buildReciboPdfContext({
    empresa: empresa || {
      razonSocial: 'EMPRESA DEMO',
      rfc: 'XAXX010101000',
      registroPatronal: 'Y0000000000',
      domicilioFiscal: 'MONTERREY Nuevo León México CP 64000',
      ciudad: 'MONTERREY',
      estado: 'Nuevo León',
      codigoPostal: '64000'
    },
    empleado: {
      numEmpleado: '001',
      nombre: 'JUAN PEREZ GARCIA',
      rfc: 'PEGJ800101ABC',
      curp: 'PEGJ800101HDFRRN09',
      nss: '12345678901',
      departamento: 'Operaciones',
      centroCosto: 'CC01',
      puesto: 'Analista',
      fechaIngreso: new Date('2020-01-15'),
      salarioDiario: 500,
      sdi: 650.25,
      sbc: 650.25,
      tipoContrato: 'indefinido',
      domicilio: {
        calle: 'AV. REFORMA',
        numeroExt: '100',
        colonia: 'CENTRO',
        poblacion: 'MONTERREY',
        entidad: 'NL',
        codigoPostal: '64000'
      },
      datosBancarios: { bancoNombre: 'BBVA', bancoCodigo: '012', cuenta: '0123456789' }
    },
    periodo: {
      tipoPeriodo: 'quincenal',
      tipoNomina: 'ordinaria',
      numeroPeriodo: 14,
      fechaInicio: new Date('2026-07-16'),
      fechaFin: new Date('2026-07-31'),
      periodicidadPagoSat: 4
    },
    recibo: {
      totalPercepciones: 10000,
      totalDeducciones: 1500,
      netoPagar: 8500,
      diasLaborados: 15,
      diasPagados: 15
    },
    conceptos: [
      { conceptoCodigo: 'SUELDO', tipo: 'percepcion', claveSAT: '001', importe: 8000, gravado: 8000, exento: 0 },
      { conceptoCodigo: 'FONDO_AHORRO', tipo: 'percepcion', claveSAT: '005', importe: 2000, gravado: 0, exento: 2000 },
      { conceptoCodigo: 'ISR', tipo: 'deduccion', claveSAT: '002', importe: 1000, gravado: 0, exento: 0 },
      { conceptoCodigo: 'IMSS_OBRERO', tipo: 'deduccion', claveSAT: '001', importe: 500, gravado: 0, exento: 0 },
      { conceptoCodigo: 'SUBSIDIO_EMPLEO', tipo: 'otro_pago', claveSAT: '002', importe: 0, gravado: 0, exento: 0 }
    ],
    cfdi: {
      uuid: 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890',
      serie: 'N',
      folio: '1',
      fecha: new Date('2026-07-31T12:22:18'),
      fechaCertificacion: new Date('2026-07-31T12:22:45'),
      certificadoEmisor: '00001000000500000000',
      certificadoSat: '00001000000500000001',
      selloEmisor: 'AbCdEf0123456789DemoSelloEmisor',
      selloSat: 'XyZ9876543210DemoSelloSAT'
    },
    catalogoNombres: {
      SUELDO: 'Sueldo',
      FONDO_AHORRO: 'Fondo de ahorro',
      ISR: 'ISR',
      IMSS_OBRERO: 'IMSS obrero',
      SUBSIDIO_EMPLEO: 'Subsidio para el empleo'
    }
  });
  const html = renderPlantillaHtml(plantilla.plantillaHtml, ctx);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

/* ───────────── Proceso timbrado ───────────── */

async function wizardTimbrado(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Periodo = await getPeriodoNominaModel();
  const Pac = await getPacConfigModel();
  const Plantilla = await getReciboPdfPlantillaModel();
  const Lote = await getTimbradoLoteModel();

  const [periodos, pacs, plantillas, lotes] = empresa
    ? await Promise.all([
        Periodo.find({
          tenantId: req.session.tenantId,
          empresaId: empresa._id,
          estatus: { $in: ['calculado', 'cerrado'] }
        })
          .sort({ anio: -1, numeroPeriodo: -1 })
          .limit(40)
          .lean(),
        Pac.find({ tenantId: req.session.tenantId, empresaId: empresa._id, activo: true }).sort({ codigo: 1 }).lean(),
        Plantilla.find({ tenantId: req.session.tenantId, empresaId: empresa._id, activo: true })
          .sort({ orden: 1 })
          .lean(),
        Lote.find({ tenantId: req.session.tenantId, empresaId: empresa._id })
          .sort({ createdAt: -1 })
          .limit(15)
          .lean()
      ])
    : [[], [], [], []];

  res.render('Nomina/timbrado/wizard', {
    session: req.session,
    empresa,
    error,
    periodos,
    pacs: pacs.map(maskPac),
    plantillas,
    lotes
  });
}

async function generarTimbrado(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/timbrado', 'error', error || 'Sin empresa');
  try {
    const result = await crearYProcesarLote({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      empresa,
      periodoId: parseOptionalObjectId(req.body.periodoId),
      pacConfigId: parseOptionalObjectId(req.body.pacConfigId),
      plantillaPdfId: parseOptionalObjectId(req.body.plantillaPdfId),
      forzarReal: parseCheckbox(req.body, 'forzarReal'),
      userId: req.session.userid || req.session.userId || '',
      userLabel:
        req.session.user ||
        req.session.email ||
        req.session.username ||
        '',
      procesar: true
    });
    return res.redirect(`/nomina/timbrado/lotes/${result.lote._id}`);
  } catch (err) {
    return flashRedirect(req, res, '/nomina/timbrado', 'error', err.message || 'Error al timbrar');
  }
}

async function showLote(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Lote = await getTimbradoLoteModel();
  const lote = await Lote.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa?._id
  }).lean();
  if (!lote) return res.status(404).send('Lote no encontrado');
  res.render('Nomina/timbrado/lote-show', {
    session: req.session,
    empresa,
    error,
    lote
  });
}

async function descargarCfdiArchivo(req, res) {
  const archivoId = parseOptionalObjectId(req.params.id);
  if (!archivoId) return res.status(400).send('ID inválido');
  const doc = await obtenerCfdiArchivoParaDescarga(req.session.tenantId, archivoId);
  if (!doc || !doc.contenido) return res.status(404).send('Archivo no encontrado');

  const buf = Buffer.isBuffer(doc.contenido)
    ? doc.contenido
    : Buffer.from(doc.contenido.buffer || doc.contenido);
  const nombre = doc.nombreArchivo || `cfdi_${doc.uuid || archivoId}.${doc.tipo === 'xml' ? 'xml' : 'html'}`;
  res.setHeader('Content-Type', doc.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre.replace(/"/g, '')}"`);
  res.setHeader('Content-Length', buf.length);
  return res.send(buf);
}

async function reciboPdfHtml(req, res) {
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  const historicoId = parseOptionalObjectId(req.query.historicoId);
  const reciboId = parseOptionalObjectId(req.query.reciboId);
  const Plantilla = await getReciboPdfPlantillaModel();
  const Catalog = await getConceptCatalogModel();
  const Empleado = await getEmpleadoModel();
  const Periodo = await getPeriodoNominaModel();

  let src = null;
  let periodo = null;
  if (historicoId) {
    const Historico = await getNominaHistoricoReciboModel();
    src = await Historico.findOne({ _id: historicoId, tenantId: req.session.tenantId }).lean();
    if (src) periodo = await Periodo.findOne({ _id: src.periodoId }).lean();
  } else if (reciboId) {
    const Recibo = await getReciboNominaModel();
    const Aplicado = await getConceptoAplicadoModel();
    const r = await Recibo.findOne({ _id: reciboId, tenantId: req.session.tenantId }).lean();
    if (r) {
      periodo = await Periodo.findOne({ _id: r.periodoId }).lean();
      const conceptos = await Aplicado.find({ reciboId: r._id }).lean();
      const emp = await Empleado.findOne({ _id: r.empleadoId }).lean();
      src = {
        ...r,
        conceptos,
        empleado: emp,
        empleadoSnap: emp
      };
    }
  }
  if (!src) return res.status(404).send('Recibo no encontrado');

  const plantilla = await resolverPlantillaPdf(Plantilla, {
    tenantId: req.session.tenantId,
    empresaId: empresa._id,
    tipoPeriodoId: null,
    rfcEmisor: empresa.rfc
  });
  if (!plantilla) return res.status(400).send('No hay plantilla PDF activa. Crea una en Recibos PDF.');

  const catalogRows = await Catalog.find({}).select('codigo nombre tipo naturaleza claveSAT sat').lean();
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
          naturaleza: c.naturaleza || c.fiscal?.naturaleza || '',
          claveSAT: (c.sat && c.sat.clave) || c.claveSAT || ''
        }
      ];
    })
  );

  const snap = src.empleado || src.empleadoSnap || {};
  const live = src.empleadoId ? await Empleado.findOne({ _id: src.empleadoId }).lean() : null;
  const emp = await enrichEmpleadoPdf(mergeEmpleadoPdf(snap, live || {}));
  const ctx = buildReciboPdfContext({
    empresa,
    empleado: emp,
    periodo: { ...(periodo || {}), ...(src.periodo || {}) },
    recibo: src,
    conceptos: src.conceptos || [],
    cfdi: src.timbrado || {},
    catalogoNombres,
    catalogoMeta
  });
  const html = renderPlantillaHtml(plantilla.plantillaHtml, ctx);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

module.exports = {
  listPac,
  newPacForm,
  createPac,
  editPac,
  updatePac,
  togglePac,
  seedPacEjemplo,
  listPlantillas,
  newPlantillaForm,
  createPlantilla,
  editPlantilla,
  updatePlantilla,
  togglePlantilla,
  seedPlantillaEjemplo,
  aplicarLayoutCfdi,
  previewPlantilla,
  wizardTimbrado,
  generarTimbrado,
  showLote,
  descargarCfdiArchivo,
  reciboPdfHtml
};

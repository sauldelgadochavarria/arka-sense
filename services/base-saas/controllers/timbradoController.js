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
const {
  PAC_PROVEEDORES,
  PAC_SW_DEFAULTS,
  PAC_SW_TEST_URLS,
  RECIBO_PDF_VARIABLES,
  syncSwPacUrls,
  validateSwPacAmbiente
} = require('../config/timbradoCatalog');
const { PLANTILLA_PDF_CFDI } = require('../config/reciboPdfPlantillaCfdi');
const { crearYProcesarLote } = require('../services/timbradoService');
const { authenticateSw } = require('../services/pacClientService');
const { obtenerCfdiArchivoParaDescarga } = require('../services/cfdiArchivoService');
const { buildZipStore } = require('../libs/zipStore');
const getDepartamentoModel = require('../models/departamento');
const { ENTIDADES_FEDERATIVAS } = require('../config/empleadoCatalogos');
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
    urlTimbradoXml: trimString(body.urlTimbradoXml),
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
    codigoPostalSatTest: String(trimString(body.codigoPostalSatTest) || '62661')
      .replace(/\D/g, '')
      .slice(0, 5)
      .padStart(5, '0'),
    registroPatronalTest: trimUpper(body.registroPatronalTest)
      .replace(/\s+/g, '')
      .slice(0, 11) || 'Y671234510R',
    usarReceptorPrueba: parseCheckbox(body, 'usarReceptorPrueba'),
    rfcReceptorTest: trimUpper(body.rfcReceptorTest) || 'XOJI740919U48',
    nombreReceptorTest: trimString(body.nombreReceptorTest) || 'INGRID XODAR JIMENEZ',
    regimenReceptorTest: trimString(body.regimenReceptorTest) || '605',
    cpReceptorTest: String(trimString(body.cpReceptorTest) || '76028')
      .replace(/\D/g, '')
      .slice(0, 5)
      .padStart(5, '0'),
    nssReceptorTest: String(trimString(body.nssReceptorTest) || '12345678901')
      .replace(/\D/g, '')
      .slice(0, 11)
      .padStart(11, '0'),
    curpReceptorTest: trimUpper(body.curpReceptorTest)
      .replace(/\s+/g, '')
      .slice(0, 18) || 'XEXX010101HNEXXXA4',
    tipoContratoReceptorTest: String(trimString(body.tipoContratoReceptorTest) || '01')
      .replace(/\D/g, '')
      .padStart(2, '0')
      .slice(-2),
    tipoRegimenReceptorTest: String(trimString(body.tipoRegimenReceptorTest) || '02')
      .replace(/\D/g, '')
      .padStart(2, '0')
      .slice(-2),
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
    isNew: true,
    pac: { ...PAC_SW_DEFAULTS, codigo: 'SW-PROD', nombre: 'SW Sapien producción', activo: true, generarLayout: true },
    subsidiarias,
    proveedores: PAC_PROVEEDORES,
    testUrls: PAC_SW_TEST_URLS
  });
}

async function createPac(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/pac', 'error', error || 'Sin empresa');
  try {
    const Pac = await getPacConfigModel();
    const payload = syncSwPacUrls(pacFromBody(req.body, req.session.tenantId, empresa._id));
    if (!payload.codigo) throw new Error('Código requerido');
    if (!payload.password) payload.password = '';
    await Pac.create(payload);
    return flashRedirect(req, res, '/nomina/pac', 'success', 'PAC guardado correctamente.');
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
    isNew: false,
    pac: maskPac(pac),
    subsidiarias,
    proveedores: PAC_PROVEEDORES,
    testUrls: PAC_SW_TEST_URLS
  });
}

async function updatePac(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/pac', 'error', error || 'Sin empresa');
  try {
    const Pac = await getPacConfigModel();
    const payload = syncSwPacUrls(pacFromBody(req.body, req.session.tenantId, empresa._id));
    delete payload.tenantId;
    delete payload.empresaId;
    delete payload.codigo;
    await Pac.updateOne(
      { _id: req.params.id, tenantId: req.session.tenantId, empresaId: empresa._id },
      { $set: payload }
    );
    return flashRedirect(
      req,
      res,
      `/nomina/pac/${req.params.id}/edit`,
      'success',
      'PAC guardado correctamente.'
    );
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

async function probarPac(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/pac', 'error', error || 'Sin empresa');
  const Pac = await getPacConfigModel();
  const pac = await Pac.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa._id
  }).lean();
  if (!pac) return flashRedirect(req, res, '/nomina/pac', 'error', 'PAC no encontrado');
  const ambienteError = validateSwPacAmbiente(pac);
  if (ambienteError) {
    return flashRedirect(req, res, `/nomina/pac/${pac._id}/edit`, 'error', ambienteError);
  }
  try {
    const auth = await authenticateSw({
      urlAuth: pac.urlAuth,
      usuario: pac.usuario,
      password: pac.password,
      timeoutMs: (pac.timeout || 30) * 1000
    });
    const preview = auth.token.slice(0, 16);
    const host = String(pac.urlAuth || '').replace(/^https?:\/\//, '').split('/')[0];
    return flashRedirect(
      req,
      res,
      `/nomina/pac/${pac._id}/edit`,
      'success',
      `Conexión OK con SW (${host}). Token obtenido (${preview}…).`
    );
  } catch (err) {
    const hint =
      String(pac.ambiente) === '0' && String(pac.urlAuth || '').includes('services.sw.com.mx')
        ? ' Revise que ambiente y URL coincidan (pruebas → services.test.sw.com.mx).'
        : '';
    return flashRedirect(
      req,
      res,
      `/nomina/pac/${pac._id}/edit`,
      'error',
      (err.message || 'Error de autenticación') + hint
    );
  }
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
      ...PAC_SW_TEST_URLS,
      ambiente: '0',
      activo: true,
      generarLayout: true,
      modoReal: false,
      usuario: '',
      password: '',
      emailErrores: '',
      carpetaXml: '',
      notas: 'Ejemplo para pruebas en modo simulación (ambiente sandbox SW)'
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
          estatus: 'cerrado'
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

async function enrichLoteItems(tenantId, items = []) {
  const empIds = [...new Set(items.map((it) => it.empleadoId).filter(Boolean).map(String))];
  if (!empIds.length) {
    return items.map((it) => ({
      ...it,
      departamentoId: null,
      departamentoNombre: '',
      entidadFederativa: '',
      entidadLabel: ''
    }));
  }

  const Empleado = await getEmpleadoModel();
  const Departamento = await getDepartamentoModel();
  const empleados = await Empleado.find({ tenantId, _id: { $in: empIds } })
    .select('departamentoId domicilio entidadNacimiento entidadFederativa')
    .lean();
  const empById = new Map(empleados.map((e) => [String(e._id), e]));
  const deptoIds = [...new Set(empleados.map((e) => e.departamentoId).filter(Boolean).map(String))];
  const deptos = deptoIds.length
    ? await Departamento.find({ _id: { $in: deptoIds } }).select('nombre').lean()
    : [];
  const deptoById = new Map(deptos.map((d) => [String(d._id), d]));
  const entLabel = new Map(ENTIDADES_FEDERATIVAS.map((e) => [e.value, e.label]));

  return items.map((it) => {
    const emp = empById.get(String(it.empleadoId)) || {};
    const departamentoId = emp.departamentoId || null;
    const departamentoNombre = departamentoId
      ? deptoById.get(String(departamentoId))?.nombre || ''
      : '';
    const entidadFederativa = String(
      emp.entidadFederativa || emp.domicilio?.entidad || emp.entidadNacimiento || ''
    )
      .trim()
      .toUpperCase();
    return {
      ...it,
      departamentoId,
      departamentoNombre,
      entidadFederativa,
      entidadLabel: entLabel.get(entidadFederativa) || entidadFederativa
    };
  });
}

function uniqueFilterOptions(items) {
  const deptos = new Map();
  const entidades = new Map();
  for (const it of items) {
    if (it.departamentoId) {
      deptos.set(String(it.departamentoId), it.departamentoNombre || 'Sin nombre');
    }
    if (it.entidadFederativa) {
      entidades.set(it.entidadFederativa, it.entidadLabel || it.entidadFederativa);
    }
  }
  return {
    departamentos: [...deptos.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    entidades: [...entidades.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'))
  };
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

  const items = await enrichLoteItems(req.session.tenantId, lote.items || []);
  const filtros = uniqueFilterOptions(items);

  res.render('Nomina/timbrado/lote-show', {
    session: req.session,
    empresa,
    error,
    lote: { ...lote, items },
    filtros
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

/**
 * Descarga masiva XML y/o PDF de ítems seleccionados del lote (ZIP).
 * body: { itemIds: string|string[], incluirXml?: '1', incluirPdf?: '1' }
 */
async function descargarMasivoLote(req, res) {
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  const Lote = await getTimbradoLoteModel();
  const lote = await Lote.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa?._id
  }).lean();
  if (!lote) return res.status(404).send('Lote no encontrado');

  const rawIds = req.body.itemIds;
  const idList = Array.isArray(rawIds) ? rawIds : rawIds ? [rawIds] : [];
  const selected = new Set(idList.map(String).filter(Boolean));
  if (!selected.size) {
    return res.status(400).send('Selecciona al menos un recibo');
  }

  const incluirXml = req.body.incluirXml === '1' || req.body.incluirXml === 'on' || req.body.incluirXml === true;
  const incluirPdf = req.body.incluirPdf === '1' || req.body.incluirPdf === 'on' || req.body.incluirPdf === true;
  if (!incluirXml && !incluirPdf) {
    return res.status(400).send('Elige XML y/o PDF');
  }

  const items = (lote.items || []).filter((it) => selected.has(String(it._id)));
  if (!items.length) return res.status(400).send('Ningún ítem válido en la selección');

  const entries = [];
  const usedNames = new Set();
  const safeName = (base) => {
    let name = String(base || 'archivo').replace(/[^\w.\-]+/g, '_');
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
    let i = 2;
    while (usedNames.has(`${name}_${i}`)) i += 1;
    const alt = `${name}_${i}`;
    usedNames.add(alt);
    return alt;
  };

  for (const it of items) {
    const prefix = `${it.numEmpleado || 'emp'}_${String(it.uuid || it._id).slice(0, 8)}`;
    if (incluirXml && it.archivoXmlId) {
      const doc = await obtenerCfdiArchivoParaDescarga(req.session.tenantId, it.archivoXmlId);
      if (doc?.contenido) {
        const buf = Buffer.isBuffer(doc.contenido)
          ? doc.contenido
          : Buffer.from(doc.contenido.buffer || doc.contenido);
        const fname = safeName(doc.nombreArchivo || `${prefix}.xml`);
        entries.push({ name: `xml/${fname}`, data: buf });
      }
    }
    if (incluirPdf && it.archivoPdfId) {
      const doc = await obtenerCfdiArchivoParaDescarga(req.session.tenantId, it.archivoPdfId);
      if (doc?.contenido) {
        const buf = Buffer.isBuffer(doc.contenido)
          ? doc.contenido
          : Buffer.from(doc.contenido.buffer || doc.contenido);
        const ext = (doc.nombreArchivo || '').endsWith('.html') ? 'html' : 'pdf';
        const fname = safeName(doc.nombreArchivo || `${prefix}.${ext}`);
        entries.push({ name: `pdf/${fname}`, data: buf });
      }
    }
  }

  if (!entries.length) {
    return res.status(404).send('No hay archivos descargables para la selección');
  }

  const zip = buildZipStore(entries);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `timbrado_lote_${String(lote._id).slice(-6)}_${stamp}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', zip.length);
  return res.send(zip);
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
  probarPac,
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
  descargarMasivoLote,
  reciboPdfHtml
};

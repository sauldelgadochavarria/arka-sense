'use strict';

const {
  trimString,
  parseCheckbox,
  parseOptionalObjectId,
  parseDate,
  parsePositiveNumber
} = require('../libs/formHelpers');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { tenantHasFeature } = require('../libs/tenantFeatureFlags');
const {
  STORAGE_PROVEEDORES,
  LINNODE_ENDPOINTS,
  TIPOS_DOCUMENTO,
  GRUPOS,
  MESES
} = require('../config/gestionDocumentalCatalog');
const getPeriodoNominaModel = require('../models/periodoNomina');
const getEmpleadoModel = require('../models/empleado');
const {
  getOrCreateConfig,
  saveConfig,
  maskConfig,
  subirDocumento,
  listarDocumentos,
  obtenerContenido,
  eliminarDocumento,
  reporteCobertura,
  reindexarDesdeStorage,
  arbolResumen,
  tableroCumplimiento
} = require('../services/gestionDocumentalService');

function flashRedirect(req, res, path, type, msg) {
  if (req.flash) req.flash(type, msg);
  return res.redirect(path);
}

function featureFlagsFromReq(req) {
  return req.session?.featureFlags || req.tenant?.featureFlags || {};
}

function requireGestionDocumental(req, res) {
  if (tenantHasFeature(featureFlagsFromReq(req), 'gestion_documental')) return null;
  if (req.flash) {
    req.flash(
      'error',
      'Gestión documental no está habilitada para este tenant. Actívala en Admin → Features.'
    );
  }
  res.redirect('/dashboard');
  return false;
}

function userMeta(req) {
  return {
    userId: req.session.userid || req.session.userId || '',
    userLabel: req.session.user || req.session.email || req.session.username || ''
  };
}

async function tablero(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  let tableroData = null;
  if (empresa) {
    tableroData = await tableroCumplimiento({
      tenantId: req.session.tenantId,
      empresaId: empresa._id
    });
  }
  res.render('Nomina/gestion-documental/tablero', {
    session: req.session,
    empresa,
    error: error || (req.flash && req.flash('error')[0]) || '',
    tablero: tableroData
  });
}

async function explorador(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const anio = Number(req.query.anio) || new Date().getFullYear();
  const mes = req.query.mes ? Number(req.query.mes) : null;
  const ambito = trimString(req.query.ambito) || '';
  const tipoCodigo = trimString(req.query.tipoCodigo).toUpperCase();
  const grupo = trimString(req.query.grupo);
  const empleadoId = parseOptionalObjectId(req.query.empleadoId);
  const periodoId = parseOptionalObjectId(req.query.periodoId);

  let rows = [];
  let tree = {};
  let config = null;
  let periodos = [];
  let empleados = [];

  if (empresa) {
    config = maskConfig(await getOrCreateConfig(req.session.tenantId, empresa._id, empresa));
    rows = await listarDocumentos(req.session.tenantId, empresa._id, {
      anio,
      mes: mes || undefined,
      ambito: ambito || undefined,
      tipoCodigo: tipoCodigo || undefined,
      grupo: grupo || undefined,
      empleadoId: empleadoId || undefined,
      periodoId: periodoId || undefined
    });
    tree = await arbolResumen(req.session.tenantId, empresa._id, anio);
    const Periodo = await getPeriodoNominaModel();
    const Empleado = await getEmpleadoModel();
    periodos = await Periodo.find({ tenantId: req.session.tenantId, empresaId: empresa._id, anio })
      .sort({ numeroPeriodo: -1 })
      .limit(80)
      .lean();
    empleados = await Empleado.find({ tenantId: req.session.tenantId, empresaId: empresa._id, activo: true })
      .select('numEmpleado firstName lastName')
      .sort({ numEmpleado: 1 })
      .limit(500)
      .lean();
  }

  res.render('Nomina/gestion-documental/explorador', {
    session: req.session,
    empresa,
    error: error || (req.flash && req.flash('error')[0]) || '',
    success: (req.flash && req.flash('success')[0]) || '',
    config,
    rows,
    tree,
    periodos,
    empleados,
    filtros: { anio, mes, ambito, tipoCodigo, grupo, empleadoId, periodoId },
    tipos: TIPOS_DOCUMENTO,
    grupos: GRUPOS,
    meses: MESES
  });
}

async function configForm(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  let config = null;
  if (empresa) {
    config = maskConfig(await getOrCreateConfig(req.session.tenantId, empresa._id, empresa));
  }
  res.render('Nomina/gestion-documental/config', {
    session: req.session,
    empresa,
    error: error || (req.flash && req.flash('error')[0]) || '',
    success: (req.flash && req.flash('success')[0]) || '',
    config,
    proveedores: STORAGE_PROVEEDORES,
    linodeEndpoints: LINNODE_ENDPOINTS
  });
}

async function saveConfigAction(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) {
    return flashRedirect(req, res, '/nomina/gestion-documental/config', 'error', error || 'Sin empresa');
  }
  try {
    const proveedor = trimString(req.body.proveedor) === 's3' ? 's3' : 'local';
    const current = await getOrCreateConfig(req.session.tenantId, empresa._id, empresa);
    const secretIn = trimString(req.body.secretAccessKey);
    const secret =
      !secretIn || secretIn === '********' ? current.s3?.secretAccessKey || '' : secretIn;

    const payload = {
      proveedor,
      activo: !!parseCheckbox(req.body, 'activo'),
      empresaSlug: trimString(req.body.empresaSlug),
      versionado: !!parseCheckbox(req.body, 'versionado'),
      diasAvisoVencimiento: parsePositiveNumber(req.body.diasAvisoVencimiento) ?? 30,
      notas: trimString(req.body.notas),
      local: {
        rootPath: trimString(req.body.rootPath) || '/data/documentos',
        crearSubcarpetas: true
      },
      s3: {
        endpoint: trimString(req.body.endpoint) || 'https://us-east-1.linodeobjects.com',
        region: trimString(req.body.region) || 'us-east-1',
        bucket: trimString(req.body.bucket),
        accessKeyId: trimString(req.body.accessKeyId),
        secretAccessKey: secret,
        forcePathStyle: !!parseCheckbox(req.body, 'forcePathStyle'),
        prefix: trimString(req.body.prefix)
      },
      updatedByUserId: userMeta(req).userId,
      updatedByLabel: userMeta(req).userLabel
    };

    await saveConfig(req.session.tenantId, empresa._id, payload);
    return flashRedirect(req, res, '/nomina/gestion-documental/config', 'success', 'Configuración guardada');
  } catch (err) {
    return flashRedirect(req, res, '/nomina/gestion-documental/config', 'error', err.message);
  }
}

async function uploadForm(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Periodo = await getPeriodoNominaModel();
  const Empleado = await getEmpleadoModel();
  const anio = new Date().getFullYear();
  const periodos = empresa
    ? await Periodo.find({ tenantId: req.session.tenantId, empresaId: empresa._id })
        .sort({ anio: -1, numeroPeriodo: -1 })
        .limit(60)
        .lean()
    : [];
  const empleados = empresa
    ? await Empleado.find({ tenantId: req.session.tenantId, empresaId: empresa._id, activo: true })
        .select('numEmpleado firstName lastName')
        .sort({ numEmpleado: 1 })
        .limit(500)
        .lean()
    : [];
  res.render('Nomina/gestion-documental/upload', {
    session: req.session,
    empresa,
    error: error || (req.flash && req.flash('error')[0]) || '',
    tipos: TIPOS_DOCUMENTO,
    meses: MESES,
    periodos,
    empleados,
    anio
  });
}

async function uploadAction(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) {
    return flashRedirect(req, res, '/nomina/gestion-documental/subir', 'error', error || 'Sin empresa');
  }
  try {
    if (!req.file || !req.file.buffer) throw new Error('Selecciona un archivo');
    const tipoCodigo = trimString(req.body.tipoCodigo).toUpperCase();
    const tipo = TIPOS_DOCUMENTO.find((t) => t.codigo === tipoCodigo);
    if (!tipo) throw new Error('Tipo inválido');

    const periodoId = parseOptionalObjectId(req.body.periodoId);
    const empleadoId = parseOptionalObjectId(req.body.empleadoId);
    let periodo = null;
    let empleado = null;
    if (periodoId) {
      const Periodo = await getPeriodoNominaModel();
      periodo = await Periodo.findOne({ _id: periodoId, tenantId: req.session.tenantId }).lean();
    }
    if (empleadoId) {
      const Empleado = await getEmpleadoModel();
      empleado = await Empleado.findOne({ _id: empleadoId, tenantId: req.session.tenantId }).lean();
    }

    const anio =
      parsePositiveNumber(req.body.anio) ||
      (periodo?.fechaInicio ? new Date(periodo.fechaInicio).getFullYear() : new Date().getFullYear());
    const mes =
      parsePositiveNumber(req.body.mes) ||
      (periodo?.fechaInicio ? new Date(periodo.fechaInicio).getMonth() + 1 : null);

    await subirDocumento({
      tenantId: req.session.tenantId,
      empresa,
      tipoCodigo,
      anio,
      mes,
      periodoId,
      periodo,
      empleadoId,
      empleado,
      buffer: req.file.buffer,
      nombreOriginal: req.file.originalname,
      contentType: req.file.mimetype || 'application/octet-stream',
      vigenteDesde: parseDate(req.body.vigenteDesde),
      vigenteHasta: parseDate(req.body.vigenteHasta),
      notas: trimString(req.body.notas),
      origen: 'upload',
      ...userMeta(req)
    });
    return flashRedirect(req, res, '/nomina/gestion-documental', 'success', 'Documento cargado');
  } catch (err) {
    return flashRedirect(req, res, '/nomina/gestion-documental/subir', 'error', err.message);
  }
}

async function descargar(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  try {
    const { doc, buffer } = await obtenerContenido(
      req.session.tenantId,
      empresa._id,
      req.params.id,
      empresa
    );
    res.setHeader('Content-Type', doc.contentType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${String(doc.nombreOriginal || 'documento').replace(/"/g, '')}"`
    );
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    return flashRedirect(req, res, '/nomina/gestion-documental', 'error', err.message);
  }
}

async function eliminar(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  try {
    const hard = !!parseCheckbox(req.body, 'hard');
    await eliminarDocumento(req.session.tenantId, empresa._id, req.params.id, {
      hard,
      empresa
    });
    return flashRedirect(req, res, '/nomina/gestion-documental', 'success', hard ? 'Eliminado' : 'Archivado');
  } catch (err) {
    return flashRedirect(req, res, '/nomina/gestion-documental', 'error', err.message);
  }
}

async function reporte(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const anio = Number(req.query.anio) || new Date().getFullYear();
  const mes = req.query.mes ? Number(req.query.mes) : new Date().getMonth() + 1;
  let reporteData = null;
  if (empresa) {
    const Empleado = await getEmpleadoModel();
    const empleados = await Empleado.find({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      activo: true
    })
      .select('numEmpleado firstName lastName')
      .lean();
    reporteData = await reporteCobertura({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      anio,
      mes,
      empleados
    });
  }

  if (req.query.format === 'csv' && reporteData) {
    const lines = ['tipo,ambito,detalle'];
    for (const f of reporteData.faltantesMes || []) {
      lines.push(`"${f.codigo}",mes,"${f.nombre}"`);
    }
    for (const e of reporteData.faltantesEmpleado || []) {
      lines.push(
        `"${(e.faltantes || []).join('|')}",empleado,"${e.numEmpleado} ${e.nombre}"`
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cobertura_docs_${anio}_${mes}.csv"`);
    return res.send(lines.join('\n'));
  }

  res.render('Nomina/gestion-documental/reporte', {
    session: req.session,
    empresa,
    error,
    anio,
    mes,
    meses: MESES,
    reporte: reporteData
  });
}

async function reindexar(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) {
    return flashRedirect(req, res, '/nomina/gestion-documental', 'error', error || 'Sin empresa');
  }
  try {
    const result = await reindexarDesdeStorage({
      tenantId: req.session.tenantId,
      empresa
    });
    return flashRedirect(
      req,
      res,
      '/nomina/gestion-documental',
      'success',
      `Reindexado: ${result.creados} nuevos, ${result.yaIndexados} ya indexados, ${result.skipped} omitidos (${result.totalStorage} en storage)`
    );
  } catch (err) {
    return flashRedirect(req, res, '/nomina/gestion-documental', 'error', err.message);
  }
}

module.exports = {
  tablero,
  explorador,
  configForm,
  saveConfigAction,
  uploadForm,
  uploadAction,
  descargar,
  eliminar,
  reporte,
  reindexar
};

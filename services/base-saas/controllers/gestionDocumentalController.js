'use strict';

const {
  trimString,
  parseCheckbox,
  parseOptionalObjectId,
  parseDate,
  parsePositiveNumber
} = require('../libs/formHelpers');
const { requireEmpresaForTenant, sessionSubsidiariaId } = require('../libs/tenantScope');
const { listPeriodosNominaScoped, assertPeriodoEnSubsidiaria } = require('../libs/periodosNominaScope');
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

function volverSeguro(raw, fallback) {
  const v = String(raw || '').trim();
  if (/^\/personal-empleados\/[a-fA-F0-9]{24}(\/edit)?(#[a-z]+)?$/.test(v)) return v;
  return fallback;
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

async function catalogoDeSubsidiaria(tenantId, empresa, req, { anio = null, limit = 80, soloActivos = true } = {}) {
  const subId = sessionSubsidiariaId(req);
  const Empleado = await getEmpleadoModel();
  const empQ = { tenantId, empresaId: empresa._id };
  if (soloActivos) empQ.activo = true;
  if (subId) empQ.subsidiariaId = subId;
  const [empleados, periodos] = await Promise.all([
    Empleado.find(empQ).select('numEmpleado firstName lastName subsidiariaId').sort({ numEmpleado: 1 }).limit(500).lean(),
    listPeriodosNominaScoped({
      tenantId,
      empresaId: empresa._id,
      subsidiariaId: subId,
      filter: anio ? { anio } : {},
      limit
    })
  ]);
  return { empleados, periodos, subsidiariaId: subId };
}

async function tablero(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req);
  let tableroData = null;
  if (empresa) {
    tableroData = await tableroCumplimiento({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      subsidiariaId: sessionSubsidiariaId(req)
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
  const { empresa, error } = await requireEmpresaForTenant(req);
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
    const subId = sessionSubsidiariaId(req);
    const catalogo = await catalogoDeSubsidiaria(req.session.tenantId, empresa, req, { anio, limit: 80 });
    periodos = catalogo.periodos;
    empleados = catalogo.empleados;
    rows = await listarDocumentos(req.session.tenantId, empresa._id, {
      anio,
      mes: mes || undefined,
      ambito: ambito || undefined,
      tipoCodigo: tipoCodigo || undefined,
      grupo: grupo || undefined,
      empleadoId: empleadoId || undefined,
      periodoId: periodoId || undefined,
      subsidiariaId: subId
    });
    tree = await arbolResumen(req.session.tenantId, empresa._id, anio, subId);
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
  const { empresa, error } = await requireEmpresaForTenant(req);
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
  const { empresa, error } = await requireEmpresaForTenant(req);
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

function cargaDesdeQuery(req) {
  const permitidos = new Set(['SUA', 'ISR', 'INFONAVIT', 'NOMINA', 'ISN', 'TRABAJADOR', 'IVA']);
  const proceso = String(req.query.proceso || '').toUpperCase();
  const tipo = String(req.query.tipo || '').toUpperCase();
  const anioN = Number(req.query.anio);
  const mesN = Number(req.query.mes);
  return {
    proceso: permitidos.has(proceso) ? proceso : '',
    tipo: TIPOS_DOCUMENTO.some((t) => t.codigo === tipo) ? tipo : '',
    anio: anioN >= 2000 && anioN <= 2100 ? anioN : null,
    mes: mesN >= 1 && mesN <= 12 ? mesN : null
  };
}

async function uploadForm(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req);
  const anio = new Date().getFullYear();
  const catalogo = empresa
    ? await catalogoDeSubsidiaria(req.session.tenantId, empresa, req, { limit: 60 })
    : { periodos: [], empleados: [] };
  const periodos = catalogo.periodos;
  const empleados = catalogo.empleados;
  res.render('Nomina/gestion-documental/upload', {
    session: req.session,
    empresa,
    error: error || (req.flash && req.flash('error')[0]) || '',
    tipos: TIPOS_DOCUMENTO,
    meses: MESES,
    periodos,
    empleados,
    anio,
    carga: cargaDesdeQuery(req)
  });
}

async function uploadAction(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req);
  if (error || !empresa) {
    return flashRedirect(req, res, '/nomina/gestion-documental/subir', 'error', error || 'Sin empresa');
  }
  try {
    if (!req.file || !req.file.buffer) throw new Error('Selecciona un archivo');
    const tipoCodigo = trimString(req.body.tipoCodigo).toUpperCase();
    const tipo = TIPOS_DOCUMENTO.find((t) => t.codigo === tipoCodigo);
    if (!tipo) throw new Error('Tipo inválido');
    if (tipo.codigo === 'SUA_ARCHIVO') {
      const ext = String(req.file.originalname || '').split('.').pop().toLowerCase();
      if (ext !== 'sua') throw new Error('El archivo de pago del SUA debe tener extensión .sua');
    }

    const periodoId = parseOptionalObjectId(req.body.periodoId);
    const empleadoId = parseOptionalObjectId(req.body.empleadoId);
    let periodo = null;
    let empleado = null;
    const subId = sessionSubsidiariaId(req);
    if (periodoId) {
      const Periodo = await getPeriodoNominaModel();
      periodo = await Periodo.findOne({ _id: periodoId, tenantId: req.session.tenantId, empresaId: empresa._id }).lean();
      if (periodo && subId) {
        const ok = await assertPeriodoEnSubsidiaria(periodo, {
          tenantId: req.session.tenantId,
          empresaId: empresa._id,
          subsidiariaId: subId
        });
        if (!ok) throw new Error('El período no pertenece a la subsidiaria activa');
      }
    }
    if (empleadoId) {
      const Empleado = await getEmpleadoModel();
      const empQ = { _id: empleadoId, tenantId: req.session.tenantId, empresaId: empresa._id };
      if (subId) empQ.subsidiariaId = subId;
      empleado = await Empleado.findOne(empQ).lean();
      if (!empleado) throw new Error('El trabajador no pertenece a la subsidiaria activa');
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
      subsidiariaId: sessionSubsidiariaId(req),
      ...userMeta(req)
    });
    return flashRedirect(
      req,
      res,
      volverSeguro(req.body.volver, '/nomina/gestion-documental'),
      'success',
      'Documento cargado'
    );
  } catch (err) {
    return flashRedirect(
      req,
      res,
      volverSeguro(req.body.volver, '/nomina/gestion-documental/subir'),
      'error',
      err.message
    );
  }
}

async function descargar(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa } = await requireEmpresaForTenant(req);
  try {
    const { doc, buffer } = await obtenerContenido(
      req.session.tenantId,
      empresa._id,
      req.params.id,
      empresa,
      sessionSubsidiariaId(req)
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
  const { empresa } = await requireEmpresaForTenant(req);
  try {
    const hard = !!parseCheckbox(req.body, 'hard');
    await eliminarDocumento(req.session.tenantId, empresa._id, req.params.id, {
      hard,
      empresa,
      subsidiariaId: sessionSubsidiariaId(req)
    });
    return flashRedirect(req, res, '/nomina/gestion-documental', 'success', hard ? 'Eliminado' : 'Archivado');
  } catch (err) {
    return flashRedirect(req, res, '/nomina/gestion-documental', 'error', err.message);
  }
}

async function reporte(req, res) {
  if (requireGestionDocumental(req, res) === false) return;
  const { empresa, error } = await requireEmpresaForTenant(req);
  const anio = Number(req.query.anio) || new Date().getFullYear();
  const mes = req.query.mes ? Number(req.query.mes) : new Date().getMonth() + 1;
  let reporteData = null;
  if (empresa) {
    const catalogo = await catalogoDeSubsidiaria(req.session.tenantId, empresa, req, {
      soloActivos: true,
      limit: 1
    });
    reporteData = await reporteCobertura({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      anio,
      mes,
      empleados: catalogo.empleados,
      subsidiariaId: catalogo.subsidiariaId
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
  const { empresa, error } = await requireEmpresaForTenant(req);
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

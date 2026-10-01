'use strict';

const mongoose = require('mongoose');
const getEmpresaModel = require('../models/empresa');
const getSubsidiariaModel = require('../models/subsidiaria');

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ''));
}

function snapshotEmpresa(empresa) {
  if (!empresa) return null;
  return {
    _id: empresa._id,
    razonSocial: empresa.razonSocial || '',
    nombreComercial: empresa.nombreComercial || '',
    rfc: empresa.rfc || '',
    registroPatronal: empresa.registroPatronal || ''
  };
}

function snapshotSubsidiaria(sub) {
  if (!sub) return null;
  return {
    _id: sub._id,
    codigo: sub.codigo || '',
    nombre: sub.nombre || '',
    empresaId: sub.empresaId
  };
}

function sessionSubsidiariaId(req) {
  const id = req?.session?.subsidiariaActiva?._id;
  return id && isValidObjectId(id) ? String(id) : null;
}

/**
 * Filtro estándar para períodos / personal según empresa (+ subsidiaria activa).
 */
function scopeEmpresaFilter(req, empresa, { includeSubsidiaria = true } = {}) {
  if (!empresa) return null;
  const filter = {
    tenantId: String(req.session?.tenantId || ''),
    empresaId: empresa._id
  };
  if (includeSubsidiaria) {
    const subId = sessionSubsidiariaId(req);
    if (subId) filter.subsidiariaId = subId;
  }
  return filter;
}

/**
 * Filtro de empleados para operativa (asistencia / prenómina).
 * Con subsidiaria activa: solo esa subsidiaria (estricto).
 * Sin subsidiaria: toda la empresa (si se pasa empresaId) o tenant.
 */
function scopeEmpleadosFilter(
  { tenantId, empresaId = null, subsidiariaId = null } = {},
  { soloActivos = true } = {}
) {
  const filter = { tenantId: String(tenantId || '') };
  if (empresaId) filter.empresaId = empresaId;
  if (subsidiariaId) filter.subsidiariaId = subsidiariaId;
  if (soloActivos) {
    filter.estatus = 'activo';
    filter.activo = true;
  }
  return filter;
}

/**
 * Igual que scopeEmpleadosFilter pero leyendo sesión + empresa.
 */
function scopeEmpleadosFromReq(req, empresa, opts = {}) {
  if (!empresa) return null;
  return scopeEmpleadosFilter(
    {
      tenantId: req.session?.tenantId,
      empresaId: empresa._id,
      subsidiariaId: sessionSubsidiariaId(req)
    },
    opts
  );
}

async function findOneByTenant(Model, tenantId, id) {
  if (!tenantId || !isValidObjectId(id)) return null;
  return Model.findOne({ _id: id, tenantId }).lean();
}

async function findOneDocByTenant(Model, tenantId, id) {
  if (!tenantId || !isValidObjectId(id)) return null;
  return Model.findOne({ _id: id, tenantId });
}

async function findOneByEmpresa(Model, empresaId, id) {
  if (!empresaId || !isValidObjectId(id)) return null;
  return Model.findOne({ _id: id, empresaId }).lean();
}

async function findOneDocByEmpresa(Model, empresaId, id) {
  if (!empresaId || !isValidObjectId(id)) return null;
  return Model.findOne({ _id: id, empresaId });
}

async function listEmpresasForTenant(tenantId) {
  if (!tenantId) return [];
  const Empresa = await getEmpresaModel();
  return Empresa.find({ tenantId, activo: { $ne: false } })
    .sort({ razonSocial: 1 })
    .lean();
}

/**
 * Resuelve la empresa activa.
 * Acepta:
 * - requireEmpresaForTenant(req)
 * - requireEmpresaForTenant(tenantId)
 * - requireEmpresaForTenant(tenantId, empresaIdPreferred)
 */
async function requireEmpresaForTenant(tenantIdOrReq, empresaIdPreferred = null) {
  let tenantId = '';
  let preferred = empresaIdPreferred;

  if (tenantIdOrReq && typeof tenantIdOrReq === 'object' && tenantIdOrReq.session) {
    tenantId = String(tenantIdOrReq.session.tenantId || '');
    if (preferred == null || preferred === '') {
      preferred = tenantIdOrReq.session.empresaId || null;
    }
  } else {
    tenantId = String(tenantIdOrReq || '');
  }

  if (!tenantId) return { error: 'Tenant no definido' };

  const Empresa = await getEmpresaModel();

  if (preferred && isValidObjectId(preferred)) {
    const byId = await Empresa.findOne({ _id: preferred, tenantId }).lean();
    if (byId && byId.activo !== false) return { empresa: byId };
  }

  const empresa = await Empresa.findOne({ tenantId, activo: { $ne: false } })
    .sort({ createdAt: 1 })
    .lean();
  if (!empresa) return { error: 'Empresa no encontrada para este tenant' };
  return { empresa };
}

async function ensureSessionEmpresaContext(req) {
  const tenantId = String(req.session?.tenantId || '');
  if (!tenantId) {
    return { empresa: null, empresas: [], subsidiarias: [] };
  }

  const empresas = await listEmpresasForTenant(tenantId);
  if (!empresas.length) {
    req.session.empresaId = '';
    req.session.empresaActiva = null;
    req.session.subsidiariaActiva = null;
    return { empresa: null, empresas: [], subsidiarias: [] };
  }

  let empresaId = String(req.session.empresaId || '');
  let empresa = empresas.find((e) => String(e._id) === empresaId) || null;
  if (!empresa) {
    empresa = empresas[0];
    empresaId = String(empresa._id);
  }

  req.session.empresaId = empresaId;
  req.session.empresaActiva = snapshotEmpresa(empresa);

  const Subsidiaria = await getSubsidiariaModel();
  const subsidiarias = await Subsidiaria.find({ empresaId: empresa._id, activo: true }).lean();
  subsidiarias.sort((a, b) => {
    if (String(a.codigo).toUpperCase() === 'MAIN') return -1;
    if (String(b.codigo).toUpperCase() === 'MAIN') return 1;
    return String(a.codigo || '').localeCompare(String(b.codigo || ''), 'es');
  });

  const subActiva = req.session.subsidiariaActiva;
  const subId = subActiva ? String(subActiva._id || '') : '';
  const subOk = subsidiarias.find((s) => String(s._id) === subId) || null;
  if (!subOk) {
    req.session.subsidiariaActiva = snapshotSubsidiaria(subsidiarias[0] || null);
  } else {
    req.session.subsidiariaActiva = snapshotSubsidiaria(subOk);
  }

  return { empresa, empresas, subsidiarias };
}

async function setSessionEmpresa(req, empresaId) {
  const tenantId = String(req.session?.tenantId || '');
  if (!tenantId || !isValidObjectId(empresaId)) {
    throw new Error('Empresa inválida');
  }
  const Empresa = await getEmpresaModel();
  const empresa = await Empresa.findOne({ _id: empresaId, tenantId, activo: { $ne: false } }).lean();
  if (!empresa) throw new Error('Empresa no pertenece a esta cuenta');

  req.session.empresaId = String(empresa._id);
  req.session.empresaActiva = snapshotEmpresa(empresa);

  const Subsidiaria = await getSubsidiariaModel();
  let sub = await Subsidiaria.findOne({ empresaId: empresa._id, activo: true, codigo: 'MAIN' }).lean();
  if (!sub) {
    sub = await Subsidiaria.findOne({ empresaId: empresa._id, activo: true })
      .sort({ codigo: 1 })
      .lean();
  }
  req.session.subsidiariaActiva = snapshotSubsidiaria(sub);
  return empresa;
}

async function setSessionSubsidiaria(req, subsidiariaId) {
  const tenantId = String(req.session?.tenantId || '');
  if (!tenantId || !isValidObjectId(subsidiariaId)) {
    throw new Error('Subsidiaria inválida');
  }
  const { empresa } = await requireEmpresaForTenant(req);
  if (!empresa) throw new Error('Sin empresa activa');

  const Subsidiaria = await getSubsidiariaModel();
  const sub = await Subsidiaria.findOne({
    _id: subsidiariaId,
    empresaId: empresa._id,
    activo: true
  }).lean();
  if (!sub) throw new Error('Subsidiaria no pertenece a la empresa activa');

  req.session.subsidiariaActiva = snapshotSubsidiaria(sub);
  return sub;
}

/** Tras cambiar empresa/subsidiaria, evita quedarse en un detalle de otro contexto. */
function redirectAfterContextSwitch(req, fallback = '/dashboard') {
  const ref = String(req.get('Referer') || '');
  try {
    const u = new URL(ref, 'http://local');
    const path = u.pathname || '';
    if (/\/prenomina-periodos\/[a-f0-9]{24}/i.test(path)) return '/prenomina-periodos';
    if (/\/nomina\/periodos\/[a-f0-9]{24}/i.test(path)) return '/nomina/periodos';
    if (/\/personal-empleados\/[a-f0-9]{24}/i.test(path)) return '/personal-empleados';
    // Reportes pesados: volver sin query para no regenerar sábanota/export al cambiar de sub
    if (/\/nomina\/reportes\/acumulados/i.test(path)) return '/nomina/reportes/acumulados';
    if (/\/nomina\/reportes/i.test(path)) return '/nomina/reportes';
    if (path && path !== '/auth-login' && path !== '/logout') return path + (u.search || '');
  } catch (_) {}
  return fallback;
}

module.exports = {
  isValidObjectId,
  findOneByTenant,
  findOneDocByTenant,
  findOneByEmpresa,
  findOneDocByEmpresa,
  requireEmpresaForTenant,
  listEmpresasForTenant,
  ensureSessionEmpresaContext,
  setSessionEmpresa,
  setSessionSubsidiaria,
  snapshotEmpresa,
  snapshotSubsidiaria,
  sessionSubsidiariaId,
  scopeEmpresaFilter,
  scopeEmpleadosFilter,
  scopeEmpleadosFromReq,
  redirectAfterContextSwitch
};

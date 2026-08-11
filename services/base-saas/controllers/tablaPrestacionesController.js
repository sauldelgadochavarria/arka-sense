'use strict';

const getTablaPrestacionesModel = require('../models/tablaPrestaciones');
const getDepartamentoModel = require('../models/departamento');
const getPuestoModel = require('../models/puesto');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { buildTablaGlobalDefault, VACACIONES_LFT_TRAMOS, OTRAS_PRESTACIONES_CATALOGO, TRATAMIENTOS_PRESTACION } = require('../config/prestacionesDefaults');
const { ensureTablaGlobal } = require('../services/sdiCalculoService');
const { trimString, parseOptionalObjectId, parseCheckbox } = require('../libs/formHelpers');
const { getEnumItems, ensureSystemEnums } = require('../services/nomina/systemEnumService');
const { TIPOS_EMPLEADO } = require('../config/catalogos');

function parseTramos(body) {
  const rawDesde = [].concat(body.tramoAniosDesde || []);
  const rawHasta = [].concat(body.tramoAniosHasta || []);
  const rawDias = [].concat(body.tramoDiasVacaciones || []);
  const out = [];
  const n = Math.max(rawDesde.length, rawDias.length);
  for (let i = 0; i < n; i++) {
    const dias = Number(rawDias[i]);
    if (!Number.isFinite(dias)) continue;
    const desde = Number(rawDesde[i]);
    const hastaRaw = rawHasta[i];
    const hasta =
      hastaRaw === '' || hastaRaw == null || String(hastaRaw).toLowerCase() === 'null'
        ? null
        : Number(hastaRaw);
    out.push({
      aniosDesde: Number.isFinite(desde) ? desde : 0,
      aniosHasta: Number.isFinite(hasta) ? hasta : null,
      diasVacaciones: dias
    });
  }
  return out.length ? out : VACACIONES_LFT_TRAMOS;
}

function parseOtrasPrestaciones(body) {
  const codigos = [].concat(body.otraCodigo || []);
  const nombres = [].concat(body.otraNombre || []);
  const tratamientos = [].concat(body.otraTratamiento || []);
  const valores = [].concat(body.otraValor || []);
  const notas = [].concat(body.otraNotas || []);
  const activos = [].concat(body.otraActivo || []);
  const out = [];
  const n = Math.max(codigos.length, nombres.length);
  for (let i = 0; i < n; i++) {
    const codigo = String(codigos[i] || '')
      .trim()
      .toUpperCase();
    const nombre = String(nombres[i] || '').trim();
    if (!codigo && !nombre) continue;
    const tratamiento = String(tratamientos[i] || 'solo_nomina').trim();
    const valor = Number(valores[i]);
    out.push({
      codigo: codigo || 'OTRA',
      nombre: nombre || codigo || 'Otra',
      tratamiento: ['solo_nomina', 'monto_diario_sdi', 'dias_factor'].includes(tratamiento)
        ? tratamiento
        : 'solo_nomina',
      valor: Number.isFinite(valor) && valor >= 0 ? valor : 0,
      activo: activos[i] === '1' || activos[i] === 'on' || activos[i] === true,
      notas: String(notas[i] || '').trim()
    });
  }
  return out;
}

function buildPayload(body, tenantId, empresaId) {
  const ambito = trimString(body.ambito) || 'global';
  return {
    tenantId,
    empresaId,
    nombre: trimString(body.nombre) || 'Tabla prestaciones',
    ambito,
    tipoEmpleado: ambito === 'tipo_empleado' ? trimString(body.tipoEmpleado) : '',
    departamentoId: ambito === 'departamento' ? parseOptionalObjectId(body.departamentoId) : null,
    puestoId: ambito === 'puesto' ? parseOptionalObjectId(body.puestoId) : null,
    diasAguinaldo: Number(body.diasAguinaldo) || 15,
    primaVacacionalPct: Number(body.primaVacacionalPct) || 25,
    vacacionesPorAntiguedad: parseTramos(body),
    otrasPrestaciones: parseOtrasPrestaciones(body),
    activo: body.activo == null ? true : parseCheckbox(body, 'activo'),
    notas: trimString(body.notas)
  };
}

async function loadCatalogs(tenantId, empresaId) {
  await ensureSystemEnums();
  const Departamento = await getDepartamentoModel();
  const Puesto = await getPuestoModel();
  const tipoItems = await getEnumItems('tipo_empleado');
  const [departamentos, puestos] = await Promise.all([
    Departamento.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    Puesto.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean()
  ]);
  const tiposEmpleado =
    tipoItems && tipoItems.length
      ? tipoItems.map((i) => ({ value: i.value, label: i.label || i.value }))
      : TIPOS_EMPLEADO;
  return {
    departamentos,
    puestos,
    tiposEmpleado,
    catalogoOtras: OTRAS_PRESTACIONES_CATALOGO,
    tratamientos: TRATAMIENTOS_PRESTACION
  };
}

async function listTablas(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) {
    req.flash('error', error || 'Sin empresa');
    return res.redirect('/');
  }
  const Tabla = await getTablaPrestacionesModel();
  await ensureTablaGlobal(req.session.tenantId, empresa._id);
  const tablas = await Tabla.find({ tenantId: req.session.tenantId, empresaId: empresa._id })
    .sort({ ambito: -1, nombre: 1 })
    .lean();
  const catalogs = await loadCatalogs(req.session.tenantId, empresa._id);
  res.render('Personal/prestaciones-list', {
    tablas,
    ...catalogs,
    empresa,
    session: req.session,
    error: null
  });
}

async function newTabla(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) {
    req.flash('error', error || 'Sin empresa');
    return res.redirect('/personal/prestaciones');
  }
  const catalogs = await loadCatalogs(req.session.tenantId, empresa._id);
  res.render('Personal/prestaciones-edit', {
    tabla: null,
    tramos: VACACIONES_LFT_TRAMOS,
    otrasPrestaciones: [],
    ...catalogs,
    empresa,
    session: req.session,
    error: null
  });
}

async function createTabla(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error || !empresa) throw new Error(error || 'Sin empresa');
    const Tabla = await getTablaPrestacionesModel();
    await Tabla.create(buildPayload(req.body, req.session.tenantId, empresa._id));
    req.flash('success', 'Tabla de prestaciones creada');
    res.redirect('/personal/prestaciones');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo crear');
    res.redirect('/personal/prestaciones/nueva');
  }
}

async function editTabla(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Tabla = await getTablaPrestacionesModel();
  const tabla = await Tabla.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId
  }).lean();
  if (!tabla) {
    req.flash('error', 'Tabla no encontrada');
    return res.redirect('/personal/prestaciones');
  }
  const catalogs = await loadCatalogs(req.session.tenantId, empresa?._id);
  res.render('Personal/prestaciones-edit', {
    tabla,
    tramos: tabla.vacacionesPorAntiguedad?.length
      ? tabla.vacacionesPorAntiguedad
      : VACACIONES_LFT_TRAMOS,
    otrasPrestaciones: Array.isArray(tabla.otrasPrestaciones) ? tabla.otrasPrestaciones : [],
    ...catalogs,
    empresa,
    session: req.session,
    error: error || null
  });
}

async function updateTabla(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error || !empresa) throw new Error(error || 'Sin empresa');
    const Tabla = await getTablaPrestacionesModel();
    const payload = buildPayload(req.body, req.session.tenantId, empresa._id);
    await Tabla.updateOne(
      { _id: req.params.id, tenantId: req.session.tenantId },
      { $set: payload }
    );
    req.flash('success', 'Tabla actualizada');
    res.redirect('/personal/prestaciones');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo guardar');
    res.redirect(`/personal/prestaciones/${req.params.id}/edit`);
  }
}

async function toggleTabla(req, res) {
  const Tabla = await getTablaPrestacionesModel();
  const doc = await Tabla.findOne({ _id: req.params.id, tenantId: req.session.tenantId });
  if (doc) {
    doc.activo = !doc.activo;
    await doc.save();
  }
  res.redirect('/personal/prestaciones');
}

async function seedGlobal(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) {
    req.flash('error', error || 'Sin empresa');
    return res.redirect('/personal/prestaciones');
  }
  const Tabla = await getTablaPrestacionesModel();
  const exists = await Tabla.findOne({
    tenantId: req.session.tenantId,
    ambito: 'global',
    activo: true
  });
  if (!exists) {
    await Tabla.create(buildTablaGlobalDefault({ tenantId: req.session.tenantId, empresaId: empresa._id }));
    req.flash('success', 'Tabla global LFT creada');
  } else {
    req.flash('success', 'Ya existe una tabla global activa');
  }
  res.redirect('/personal/prestaciones');
}

module.exports = {
  listTablas,
  newTabla,
  createTabla,
  editTabla,
  updateTabla,
  toggleTabla,
  seedGlobal
};

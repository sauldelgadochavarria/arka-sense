'use strict';

const {
  listArticulos,
  getArticuloBySlug,
  getArticuloById,
  crearArticulo,
  actualizarArticulo,
  toggleArticulo
} = require('../services/ayudaService');
const { markdownToHtml } = require('../libs/markdownLite');
const { AYUDA_CATEGORIAS, labelCategoria } = require('../config/ayuda');
const { sessionRoles } = require('../libs/roleAccess');

function canManageAyuda(session) {
  const roles = sessionRoles(session);
  if (!roles.length) return true;
  return roles.some((r) => r.esAdmin || r.esAdminSistema || r.adminAccesoConfig);
}

function requireManage(req, res) {
  if (!canManageAyuda(req.session)) {
    req.flash('error', 'No tienes permiso para administrar la ayuda');
    res.redirect('/ayuda');
    return false;
  }
  return true;
}

async function index(req, res) {
  const q = String(req.query.q || '').trim();
  const categoria = String(req.query.categoria || '').trim();
  const articulos = await listArticulos(req.session.tenantId, { q, categoria });

  const porCategoria = new Map();
  for (const a of articulos) {
    const key = a.categoria || 'general';
    if (!porCategoria.has(key)) porCategoria.set(key, []);
    porCategoria.get(key).push(a);
  }

  const grupos = [...porCategoria.entries()].map(([cat, lista]) => ({
    categoria: cat,
    label: labelCategoria(cat),
    articulos: lista
  }));

  res.render('Ayuda/index', {
    title: 'Ayuda',
    articulos,
    grupos,
    categorias: AYUDA_CATEGORIAS,
    labelCategoria,
    q,
    categoria,
    canManage: canManageAyuda(req.session),
    session: req.session
  });
}

async function show(req, res) {
  const articulo = await getArticuloBySlug(req.session.tenantId, req.params.slug);
  if (!articulo) return res.status(404).send('Artículo no encontrado');

  res.render('Ayuda/show', {
    title: articulo.titulo,
    articulo,
    cuerpoHtml: markdownToHtml(articulo.cuerpo),
    labelCategoria,
    canManage: canManageAyuda(req.session),
    session: req.session
  });
}

async function admin(req, res) {
  if (requireManage(req, res) === false) return;

  const articulos = await listArticulos(req.session.tenantId, { incluirBorradores: true });
  res.render('Ayuda/admin', {
    title: 'Administrar ayuda',
    articulos,
    categorias: AYUDA_CATEGORIAS,
    labelCategoria,
    session: req.session
  });
}

async function nuevoForm(req, res) {
  if (requireManage(req, res) === false) return;

  res.render('Ayuda/edit', {
    title: 'Nuevo artículo',
    articulo: null,
    categorias: AYUDA_CATEGORIAS,
    session: req.session
  });
}

async function create(req, res) {
  if (requireManage(req, res) === false) return;

  try {
    const ambito = String(req.body.ambito || 'global');
    const doc = await crearArticulo({
      ...req.body,
      tenantId: ambito === 'tenant' ? req.session.tenantId : null,
      publicado: req.body.publicado === '1' || req.body.publicado === 'on'
    });
    req.flash('success', 'Artículo creado');
    res.redirect(`/ayuda/${doc.slug}`);
  } catch (err) {
    console.error('[ayuda]', err);
    req.flash('error', err.code === 11000 ? 'Ya existe un artículo con ese slug' : err.message || 'Error al crear');
    res.redirect('/ayuda/admin/nuevo');
  }
}

async function editForm(req, res) {
  if (requireManage(req, res) === false) return;

  const articulo = await getArticuloById(req.params.id);
  if (!articulo) return res.status(404).send('Artículo no encontrado');

  res.render('Ayuda/edit', {
    title: 'Editar artículo',
    articulo,
    categorias: AYUDA_CATEGORIAS,
    session: req.session
  });
}

async function update(req, res) {
  if (requireManage(req, res) === false) return;

  try {
    const doc = await actualizarArticulo(req.params.id, {
      ...req.body,
      ambito: req.body.ambito || 'global',
      tenantId: req.session.tenantId,
      publicado: req.body.publicado === '1' || req.body.publicado === 'on'
    });
    req.flash('success', 'Artículo actualizado');
    res.redirect(`/ayuda/${doc.slug}`);
  } catch (err) {
    console.error('[ayuda]', err);
    req.flash('error', err.code === 11000 ? 'Slug duplicado' : err.message || 'Error al guardar');
    res.redirect(`/ayuda/admin/${req.params.id}/edit`);
  }
}

async function toggle(req, res) {
  if (requireManage(req, res) === false) return;

  try {
    await toggleArticulo(req.params.id);
    req.flash('success', 'Estado del artículo actualizado');
  } catch (err) {
    req.flash('error', err.message || 'Error');
  }
  res.redirect('/ayuda/admin');
}

module.exports = {
  index,
  show,
  admin,
  nuevoForm,
  create,
  editForm,
  update,
  toggle
};

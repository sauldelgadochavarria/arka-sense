'use strict';

const getArticuloAyudaModel = require('../models/articuloAyuda');
const { slugify } = require('../libs/markdownLite');

function filtroVisibles(tenantId, { incluirBorradores = false } = {}) {
  const base = {
    activo: true,
    $or: [{ tenantId: null }, ...(tenantId ? [{ tenantId }] : [])]
  };
  if (!incluirBorradores) base.publicado = true;
  return base;
}

async function listArticulos(tenantId, { q = '', categoria = '', incluirBorradores = false } = {}) {
  const Articulo = await getArticuloAyudaModel();
  const filter = filtroVisibles(tenantId, { incluirBorradores });

  if (categoria) filter.categoria = categoria;

  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$and = [
      {
        $or: [{ titulo: rx }, { resumen: rx }, { tags: rx }, { cuerpo: rx }, { slug: rx }]
      }
    ];
  }

  return Articulo.find(filter).sort({ orden: 1, titulo: 1 }).lean();
}

async function getArticuloBySlug(tenantId, slug, { incluirBorradores = false } = {}) {
  const Articulo = await getArticuloAyudaModel();
  const filter = {
    ...filtroVisibles(tenantId, { incluirBorradores }),
    slug: String(slug || '').toLowerCase().trim()
  };
  // Preferir artículo del tenant sobre el global
  const docs = await Articulo.find(filter).lean();
  if (!docs.length) return null;
  const local = docs.find((d) => d.tenantId === tenantId);
  return local || docs[0];
}

async function getArticuloById(id) {
  const Articulo = await getArticuloAyudaModel();
  return Articulo.findById(id).lean();
}

async function crearArticulo(data) {
  const Articulo = await getArticuloAyudaModel();
  const titulo = String(data.titulo || '').trim();
  if (!titulo) throw new Error('El título es requerido');

  let slug = String(data.slug || '').trim().toLowerCase() || slugify(titulo);
  if (!slug) throw new Error('Slug inválido');

  const tags = Array.isArray(data.tags)
    ? data.tags
    : String(data.tags || '')
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

  return Articulo.create({
    tenantId: data.tenantId == null || data.tenantId === '' ? null : data.tenantId,
    slug,
    titulo,
    categoria: String(data.categoria || 'general').trim(),
    resumen: String(data.resumen || '').trim(),
    cuerpo: String(data.cuerpo || ''),
    tags,
    orden: Number(data.orden) || 100,
    publicado: data.publicado !== false && data.publicado !== '0',
    activo: true
  });
}

async function actualizarArticulo(id, data) {
  const Articulo = await getArticuloAyudaModel();
  const doc = await Articulo.findById(id);
  if (!doc) throw new Error('Artículo no encontrado');

  if (data.titulo != null) doc.titulo = String(data.titulo).trim();
  if (data.slug != null && String(data.slug).trim()) {
    doc.slug = String(data.slug).trim().toLowerCase();
  }
  if (data.categoria != null) doc.categoria = String(data.categoria).trim();
  if (data.resumen != null) doc.resumen = String(data.resumen).trim();
  if (data.cuerpo != null) doc.cuerpo = String(data.cuerpo);
  if (data.orden != null) doc.orden = Number(data.orden) || 100;
  if (data.publicado != null) {
    doc.publicado = data.publicado === true || data.publicado === '1' || data.publicado === 'on';
  }
  if (data.tags != null) {
    doc.tags = Array.isArray(data.tags)
      ? data.tags
      : String(data.tags)
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
  }
  if (data.ambito === 'global') doc.tenantId = null;
  else if (data.ambito === 'tenant' && data.tenantId) doc.tenantId = data.tenantId;

  await doc.save();
  return doc.toObject();
}

async function toggleArticulo(id) {
  const Articulo = await getArticuloAyudaModel();
  const doc = await Articulo.findById(id);
  if (!doc) throw new Error('Artículo no encontrado');
  doc.activo = !doc.activo;
  await doc.save();
  return doc.toObject();
}

async function upsertArticuloPorSlug(payload) {
  const Articulo = await getArticuloAyudaModel();
  const tenantId = payload.tenantId == null ? null : payload.tenantId;
  const slug = String(payload.slug).toLowerCase().trim();
  const filter = tenantId == null ? { tenantId: null, slug } : { tenantId, slug };

  await Articulo.updateOne(
    filter,
    {
      $set: {
        titulo: payload.titulo,
        categoria: payload.categoria || 'general',
        resumen: payload.resumen || '',
        cuerpo: payload.cuerpo || '',
        tags: payload.tags || [],
        orden: payload.orden || 100,
        publicado: payload.publicado !== false,
        activo: true
      },
      $setOnInsert: { tenantId, slug }
    },
    { upsert: true }
  );
}

module.exports = {
  listArticulos,
  getArticuloBySlug,
  getArticuloById,
  crearArticulo,
  actualizarArticulo,
  toggleArticulo,
  upsertArticuloPorSlug
};

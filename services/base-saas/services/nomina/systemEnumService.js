'use strict';

const getSystemEnumModel = require('../../models/systemEnum');
const { SYSTEM_ENUMS_SEED } = require('../../config/nominaArquitecturaSeed');

async function ensureSystemEnums() {
  const SystemEnum = await getSystemEnumModel();
  for (const grupo of SYSTEM_ENUMS_SEED) {
    await SystemEnum.updateOne(
      { grupo: grupo.grupo },
      {
        $set: {
          nombre: grupo.nombre,
          descripcion: grupo.descripcion || '',
          editable: grupo.editable !== false,
          activo: true
        },
        $setOnInsert: { items: grupo.items }
      },
      { upsert: true }
    );

    const existing = await SystemEnum.findOne({ grupo: grupo.grupo }).lean();
    if (!existing) continue;

    if (!existing.items || !existing.items.length) {
      await SystemEnum.updateOne({ grupo: grupo.grupo }, { $set: { items: grupo.items } });
      continue;
    }

    // Fusionar ítems nuevos del seed sin pisar los editados por el admin
    const byValue = new Map((existing.items || []).map((it) => [it.value, it]));
    let changed = false;
    for (const seedItem of grupo.items || []) {
      if (!byValue.has(seedItem.value)) {
        byValue.set(seedItem.value, seedItem);
        changed = true;
      }
    }
    if (changed) {
      await SystemEnum.updateOne(
        { grupo: grupo.grupo },
        { $set: { items: [...byValue.values()] } }
      );
    }
  }
  return SystemEnum.find({ activo: true }).sort({ grupo: 1 }).lean();
}

async function listSystemEnums() {
  const SystemEnum = await getSystemEnumModel();
  const count = await SystemEnum.countDocuments();
  if (!count) return ensureSystemEnums();
  return SystemEnum.find({ activo: true }).sort({ grupo: 1 }).lean();
}

async function getEnumItems(grupo) {
  const SystemEnum = await getSystemEnumModel();
  let doc = await SystemEnum.findOne({ grupo, activo: true }).lean();
  if (!doc) {
    await ensureSystemEnums();
    doc = await SystemEnum.findOne({ grupo, activo: true }).lean();
  }
  if (!doc) return [];
  return (doc.items || []).filter((i) => i.activo !== false).sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

async function updateEnumItems(grupo, items) {
  const SystemEnum = await getSystemEnumModel();
  const doc = await SystemEnum.findOne({ grupo });
  if (!doc) throw new Error('ENUM_NOT_FOUND');
  if (!doc.editable) throw new Error('ENUM_NOT_EDITABLE');
  doc.items = items;
  await doc.save();
  return doc.toObject();
}

/**
 * Variables de contexto para el editor (autocomplete / listado).
 * Prioriza catálogo en BD (formula_context_vars); fallback a código.
 */
async function getFormulaContextVariables(fallbackVariables = []) {
  const items = await getEnumItems('formula_context_vars');
  if (!items.length) {
    return fallbackVariables.map((v) => ({
      key: v.key,
      label: v.label || v.key,
      descripcion: v.descripcion || '',
      categoria: v.categoria || 'periodo',
      ejemplo: v.ejemplo,
      esConcepto: false
    }));
  }

  return items.map((it) => ({
    key: it.value,
    label: it.label || it.value,
    descripcion: it.descripcion || '',
    categoria: it.meta?.categoria || 'prenomina',
    ejemplo: it.meta?.ejemplo,
    esConcepto: false,
    namespace: it.meta?.namespace || ''
  }));
}

module.exports = {
  ensureSystemEnums,
  listSystemEnums,
  getEnumItems,
  updateEnumItems,
  getFormulaContextVariables
};

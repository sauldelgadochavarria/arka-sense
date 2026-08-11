'use strict';

const { parse, create, all } = require('mathjs');
const getFormulaFunctionModel = require('../../models/formulaFunction');
const {
  FORMULA_SYSTEM_FUNCTIONS,
  buildSystemFunctionImplementations
} = require('../../config/formulaSystemFunctions');
const {
  validateJavascriptCuerpo,
  evaluateJavascriptCuerpo
} = require('./formulaJsRunner');

/** Empieza en minúscula; permite camelCase (isrPeriodo, topeUMA). */
const NAME_RE = /^[a-z][a-zA-Z0-9_]*$/;

function normalizeName(name) {
  return String(name || '').trim();
}

function nameKey(name) {
  return normalizeName(name).toLowerCase();
}

function parseArgsList(raw) {
  if (Array.isArray(raw)) {
    return raw.map((a) => String(a).trim()).filter(Boolean);
  }
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);
}

function validateArgs(args) {
  for (const a of args) {
    if (!NAME_RE.test(a)) {
      throw new Error(`Argumento inválido: "${a}" (empieza en minúscula; a-zA-Z0-9_)`);
    }
  }
}

function validateExpresionCuerpo(cuerpo, args) {
  if (!cuerpo || !String(cuerpo).trim()) {
    throw new Error('El cuerpo (expresión mathjs) es obligatorio');
  }
  try {
    parse(String(cuerpo).trim());
  } catch (err) {
    throw new Error(`Cuerpo mathjs inválido: ${err.message}`);
  }
  validateArgs(args);
}

function validateCuerpo(tipo, cuerpo, args) {
  validateArgs(args);
  if (tipo === 'javascript') {
    validateJavascriptCuerpo(cuerpo, args);
    return;
  }
  validateExpresionCuerpo(cuerpo, args);
}

async function ensureFormulaFunctionsSeeded() {
  const FormulaFunction = await getFormulaFunctionModel();
  let created = 0;
  for (const f of FORMULA_SYSTEM_FUNCTIONS) {
    const name = normalizeName(f.name);
    const key = nameKey(name);
    const existing = await FormulaFunction.findOne({ nameKey: key, tenantId: null }).lean();
    if (existing) {
      await FormulaFunction.updateOne(
        { _id: existing._id },
        {
          $set: {
            name,
            nameKey: key,
            signature: f.signature || `${name}(…)`,
            descripcion: f.descripcion || '',
            ejemplo: f.ejemplo || '',
            tipo: 'nativa',
            esSistema: true,
            estado: 'publicado',
            activo: true,
            updatedAt: new Date()
          }
        }
      );
      continue;
    }
    await FormulaFunction.deleteMany({
      tenantId: null,
      $or: [{ name: key }, { name: name }, { nameKey: key }]
    });
    await FormulaFunction.create({
      name,
      nameKey: key,
      signature: f.signature || `${name}(…)`,
      descripcion: f.descripcion || '',
      ejemplo: f.ejemplo || '',
      tipo: 'nativa',
      args: [],
      cuerpo: '',
      cuerpoPublicado: '',
      esSistema: true,
      estado: 'publicado',
      activo: true,
      version: 1,
      tenantId: null
    });
    created += 1;
  }
  // Migración suave: expresiones activas sin estado → publicadas
  await FormulaFunction.updateMany(
    { tipo: { $in: ['expresion', 'javascript'] }, estado: { $exists: false } },
    { $set: { estado: 'publicado' } }
  );
  await FormulaFunction.updateMany(
    { tipo: { $in: ['expresion', 'javascript'] }, estado: null },
    { $set: { estado: 'publicado' } }
  );
  await syncFormulaFunctionsToSystemEnum().catch(() => {});
  return { created, total: FORMULA_SYSTEM_FUNCTIONS.length };
}

async function listFormulaFunctions({ includeInactive = true } = {}) {
  await ensureFormulaFunctionsSeeded();
  const FormulaFunction = await getFormulaFunctionModel();
  const filter = includeInactive ? {} : { activo: true, estado: 'publicado' };
  return FormulaFunction.find(filter).sort({ esSistema: -1, name: 1 }).lean();
}

async function listActiveFormulaFunctions() {
  await ensureFormulaFunctionsSeeded();
  const FormulaFunction = await getFormulaFunctionModel();
  return FormulaFunction.find({
    activo: true,
    $or: [{ tipo: 'nativa' }, { estado: 'publicado' }]
  })
    .sort({ esSistema: -1, name: 1 })
    .lean();
}

async function getFormulaFunctionById(id) {
  const FormulaFunction = await getFormulaFunctionModel();
  return FormulaFunction.findById(id).lean();
}

async function getFormulaFunctionByName(name) {
  const FormulaFunction = await getFormulaFunctionModel();
  return FormulaFunction.findOne({ nameKey: nameKey(name), tenantId: null }).lean();
}

async function crearFormulaFunction(data) {
  await ensureFormulaFunctionsSeeded();
  const name = normalizeName(data.name);
  if (!NAME_RE.test(name)) {
    throw new Error('Nombre inválido: empieza con minúscula; solo a-zA-Z0-9_ (camelCase ok)');
  }
  const key = nameKey(name);
  const reserved = new Set(FORMULA_SYSTEM_FUNCTIONS.map((f) => f.name.toLowerCase()));
  if (reserved.has(key)) {
    throw new Error(`"${name}" es función nativa del sistema; no se puede recrear`);
  }

  const tipo = data.tipo === 'javascript' ? 'javascript' : 'expresion';
  if (tipo === 'javascript' && data.allowJavascript !== true) {
    throw new Error(
      'Los scripts JavaScript solo se gestionan en la consola de plataforma (base-admin). Aquí solo expresiones mathjs.'
    );
  }
  const args = parseArgsList(data.args);
  const cuerpo = String(data.cuerpo || '').trim();
  validateCuerpo(tipo, cuerpo, args);

  const FormulaFunction = await getFormulaFunctionModel();
  const exists = await FormulaFunction.findOne({ nameKey: key, tenantId: null }).lean();
  if (exists) throw new Error(`Ya existe la función "${exists.name}"`);

  const signature =
    String(data.signature || '').trim() || `${name}(${args.join(', ')})`;
  const publicarYa = data.publicar === true || data.publicar === '1' || data.publicar === 'on';

  const created = await FormulaFunction.create({
    name,
    nameKey: key,
    signature,
    descripcion: String(data.descripcion || '').trim(),
    ejemplo: String(data.ejemplo || '').trim(),
    tipo,
    args,
    cuerpo,
    cuerpoPublicado: publicarYa ? cuerpo : '',
    esSistema: false,
    estado: publicarYa ? 'publicado' : 'borrador',
    activo: true,
    version: 1,
    tenantId: null
  });
  await syncFormulaFunctionsToSystemEnum().catch(() => {});
  return created.toObject ? created.toObject() : created;
}

async function actualizarFormulaFunction(id, data) {
  const FormulaFunction = await getFormulaFunctionModel();
  const doc = await FormulaFunction.findById(id);
  if (!doc) throw new Error('Función no encontrada');

  if (doc.tipo === 'nativa' || doc.esSistema) {
    if (data.descripcion !== undefined) doc.descripcion = String(data.descripcion || '').trim();
    if (data.ejemplo !== undefined) doc.ejemplo = String(data.ejemplo || '').trim();
    if (data.signature !== undefined) doc.signature = String(data.signature || '').trim();
    if (data.activo !== undefined) doc.activo = Boolean(data.activo);
    await doc.save();
    await syncFormulaFunctionsToSystemEnum().catch(() => {});
    return doc.toObject();
  }

  if (data.tipo === 'javascript' || data.tipo === 'expresion') {
    if (data.tipo === 'javascript' && data.allowJavascript !== true) {
      throw new Error(
        'Los scripts JavaScript solo se gestionan en la consola de plataforma (base-admin).'
      );
    }
    doc.tipo = data.tipo;
  }
  const args = data.args !== undefined ? parseArgsList(data.args) : doc.args;
  const cuerpo = data.cuerpo !== undefined ? String(data.cuerpo || '').trim() : doc.cuerpo;
  validateCuerpo(doc.tipo, cuerpo, args);
  const publicadoAnterior = doc.cuerpoPublicado || '';
  doc.args = args;
  doc.cuerpo = cuerpo;
  if (data.descripcion !== undefined) doc.descripcion = String(data.descripcion || '').trim();
  if (data.ejemplo !== undefined) doc.ejemplo = String(data.ejemplo || '').trim();
  doc.signature =
    String(data.signature || '').trim() || `${doc.name}(${args.join(', ')})`;
  if (data.activo !== undefined) doc.activo = Boolean(data.activo);

  // Cambios sobre una versión publicada → vuelve a borrador hasta Publish
  if (doc.estado === 'publicado' && cuerpo !== publicadoAnterior) {
    doc.estado = 'borrador';
  } else if (!doc.estado) {
    doc.estado = 'borrador';
  }

  await doc.save();
  await syncFormulaFunctionsToSystemEnum().catch(() => {});
  return doc.toObject();
}

async function publicarFormulaFunction(id) {
  const FormulaFunction = await getFormulaFunctionModel();
  const doc = await FormulaFunction.findById(id);
  if (!doc) throw new Error('Función no encontrada');
  if (doc.tipo === 'nativa' || doc.esSistema) {
    throw new Error('Las funciones nativas ya están publicadas en el motor');
  }
  validateCuerpo(doc.tipo, doc.cuerpo, doc.args || []);
  doc.cuerpoPublicado = doc.cuerpo;
  doc.estado = 'publicado';
  doc.activo = true;
  doc.version = (Number(doc.version) || 1) + 1;
  await doc.save();
  await syncFormulaFunctionsToSystemEnum().catch(() => {});
  return doc.toObject();
}

async function toggleFormulaFunction(id) {
  const FormulaFunction = await getFormulaFunctionModel();
  const doc = await FormulaFunction.findById(id);
  if (!doc) throw new Error('Función no encontrada');
  doc.activo = !doc.activo;
  await doc.save();
  await syncFormulaFunctionsToSystemEnum().catch(() => {});
  return doc.toObject();
}

/**
 * Valida sintaxis sin persistir (API).
 */
function validarFormulaFunctionPayload({ tipo, cuerpo, args }) {
  const t = tipo === 'javascript' ? 'javascript' : 'expresion';
  const a = parseArgsList(args);
  validateCuerpo(t, String(cuerpo || '').trim(), a);
  return { ok: true, tipo: t, args: a };
}

/**
 * Prueba ejecución con valores de ejemplo.
 */
function probarFormulaFunctionPayload({ tipo, cuerpo, args, valores }) {
  const t = tipo === 'javascript' ? 'javascript' : 'expresion';
  const a = parseArgsList(args);
  const c = String(cuerpo || '').trim();
  validateCuerpo(t, c, a);

  const valsRaw = Array.isArray(valores) ? valores : parseArgsList(valores);
  const argValues = a.map((_, i) => {
    const v = valsRaw[i];
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });

  let resultado;
  if (t === 'javascript') {
    resultado = evaluateJavascriptCuerpo(c, a, argValues);
  } else {
    const nativas = buildSystemFunctionImplementations({}, {});
    const localScope = create(all, { override: true });
    localScope.import(
      {
        min: Math.min,
        max: Math.max,
        abs: Math.abs,
        round: Math.round,
        floor: Math.floor,
        ceil: Math.ceil,
        redondear: nativas.redondear,
        si: nativas.si,
        topeUMA: nativas.topeUMA
      },
      { override: true }
    );
    const ctx = {};
    a.forEach((name, i) => {
      ctx[name] = argValues[i];
    });
    const val = localScope.evaluate(c, ctx);
    resultado = Number(val);
    if (!Number.isFinite(resultado)) resultado = 0;
  }

  return { ok: true, resultado, args: a, valores: argValues, tipo: t };
}

async function registrarUltimaPrueba(id, prueba) {
  if (!id) return;
  const FormulaFunction = await getFormulaFunctionModel();
  await FormulaFunction.updateOne(
    { _id: id },
    {
      $set: {
        ultimaPrueba: {
          ok: Boolean(prueba.ok),
          resultado: prueba.resultado ?? null,
          mensaje: prueba.mensaje || '',
          at: new Date()
        }
      }
    }
  );
}

function cuerpoEjecutable(fn) {
  if (fn.estado === 'publicado' && fn.cuerpoPublicado) return fn.cuerpoPublicado;
  if (fn.estado === 'publicado') return fn.cuerpo;
  return null;
}

/**
 * Construye implementaciones para el scope mathjs.
 * Solo nativas + custom publicadas y activas.
 */
async function buildCatalogFunctionImplementations(parametros = {}, tablaFns = {}) {
  const nativas = buildSystemFunctionImplementations(parametros, tablaFns);
  const activas = await listActiveFormulaFunctions();
  const out = { ...nativas };

  for (const fn of activas) {
    if (fn.tipo === 'nativa') continue;
    if (fn.activo === false) continue;
    if (fn.estado && fn.estado !== 'publicado') continue;

    const cuerpo = cuerpoEjecutable(fn) || fn.cuerpo;
    if (!cuerpo) continue;
    const argNames = Array.isArray(fn.args) ? fn.args : [];
    const name = fn.name;
    const tipo = fn.tipo;

    if (tipo === 'javascript') {
      out[name] = (...argValues) => {
        try {
          return evaluateJavascriptCuerpo(cuerpo, argNames, argValues);
        } catch (err) {
          throw new Error(`Función ${name}(...): ${err.message}`);
        }
      };
      continue;
    }

    if (tipo !== 'expresion') continue;
    out[name] = (...argValues) => {
      const localScope = create(all, { override: true });
      localScope.import(
        {
          min: Math.min,
          max: Math.max,
          abs: Math.abs,
          round: Math.round,
          floor: Math.floor,
          ceil: Math.ceil,
          redondear: nativas.redondear,
          si: nativas.si,
          topeUMA: nativas.topeUMA
        },
        { override: true }
      );
      const ctx = {};
      argNames.forEach((a, i) => {
        ctx[a] = argValues[i];
      });
      try {
        const val = localScope.evaluate(cuerpo, ctx);
        const n = Number(val);
        return Number.isFinite(n) ? n : 0;
      } catch (err) {
        throw new Error(`Función ${name}(...): ${err.message}`);
      }
    };
  }

  return out;
}

async function listFormulaFunctionsForAutocomplete() {
  const list = await listActiveFormulaFunctions();
  return list
    .filter((f) => f.tipo === 'nativa' || f.estado === 'publicado' || !f.estado)
    .map((f) => ({
      name: f.name,
      signature: f.signature || `${f.name}(…)`,
      descripcion: f.descripcion || '',
      ejemplo: f.ejemplo || '',
      tipo: f.tipo,
      estado: f.estado || 'publicado'
    }));
}

async function syncFormulaFunctionsToSystemEnum() {
  const FormulaFunction = await getFormulaFunctionModel();
  const all = await FormulaFunction.find({}).sort({ esSistema: -1, name: 1 }).lean();
  const items = all.map((f, i) => ({
    value: f.name,
    label: f.signature || f.name,
    descripcion:
      f.descripcion ||
      (f.tipo !== 'nativa' && f.cuerpo ? `${f.tipo}: ${String(f.cuerpo).slice(0, 80)}` : ''),
    orden: (i + 1) * 10,
    activo: f.activo !== false && (f.tipo === 'nativa' || f.estado === 'publicado' || !f.estado),
    meta: {
      tipo: f.tipo || 'nativa',
      estado: f.estado || 'publicado',
      ejemplo: f.ejemplo || '',
      cuerpo: f.tipo !== 'nativa' ? f.cuerpo || '' : '',
      args: Array.isArray(f.args) ? f.args : []
    }
  }));

  const getSystemEnumModel = require('../../models/systemEnum');
  const SystemEnum = await getSystemEnumModel();
  await SystemEnum.updateOne(
    { grupo: 'formula_functions' },
    {
      $set: {
        nombre: 'Funciones de fórmula',
        descripcion:
          'Funciones del scope (mathjs / JS). Editor: Nómina → Catálogos → Funciones de fórmula.',
        editable: false,
        activo: true,
        items
      }
    },
    { upsert: true }
  );
  return items.length;
}

module.exports = {
  ensureFormulaFunctionsSeeded,
  listFormulaFunctions,
  listActiveFormulaFunctions,
  getFormulaFunctionById,
  getFormulaFunctionByName,
  crearFormulaFunction,
  actualizarFormulaFunction,
  publicarFormulaFunction,
  toggleFormulaFunction,
  validarFormulaFunctionPayload,
  probarFormulaFunctionPayload,
  registrarUltimaPrueba,
  buildCatalogFunctionImplementations,
  listFormulaFunctionsForAutocomplete,
  syncFormulaFunctionsToSystemEnum
};

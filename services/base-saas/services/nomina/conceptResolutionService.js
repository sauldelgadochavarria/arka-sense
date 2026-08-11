'use strict';

const getConceptCatalogModel = require('../../models/conceptCatalog');
const { aplicaEnNomina, aplicaEnPrenomina } = require('../../models/conceptCatalog');
const getCompanyConceptConfigModel = require('../../models/companyConceptConfig');
const getFormulaConceptoModel = require('../../models/formulaConcepto');
const getConceptoNominaModel = require('../../models/conceptoNomina');
const {
  CONCEPT_CATALOG_SEED,
  DEFAULT_FORMULA_TEMPLATES
} = require('../../config/nominaArquitecturaSeed');

function defaultTipoAplicacion(codigo) {
  if (codigo === 'SUELDO' || codigo === 'SALARIO_PERIODO') return 'FIJO';
  if (
    String(codigo).startsWith('HORAS_EXTRA') ||
    codigo === 'PREMIO_PUNTUALIDAD' ||
    codigo === 'PREMIO_ASISTENCIA' ||
    codigo === 'HE_PRENOMINA' ||
    codigo === 'AGUINALDO' ||
    codigo === 'PRIMA_VACACIONAL'
  ) {
    return 'EVENTUAL';
  }
  if (['RETARDOS', 'FALTAS', 'SALIDA_ANTICIPADA'].includes(codigo)) return 'EVENTUAL';
  return 'FIJO';
}

async function ensureConceptCatalog() {
  const Catalog = await getConceptCatalogModel();
  for (const c of CONCEPT_CATALOG_SEED) {
    await Catalog.updateOne(
      { codigo: c.codigo },
      { $set: { ...c, activo: true }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  }
  return Catalog.find({ activo: true }).sort({ ordenDefault: 1, fase: 1 }).lean();
}

async function ensureCompanyConceptConfigs(tenantId, empresaId) {
  const Catalog = await getConceptCatalogModel();
  const Config = await getCompanyConceptConfigModel();
  let list = await Catalog.find({ activo: true }).lean();
  if (!list.length) {
    await ensureConceptCatalog();
    list = await Catalog.find({ activo: true }).lean();
  }

  for (const c of list) {
    await Config.updateOne(
      { tenantId, empresaId, conceptoCodigo: c.codigo },
      {
        $setOnInsert: {
          tenantId,
          empresaId,
          conceptoCodigo: c.codigo,
          activo: true,
          deshabilitado: false,
          tipoAplicacion: defaultTipoAplicacion(c.codigo),
          plantillaOrigen: 'default'
        }
      },
      { upsert: true }
    );
  }
  await syncTenantConceptosFromCatalog(tenantId, empresaId);
  return Config.find({ tenantId, empresaId }).lean();
}

async function ensureDefaultFormulas(tenantId, empresaId = null) {
  const Formula = await getFormulaConceptoModel();
  const vigenciaDesde = new Date('2026-01-01T00:00:00Z');
  const periodos = ['semanal', 'catorcenal', 'quincenal', 'mensual', 'decena'];

  for (const t of DEFAULT_FORMULA_TEMPLATES) {
    for (const tipoPeriodo of periodos) {
      const filter = {
        tenantId,
        conceptoCodigo: t.conceptoCodigo,
        tipoPeriodo,
        tipoNomina: t.tipoNomina,
        empresaId: empresaId || null,
        activo: true,
        $or: [{ vigenciaHasta: null }, { vigenciaHasta: { $gte: new Date() } }]
      };
      const exists = await Formula.findOne(filter).lean();
      if (exists) continue;

      await Formula.create({
        tenantId,
        empresaId: empresaId || null,
        conceptoCodigo: t.conceptoCodigo,
        tipoPeriodo,
        tipoNomina: t.tipoNomina,
        fase: t.fase,
        tipoAplicacion: t.tipoAplicacion,
        formula: t.formula,
        condicion: t.condicion || '',
        dependencias: t.dependencias || [],
        vigenciaDesde,
        vigenciaHasta: null,
        redondeo: 2,
        version: 1,
        activo: true
      });
    }
  }
}

async function syncTenantConceptosFromCatalog(tenantId, empresaId) {
  const Catalog = await getConceptCatalogModel();
  const ConceptoNomina = await getConceptoNominaModel();
  const list = await Catalog.find({ activo: true }).lean();
  if (!list.length) return [];

  const FORMULAS_OK = new Set([
    'salario_periodo',
    'horas_extra',
    'retardos',
    'faltas',
    'salida_anticipada',
    'manual'
  ]);

  for (const c of list) {
    const tipo =
      c.tipo === 'deduccion' ? 'deduccion' : c.tipo === 'otro_pago' ? 'otro_pago' : 'percepcion';
    const naturaleza = ['fiscal', 'gravado', 'exento', 'mixto', 'informativo'].includes(c.naturaleza)
      ? c.naturaleza
      : 'gravado';
    const aplicaEn = c.aplicaEn || 'nomina';
    const sat = c.sat && (c.sat.clave || c.claveSAT)
      ? {
          tipo: c.sat.tipo || tipo,
          clave: c.sat.clave || c.claveSAT || '',
          descripcion: c.sat.descripcion || c.nombre
        }
      : {
          tipo,
          clave: c.claveSAT || '',
          descripcion: c.nombre
        };
    const setDoc = {
      nombre: c.nombre,
      tipo,
      naturaleza,
      aplicaEn,
      clavePrenomina: c.clavePrenomina || '',
      tiposIncidencia: c.tiposIncidencia || [],
      insumosContexto: c.insumosContexto || [],
      fase: c.fase || 1,
      claveSAT: sat.clave || c.claveSAT || '',
      sat,
      fiscal: c.fiscal || undefined,
      ordenCalculo: c.ordenDefault || 100,
      activo: true,
      gravado: naturaleza !== 'exento',
      'metadata.fase': c.fase,
      'metadata.catalogClave': c.clave,
      'metadata.aplicaEn': aplicaEn,
      'metadata.tiposIncidencia': c.tiposIncidencia || [],
      'metadata.insumosContexto': c.insumosContexto || [],
      'metadata.esVariableSdi': c.fiscal?.imss?.naturalezaSdi === 'variable',
      'metadata.naturalezaSdi': c.fiscal?.imss?.naturalezaSdi || ''
    };
    if (!setDoc.fiscal) delete setDoc.fiscal;
    if (Array.isArray(c.aplicaTipoNomina) && c.aplicaTipoNomina.length) {
      setDoc.aplicaTipoNomina = c.aplicaTipoNomina;
    }
    if (c.formulaPrenomina && FORMULAS_OK.has(c.formulaPrenomina)) {
      setDoc.formulaPrenomina = c.formulaPrenomina;
    }

    await ConceptoNomina.updateOne(
      { tenantId, codigo: c.codigo },
      {
        $set: setDoc,
        $setOnInsert: {
          tenantId,
          empresaId,
          codigo: c.codigo,
          codigoExterno: '',
          ...(Array.isArray(c.aplicaTipoNomina) && c.aplicaTipoNomina.length
            ? {}
            : { aplicaTipoNomina: ['ordinaria', 'extraordinaria', 'finiquito'] }),
          dependientes: [],
          cuentaContable: ''
        }
      },
      { upsert: true }
    );
  }
  return ConceptoNomina.find({ tenantId, codigo: { $in: list.map((c) => c.codigo) } }).lean();
}

/** Compat: ya no escribe payroll_concepts; todo vive en nomina_conceptos. */
async function syncPayrollConceptsFromCatalog(tenantId, empresaId) {
  return syncTenantConceptosFromCatalog(tenantId, empresaId);
}

async function resolveConceptosParaEmpresa(tenantId, empresaId, { tipoPeriodo, tipoNomina, fecha = new Date() }) {
  await ensureConceptCatalog();
  await ensureCompanyConceptConfigs(tenantId, empresaId);
  await ensureDefaultFormulas(tenantId, null);

  const Catalog = await getConceptCatalogModel();
  const Config = await getCompanyConceptConfigModel();
  const Formula = await getFormulaConceptoModel();

  const [catalog, configs] = await Promise.all([
    Catalog.find({ activo: true }).lean(),
    Config.find({ tenantId, empresaId, activo: true, deshabilitado: { $ne: true } }).lean()
  ]);

  const configByCodigo = new Map(configs.map((c) => [c.conceptoCodigo, c]));
  const catalogByCodigo = new Map(catalog.map((c) => [c.codigo, c]));

  const codigos = [...configByCodigo.keys()].filter((codigo) => {
    const cat = catalogByCodigo.get(codigo);
    return cat && aplicaEnNomina(cat.aplicaEn);
  });

  const formulas = await Formula.find({
    tenantId,
    conceptoCodigo: { $in: codigos },
    tipoPeriodo,
    tipoNomina,
    activo: true,
    vigenciaDesde: { $lte: fecha },
    $and: [
      { $or: [{ vigenciaHasta: null }, { vigenciaHasta: { $gte: fecha } }] },
      { $or: [{ empresaId: null }, { empresaId }] }
    ]
  }).lean();

  const formulaByCodigo = new Map();
  for (const f of formulas) {
    const key = f.conceptoCodigo;
    const prev = formulaByCodigo.get(key);
    if (!prev) {
      formulaByCodigo.set(key, f);
      continue;
    }
    const prevIsCompany = prev.empresaId != null;
    const curIsCompany = f.empresaId != null;
    if (curIsCompany && !prevIsCompany) formulaByCodigo.set(key, f);
    else if (curIsCompany === prevIsCompany) {
      const curVer = Number(f.version) || 0;
      const prevVer = Number(prev.version) || 0;
      if (curVer > prevVer) formulaByCodigo.set(key, f);
      else if (curVer === prevVer && new Date(f.vigenciaDesde) > new Date(prev.vigenciaDesde)) {
        formulaByCodigo.set(key, f);
      }
    }
  }

  const resolved = [];
  for (const codigo of codigos) {
    const cat = catalogByCodigo.get(codigo);
    const cfg = configByCodigo.get(codigo);
    const formula = formulaByCodigo.get(codigo);
    if (!cat || !cfg) continue;
    resolved.push({
      codigo: cat.codigo,
      clave: cat.clave,
      nombre: cat.nombre,
      tipo: cat.tipo,
      naturaleza: cat.naturaleza,
      aplicaEn: cat.aplicaEn || 'nomina',
      tiposIncidencia: cat.tiposIncidencia || [],
      insumosContexto: cat.insumosContexto || [],
      fase: formula?.fase ?? cat.fase,
      tipoAplicacion: cfg.tipoAplicacion || formula?.tipoAplicacion || 'FIJO',
      formula: formula?.formula || '',
      condicion: formula?.condicion || '',
      dependencias: formula?.dependencias || [],
      redondeo: formula?.redondeo ?? 2,
      version: formula?.version || 1,
      orden: cfg.ordenOverride ?? cat.ordenDefault,
      formulaDoc: formula || null,
      config: cfg,
      catalog: cat
    });
  }

  resolved.sort((a, b) => a.fase - b.fase || a.orden - b.orden);
  return resolved;
}

async function getCatalogWithCompanyConfig(tenantId, empresaId, { ambito } = {}) {
  await ensureConceptCatalog();
  await ensureCompanyConceptConfigs(tenantId, empresaId);
  const Catalog = await getConceptCatalogModel();
  const Config = await getCompanyConceptConfigModel();
  let catalog = await Catalog.find({ activo: true }).sort({ ordenDefault: 1, fase: 1 }).lean();
  if (ambito === 'nomina') catalog = catalog.filter((c) => aplicaEnNomina(c.aplicaEn));
  if (ambito === 'prenomina') catalog = catalog.filter((c) => aplicaEnPrenomina(c.aplicaEn));

  const configs = await Config.find({ tenantId, empresaId }).lean();
  const cfgMap = new Map(configs.map((c) => [c.conceptoCodigo, c]));
  return catalog.map((c) => ({
    ...c,
    config: cfgMap.get(c.codigo) || null
  }));
}

function mergeResolvedWithLegacy(resolved, legacyFormulas) {
  const byCodigo = new Map();

  for (const r of resolved) {
    if (!r.formula) continue;
    byCodigo.set(r.codigo, {
      conceptoCodigo: r.codigo,
      formula: r.formula,
      condicion: r.condicion || '',
      dependencias: r.dependencias || [],
      redondeo: r.redondeo ?? 2,
      fase: r.fase || 1,
      tipoAplicacion: r.tipoAplicacion || 'FIJO',
      version: r.version || 1,
      orden: r.orden || 100
    });
  }

  for (const f of legacyFormulas) {
    if (byCodigo.has(f.conceptoCodigo)) continue;
    byCodigo.set(f.conceptoCodigo, {
      ...f,
      fase: f.fase || 1,
      tipoAplicacion: f.tipoAplicacion || 'FIJO',
      version: f.version || 1,
      orden: f.orden || 100
    });
  }

  return [...byCodigo.values()].sort((a, b) => a.fase - b.fase || a.orden - b.orden);
}

module.exports = {
  ensureConceptCatalog,
  ensureCompanyConceptConfigs,
  ensureDefaultFormulas,
  syncTenantConceptosFromCatalog,
  syncPayrollConceptsFromCatalog,
  resolveConceptosParaEmpresa,
  getCatalogWithCompanyConfig,
  mergeResolvedWithLegacy,
  aplicaEnNomina,
  aplicaEnPrenomina
};

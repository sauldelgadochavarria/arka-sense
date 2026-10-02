'use strict';

const getConceptCatalogModel = require('../../models/conceptCatalog');
const { aplicaEnNomina, aplicaEnPrenomina } = require('../../models/conceptCatalog');
const getCompanyConceptConfigModel = require('../../models/companyConceptConfig');
const getSubsidiaryConceptConfigModel = require('../../models/subsidiaryConceptConfig');
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
      // No forzar activo:true en cada sync — respeta deshabilitados del usuario
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
      { tenantId, empresaId, codigo: c.codigo },
      {
        $set: setDoc,
        $setOnInsert: {
          tenantId,
          empresaId,
          codigo: c.codigo,
          codigoExterno: '',
          activo: true,
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
  return ConceptoNomina.find({
    tenantId,
    empresaId,
    codigo: { $in: list.map((c) => c.codigo) }
  }).lean();
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

function sameSubId(a, b) {
  return String(a || '') === String(b || '');
}

/**
 * Registra / actualiza visibilidad de un concepto en una subsidiaria.
 */
async function upsertSubsidiaryConceptConfig({
  tenantId,
  empresaId,
  subsidiariaId = null,
  conceptoCodigo,
  origen = 'manual',
  aliasNombre = '',
  claveSat = '',
  claveInternaCfdi = '',
  tipo = '',
  activo = true
}) {
  const codigo = String(conceptoCodigo || '')
    .trim()
    .toUpperCase();
  if (!tenantId || !empresaId || !codigo) return null;

  const Config = await getSubsidiaryConceptConfigModel();
  const filter = {
    tenantId,
    empresaId,
    subsidiariaId: subsidiariaId || null,
    conceptoCodigo: codigo
  };
  await Config.updateOne(
    filter,
    {
      $set: {
        activo: activo !== false,
        deshabilitado: false,
        origen: origen || 'manual',
        ...(aliasNombre ? { aliasNombre: String(aliasNombre).trim() } : {}),
        ...(claveSat ? { claveSat: String(claveSat).trim() } : {}),
        ...(claveInternaCfdi
          ? { claveInternaCfdi: String(claveInternaCfdi).trim().toUpperCase() }
          : {}),
        ...(tipo ? { tipo: String(tipo).trim() } : {})
      },
      $setOnInsert: {
        tenantId,
        empresaId,
        subsidiariaId: subsidiariaId || null,
        conceptoCodigo: codigo,
        notas: ''
      }
    },
    { upsert: true }
  );
  return Config.findOne(filter).lean();
}

/**
 * Si la sub aún no tiene configs, las deduce de históricos (y períodos de esa sub).
 */
async function ensureSubsidiaryConceptConfigsFromHistorico(tenantId, empresaId, subsidiariaId = null) {
  const Config = await getSubsidiaryConceptConfigModel();
  const existing = await Config.countDocuments({
    tenantId,
    empresaId,
    subsidiariaId: subsidiariaId || null
  });
  if (existing > 0) return { skipped: true, existing };

  const getNominaHistoricoReciboModel = require('../../models/nominaHistoricoRecibo');
  const getPeriodoNominaModel = require('../../models/periodoNomina');
  const Historico = await getNominaHistoricoReciboModel();
  const PeriodoNomina = await getPeriodoNominaModel();

  const match = { tenantId, empresaId };
  if (subsidiariaId) {
    const periodoIds = await PeriodoNomina.find({
      tenantId,
      empresaId,
      subsidiariaId
    }).distinct('_id');
    match.$or = [{ subsidiariaId }, ...(periodoIds.length ? [{ periodoId: { $in: periodoIds } }] : [])];
  } else {
    match.$or = [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }];
  }

  const rows = await Historico.aggregate([
    { $match: match },
    { $unwind: '$conceptos' },
    {
      $group: {
        _id: {
          codigo: { $toUpper: '$conceptos.conceptoCodigo' },
          tipo: '$conceptos.tipo',
          claveSat: '$conceptos.claveSAT'
        },
        nombre: { $first: '$conceptos.conceptoCodigo' }
      }
    }
  ]);

  let inserted = 0;
  const { inferCodigoMotorFromSat } = require('./satConceptoInferService');
  for (const row of rows) {
    const codigoRaw = String(row._id?.codigo || '').trim().toUpperCase();
    if (!codigoRaw) continue;
    const inferred = await inferCodigoMotorFromSat({
      conceptoCodigo: codigoRaw,
      tipo: row._id?.tipo,
      claveSat: row._id?.claveSat,
      nombre: row.nombre || codigoRaw
    });
    const codigo = inferred.codigo || codigoRaw;
    await upsertSubsidiaryConceptConfig({
      tenantId,
      empresaId,
      subsidiariaId: subsidiariaId || null,
      conceptoCodigo: codigo,
      origen: inferred.inferred ? 'cfdi_sat' : 'historico',
      claveSat: inferred.claveSat || row._id?.claveSat || '',
      claveInternaCfdi: inferred.claveInterna || codigoRaw,
      tipo: row._id?.tipo || ''
    });
    inserted += 1;
  }
  return { skipped: false, inserted };
}

/**
 * Lista conceptos visibles para una subsidiaria:
 * - siempre: catálogo de empresa (company_concept_config)
 * - más: códigos registrados en subsidiary_concept_config de esa sub
 * - excluye: conceptos solo usados por otras subsidiarias (p.ej. CFDI)
 */
async function listConceptosVisiblesParaSubsidiaria(
  tenantId,
  empresaId,
  subsidiariaId = null,
  {
    ambito = null,
    soloActivos = false,
    backfillHistorico = true,
    ocultarDeshabilitados = true
  } = {}
) {
  const ConceptoNomina = await getConceptoNominaModel();
  const CompanyConfig = await getCompanyConceptConfigModel();
  const SubConfig = await getSubsidiaryConceptConfigModel();
  const mongoose = require('mongoose');
  const empresaOid = empresaId && mongoose.Types.ObjectId.isValid(String(empresaId))
    ? new mongoose.Types.ObjectId(String(empresaId))
    : empresaId;
  const subOid =
    subsidiariaId && mongoose.Types.ObjectId.isValid(String(subsidiariaId))
      ? new mongoose.Types.ObjectId(String(subsidiariaId))
      : null;

  if (backfillHistorico && empresaOid) {
    try {
      await ensureSubsidiaryConceptConfigsFromHistorico(tenantId, empresaOid, subOid);
    } catch (err) {
      console.warn('[listConceptosVisiblesParaSubsidiaria] backfill:', err.message);
    }
  }

  const companyQuery = {
    tenantId,
    ...andFilters(empresaIdMatchFilter(empresaOid))
  };
  // Reconstruir sin spread conflictivo
  const companyBase = andFilters({ tenantId }, empresaIdMatchFilter(empresaOid));
  const companyQueryFinal = { ...companyBase };
  if (ocultarDeshabilitados || soloActivos) {
    Object.assign(companyQueryFinal, {
      deshabilitado: { $ne: true },
      activo: { $ne: false }
    });
  }

  const subBase = andFilters(
    { tenantId },
    empresaIdMatchFilter(empresaOid),
    subsidiariaIdMatchFilter(subOid)
  );
  const subFilter = { ...subBase };
  if (ocultarDeshabilitados || soloActivos) {
    Object.assign(subFilter, {
      deshabilitado: { $ne: true },
      activo: { $ne: false }
    });
  }

  const [allConceptos, companyCfgs, subCfgs] = await Promise.all([
    ConceptoNomina.find({ tenantId }).sort({ ordenCalculo: 1, codigo: 1 }).lean(),
    empresaOid
      ? CompanyConfig.find(companyQueryFinal)
          .select('conceptoCodigo activo deshabilitado')
          .lean()
      : Promise.resolve([]),
    empresaOid ? SubConfig.find(subFilter).lean() : Promise.resolve([])
  ]);

  const companyByCodigo = new Map(
    companyCfgs.map((c) => [String(c.conceptoCodigo).toUpperCase(), c])
  );
  const companyCodes = new Set(companyByCodigo.keys());
  const subByCodigo = new Map(
    subCfgs.map((c) => [String(c.conceptoCodigo).toUpperCase(), c])
  );
  const subCodes = new Set(subByCodigo.keys());

  const hayFiltro = companyCodes.size > 0 || subCodes.size > 0;

  let list = allConceptos.filter((c) => {
    const codigo = String(c.codigo || '').toUpperCase();
    if (!hayFiltro) return true;
    if ((ocultarDeshabilitados || soloActivos) && c.activo === false) return false;
    return companyCodes.has(codigo) || subCodes.has(codigo);
  });

  if (ambito === 'nomina') {
    list = list.filter((c) => {
      const a = c.aplicaEn || c.metadata?.aplicaEn || 'nomina';
      return a === 'nomina' || a === 'ambos' || !c.aplicaEn;
    });
  } else if (ambito === 'prenomina') {
    list = list.filter((c) => {
      const a = c.aplicaEn || c.metadata?.aplicaEn || 'nomina';
      return a === 'prenomina' || a === 'ambos';
    });
  }

  return list.map((c) => {
    const codigo = String(c.codigo || '').toUpperCase();
    const sub = subByCodigo.get(codigo) || null;
    const companyConfig = companyByCodigo.get(codigo) || null;
    const activoUi =
      c.activo !== false &&
      !(companyConfig && (companyConfig.deshabilitado || companyConfig.activo === false)) &&
      !(sub && (sub.deshabilitado || sub.activo === false));
    return {
      ...c,
      aplicaEn: c.aplicaEn || c.metadata?.aplicaEn || 'nomina',
      tiposIncidencia: c.tiposIncidencia || c.metadata?.tiposIncidencia || [],
      subsidiaryConfig: sub,
      companyConfig,
      activoUi,
      visiblePor: companyCodes.has(codigo) ? (sub ? 'catalogo+sub' : 'catalogo') : 'sub'
    };
  });
}

function empresaIdMatchFilter(empresaId) {
  const mongoose = require('mongoose');
  const raw = String(empresaId || '');
  const ors = [];
  if (raw && mongoose.Types.ObjectId.isValid(raw)) {
    ors.push({ empresaId: new mongoose.Types.ObjectId(raw) });
  }
  if (raw) ors.push({ empresaId: raw });
  if (!ors.length) return { empresaId: null };
  return ors.length === 1 ? ors[0] : { $or: ors };
}

function subsidiariaIdMatchFilter(subsidiariaId) {
  const mongoose = require('mongoose');
  if (subsidiariaId == null || subsidiariaId === '') {
    return {
      $or: [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }]
    };
  }
  const raw = String(subsidiariaId);
  const ors = [];
  if (mongoose.Types.ObjectId.isValid(raw)) {
    ors.push({ subsidiariaId: new mongoose.Types.ObjectId(raw) });
  }
  ors.push({ subsidiariaId: raw });
  return ors.length === 1 ? ors[0] : { $or: ors };
}

function andFilters(...parts) {
  const and = [];
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    and.push(p);
  }
  if (!and.length) return {};
  if (and.length === 1) return and[0];
  return { $and: and };
}

/**
 * Fuerza activo/inactivo de un concepto (no hace toggle ambiguo).
 * Actualiza company_concept_config + subsidiary_concept_config + nomina_conceptos.
 */
async function setConceptoVisibilidad(
  tenantId,
  empresaId,
  subsidiariaId,
  conceptoCodigo,
  activo
) {
  const codigo = String(conceptoCodigo || '')
    .trim()
    .toUpperCase();
  const nextActivo = !!activo;
  if (!tenantId || !empresaId || !codigo) {
    throw new Error('Datos incompletos para cambiar visibilidad del concepto');
  }

  const CompanyConfig = await getCompanyConceptConfigModel();
  const SubConfig = await getSubsidiaryConceptConfigModel();
  const ConceptoNomina = await getConceptoNominaModel();
  const mongoose = require('mongoose');
  const empresaOid = mongoose.Types.ObjectId.isValid(String(empresaId))
    ? new mongoose.Types.ObjectId(String(empresaId))
    : empresaId;
  const subOid =
    subsidiariaId && mongoose.Types.ObjectId.isValid(String(subsidiariaId))
      ? new mongoose.Types.ObjectId(String(subsidiariaId))
      : null;

  const companyFilter = andFilters(
    { tenantId, conceptoCodigo: codigo },
    empresaIdMatchFilter(empresaOid)
  );
  const companyExists = await CompanyConfig.countDocuments(companyFilter);
  if (companyExists) {
    await CompanyConfig.updateMany(companyFilter, {
      $set: {
        activo: nextActivo,
        deshabilitado: !nextActivo
      }
    });
  } else {
    await CompanyConfig.create({
      tenantId,
      empresaId: empresaOid,
      conceptoCodigo: codigo,
      activo: nextActivo,
      deshabilitado: !nextActivo,
      tipoAplicacion: 'FIJO',
      plantillaOrigen: 'manual-toggle',
      notas: ''
    });
  }

  const subFilter = andFilters(
    { tenantId, conceptoCodigo: codigo },
    empresaIdMatchFilter(empresaOid),
    subsidiariaIdMatchFilter(subOid)
  );
  const subExists = await SubConfig.countDocuments(subFilter);
  if (subExists) {
    await SubConfig.updateMany(subFilter, {
      $set: {
        activo: nextActivo,
        deshabilitado: !nextActivo
      }
    });
  } else {
    await SubConfig.create({
      tenantId,
      empresaId: empresaOid,
      subsidiariaId: subOid,
      conceptoCodigo: codigo,
      activo: nextActivo,
      deshabilitado: !nextActivo,
      origen: 'manual',
      aliasNombre: '',
      claveSat: '',
      tipo: '',
      notas: ''
    });
  }

  const maestro = await ConceptoNomina.updateOne(
    { tenantId, codigo },
    { $set: { activo: nextActivo } }
  );
  const matched = Number(maestro.matchedCount ?? maestro.n ?? 0);
  if (!matched) {
    throw new Error(`Concepto ${codigo} no encontrado en el catálogo maestro`);
  }

  return { codigo, activo: nextActivo };
}

/**
 * Activa/desactiva un concepto de forma persistente (toggle).
 */
async function toggleConceptoVisibilidad(tenantId, empresaId, subsidiariaId, conceptoCodigo) {
  const codigo = String(conceptoCodigo || '')
    .trim()
    .toUpperCase();
  if (!tenantId || !empresaId || !codigo) {
    throw new Error('Datos incompletos para toggle de concepto');
  }

  const CompanyConfig = await getCompanyConceptConfigModel();
  const SubConfig = await getSubsidiaryConceptConfigModel();
  const ConceptoNomina = await getConceptoNominaModel();
  const mongoose = require('mongoose');
  const empresaOid = mongoose.Types.ObjectId.isValid(String(empresaId))
    ? new mongoose.Types.ObjectId(String(empresaId))
    : empresaId;
  const subOid =
    subsidiariaId && mongoose.Types.ObjectId.isValid(String(subsidiariaId))
      ? new mongoose.Types.ObjectId(String(subsidiariaId))
      : null;

  const company = await CompanyConfig.findOne({
    tenantId,
    empresaId: empresaOid,
    conceptoCodigo: codigo
  }).lean();
  const sub = await SubConfig.findOne({
    tenantId,
    empresaId: empresaOid,
    subsidiariaId: subOid,
    conceptoCodigo: codigo
  }).lean();
  const maestro = await ConceptoNomina.findOne({ tenantId, codigo }).lean();

  const currentlyOn =
    (maestro ? maestro.activo !== false : true) &&
    (company ? company.deshabilitado !== true && company.activo !== false : true) &&
    (sub ? sub.deshabilitado !== true && sub.activo !== false : true);

  return setConceptoVisibilidad(tenantId, empresaOid, subOid, codigo, !currentlyOn);
}

async function toggleSubsidiaryConceptConfig(tenantId, empresaId, subsidiariaId, conceptoCodigo) {
  return toggleConceptoVisibilidad(tenantId, empresaId, subsidiariaId, conceptoCodigo);
}

/** Núcleo operativo que no se apaga aunque no aparezca en CFDI/histórico. */
const KEEP_PARALELO_OPERATIVO = new Set([
  'SUELDO',
  'HORAS_EXTRA_DOBLES',
  'HORAS_EXTRA_TRIPLES',
  'PREMIO_PUNTUALIDAD',
  'PREMIO_ASISTENCIA',
  'FONDO_AHORRO_EMPRESA',
  'FONDO_AHORRO_TRABAJADOR',
  'DED_FONDO_AHORRO',
  'ISR',
  'ISR_SAT',
  'ISR_PROYECTADO',
  'ISR_AJUSTADO',
  'ISR_DIFERENCIA',
  'IMSS_OBRERO',
  'IMSS_RCV',
  'IMSS_PATRONAL',
  'INFONAVIT',
  'FONACOT',
  'CUOTA_SINDICAL',
  'PERCEPCIONES_GRAVADAS',
  'DEDUCCIONES_TOTALES',
  'NETO_PAGAR',
  'SALARIO_PERIODO',
  'HE_PRENOMINA',
  'RETARDOS',
  'FALTAS',
  'SALIDA_ANTICIPADA',
  'AGUINALDO',
  'PRIMA_VACACIONAL',
  'VACACIONES'
]);

/**
 * Deshabilita conceptos de catálogo/seed previos al histórico para el primer paralelo.
 * Conserva: KEEP operativo + códigos con origen cfdi/historico en la sub.
 * No borra documentos de nomina_conceptos.
 */
async function deshabilitarConceptosPreviosAlHistor({
  tenantId,
  empresaId,
  subsidiariaId = null,
  keepExtra = []
}) {
  if (!tenantId || !empresaId) {
    throw new Error('tenantId y empresaId requeridos');
  }

  await ensureSubsidiaryConceptConfigsFromHistorico(tenantId, empresaId, subsidiariaId);

  const CompanyConfig = await getCompanyConceptConfigModel();
  const SubConfig = await getSubsidiaryConceptConfigModel();

  const keep = new Set([
    ...KEEP_PARALELO_OPERATIVO,
    ...keepExtra.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)
  ]);

  const subRows = await SubConfig.find({
    tenantId,
    empresaId,
    subsidiariaId: subsidiariaId || null,
    origen: { $in: ['cfdi', 'historico'] },
    deshabilitado: { $ne: true }
  })
    .select('conceptoCodigo')
    .lean();

  for (const row of subRows) {
    const codigo = String(row.conceptoCodigo || '').toUpperCase();
    if (codigo) keep.add(codigo);
  }

  const companyFilter = {
    tenantId,
    empresaId,
    conceptoCodigo: { $nin: [...keep] },
    deshabilitado: { $ne: true }
  };
  const companyCandidates = await CompanyConfig.find(companyFilter)
    .select('conceptoCodigo plantillaOrigen')
    .lean();

  const companyResult = await CompanyConfig.updateMany(companyFilter, {
    $set: { deshabilitado: true, activo: false }
  });

  // En la sub: ocultar cualquier config que no esté en keep (incluye catalog/manual y huérfanos)
  const subFilter = {
    tenantId,
    empresaId,
    subsidiariaId: subsidiariaId || null,
    conceptoCodigo: { $nin: [...keep] },
    deshabilitado: { $ne: true }
  };
  const subCandidates = await SubConfig.find(subFilter).select('conceptoCodigo origen').lean();
  const subResult = await SubConfig.updateMany(subFilter, {
    $set: { deshabilitado: true, activo: false }
  });

  const ConceptoNomina = await getConceptoNominaModel();
  const maestroResult = await ConceptoNomina.updateMany(
    {
      tenantId,
      codigo: { $nin: [...keep] },
      activo: { $ne: false }
    },
    { $set: { activo: false } }
  );

  return {
    keep: [...keep].sort(),
    companyDeshabilitados: companyResult.modifiedCount || 0,
    companyCodigos: companyCandidates.map((c) => c.conceptoCodigo).sort(),
    subDeshabilitados: subResult.modifiedCount || 0,
    subCodigos: subCandidates.map((c) => c.conceptoCodigo).sort(),
    maestroDeshabilitados: maestroResult.modifiedCount || 0
  };
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
  upsertSubsidiaryConceptConfig,
  ensureSubsidiaryConceptConfigsFromHistorico,
  listConceptosVisiblesParaSubsidiaria,
  toggleSubsidiaryConceptConfig,
  toggleConceptoVisibilidad,
  setConceptoVisibilidad,
  deshabilitarConceptosPreviosAlHistor,
  KEEP_PARALELO_OPERATIVO,
  sameSubId,
  aplicaEnNomina,
  aplicaEnPrenomina
};

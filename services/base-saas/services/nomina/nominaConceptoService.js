'use strict';

const getConceptoNominaModel = require('../../models/conceptoNomina');
const getFormulaConceptoModel = require('../../models/formulaConcepto');
const {
  CONCEPTOS_BASE,
  FORMULAS_BASE,
  FORMULAS_FISCALES_V2,
  VIGENCIA_INICIAL,
  VIGENCIA_FISCAL_V2
} = require('../../config/nominaDefaults');
const {
  CONCEPTOS_CAPA_B,
  FORMULAS_CAPA_B,
  VIGENCIA_CAPA_B,
  MAPEO_CANONICO_LEGADO
} = require('../../config/nominaConceptosCapaB');
const {
  CONCEPTOS_CAPA_C,
  FORMULAS_CAPA_C,
  VIGENCIA_CAPA_C,
  MAPEO_CANONICO_CAPA_C
} = require('../../config/nominaConceptosCapaC');
const {
  CONCEPTOS_CAPA_D,
  FORMULAS_CAPA_D,
  VIGENCIA_CAPA_D
} = require('../../config/nominaConceptosCapaD');
const {
  CONCEPTOS_CAPA_E,
  FORMULAS_CAPA_E,
  VIGENCIA_CAPA_E
} = require('../../config/nominaConceptosCapaE');
const {
  CONCEPTOS_CAPA_F,
  FORMULAS_CAPA_F,
  VIGENCIA_CAPA_F
} = require('../../config/nominaConceptosCapaF');

const MAPEO_CANONICO_COMPLETO = { ...MAPEO_CANONICO_LEGADO, ...MAPEO_CANONICO_CAPA_C };
const {
  parseConceptosLegadoFile,
  mapLegacyRowToConcepto,
  resumirImportacion,
  legacyCodigo
} = require('../../libs/importacionConceptosLegado');
const { ordenarPorDependencias } = require('./dependencyResolver');
const { validateFormulaSyntax, normalizeConditionComparisons } = require('./formulaEvaluator');
const { validateFormulaPayload, validateConceptoPayload } = require('../../libs/nominaValidators');

async function ensureNominaConceptsForTenant(tenantId, empresaId) {
  const ConceptoNomina = await getConceptoNominaModel();
  const FormulaConcepto = await getFormulaConceptoModel();
  const vigenciaDesde = VIGENCIA_INICIAL;

  for (const c of CONCEPTOS_BASE) {
    await ConceptoNomina.updateOne(
      { tenantId, codigo: c.codigo },
      {
        $setOnInsert: {
          tenantId,
          empresaId,
          codigo: c.codigo,
          nombre: c.nombre,
          tipo: c.tipo,
          naturaleza: c.naturaleza,
          ordenCalculo: c.ordenCalculo,
          sat: c.sat || {},
          metadata: c.metadata || {},
          activo: true,
          aplicaTipoNomina: []
        }
      },
      { upsert: true }
    );
  }

  for (const f of FORMULAS_BASE) {
    const exists = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde
    }).lean();
    if (exists) continue;

    await FormulaConcepto.create({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde,
      vigenciaHasta: null,
      condicion: f.condicion || '',
      formula: f.formula,
      dependencias: f.dependencias || [],
      activo: true
    });
  }

  await syncFormulasFiscalesV2(tenantId);
  await ensureCapaBConceptosForTenant(tenantId, empresaId);
  await ensureCapaCConceptosForTenant(tenantId, empresaId);
  await ensureCapaDConceptosForTenant(tenantId, empresaId);
  await ensureCapaEConceptosForTenant(tenantId, empresaId);
  await ensureCapaFConceptosForTenant(tenantId, empresaId);
  await recalcularDependientes(tenantId);
}

/** Conceptos y fórmulas Capa B (catálogo legado priorizado → mathjs) */
async function ensureCapaBConceptosForTenant(tenantId, empresaId) {
  const ConceptoNomina = await getConceptoNominaModel();

  for (const c of CONCEPTOS_CAPA_B) {
    const fiscal = c.fiscal || null;
    await ConceptoNomina.updateOne(
      { tenantId, codigo: c.codigo },
      {
        $set: {
          nombre: c.nombre,
          tipo: c.tipo,
          naturaleza: c.naturaleza,
          ordenCalculo: c.ordenCalculo,
          sat: c.sat || {},
          ...(fiscal ? { fiscal } : {}),
          metadata: c.metadata || {},
          aplicaTipoNomina: c.aplicaTipoNomina || [],
          updatedAt: new Date()
        },
        $setOnInsert: {
          tenantId,
          empresaId,
          codigo: c.codigo,
          activo: true,
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  await syncFormulasCapaB(tenantId);
}

async function syncFormulasCapaB(tenantId) {
  const FormulaConcepto = await getFormulaConceptoModel();

  await FormulaConcepto.updateMany(
    {
      tenantId,
      vigenciaDesde: VIGENCIA_CAPA_B,
      vigenciaHasta: { $ne: null, $lt: VIGENCIA_CAPA_B }
    },
    { $set: { vigenciaHasta: null } }
  );

  for (const f of FORMULAS_CAPA_B) {
    const vigente = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaHasta: null,
      activo: true
    }).lean();

    if (vigente && vigente.formula === f.formula && vigente.condicion === (f.condicion || '')) {
      continue;
    }

    const mismaEra =
      vigente && new Date(vigente.vigenciaDesde).getTime() === VIGENCIA_CAPA_B.getTime();

    if (vigente && mismaEra) {
      await FormulaConcepto.updateOne(
        { _id: vigente._id },
        {
          $set: {
            formula: f.formula,
            condicion: f.condicion || '',
            dependencias: f.dependencias || [],
            vigenciaHasta: null,
            activo: true
          }
        }
      );
      continue;
    }

    if (vigente) {
      await FormulaConcepto.updateOne(
        { _id: vigente._id },
        { $set: { vigenciaHasta: new Date(VIGENCIA_CAPA_B.getTime() - 1) } }
      );
    }

    const yaCapaB = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde: VIGENCIA_CAPA_B
    }).lean();

    if (yaCapaB) {
      await FormulaConcepto.updateOne(
        { _id: yaCapaB._id },
        {
          $set: {
            formula: f.formula,
            condicion: f.condicion || '',
            dependencias: f.dependencias || [],
            vigenciaHasta: null,
            activo: true
          }
        }
      );
      continue;
    }

    await FormulaConcepto.create({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde: VIGENCIA_CAPA_B,
      vigenciaHasta: null,
      condicion: f.condicion || '',
      formula: f.formula,
      dependencias: f.dependencias || [],
      activo: true
    });
  }
}

/** Conceptos y fórmulas Capa C (fondo de ahorro) */
async function ensureCapaCConceptosForTenant(tenantId, empresaId) {
  const ConceptoNomina = await getConceptoNominaModel();

  for (const c of CONCEPTOS_CAPA_C) {
    const fiscal = c.fiscal || null;
    const deprecado = Boolean(c.metadata?.deprecado);
    await ConceptoNomina.updateOne(
      { tenantId, codigo: c.codigo },
      {
        $set: {
          nombre: c.nombre,
          tipo: c.tipo,
          naturaleza: c.naturaleza,
          ordenCalculo: c.ordenCalculo,
          sat: c.sat || {},
          ...(fiscal ? { fiscal } : {}),
          metadata: c.metadata || {},
          aplicaTipoNomina: c.aplicaTipoNomina || [],
          activo: !deprecado,
          updatedAt: new Date()
        },
        $setOnInsert: {
          tenantId,
          empresaId,
          codigo: c.codigo,
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  await syncFormulasCapaC(tenantId);
}

async function syncFormulasCapaC(tenantId) {
  const FormulaConcepto = await getFormulaConceptoModel();

  await FormulaConcepto.updateMany(
    {
      tenantId,
      vigenciaDesde: VIGENCIA_CAPA_C,
      vigenciaHasta: { $ne: null, $lt: VIGENCIA_CAPA_C }
    },
    { $set: { vigenciaHasta: null } }
  );

  for (const f of FORMULAS_CAPA_C) {
    const vigente = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaHasta: null,
      activo: true
    }).lean();

    if (vigente && vigente.formula === f.formula && vigente.condicion === (f.condicion || '')) {
      continue;
    }

    const mismaEra =
      vigente && new Date(vigente.vigenciaDesde).getTime() === VIGENCIA_CAPA_C.getTime();

    if (vigente && mismaEra) {
      await FormulaConcepto.updateOne(
        { _id: vigente._id },
        {
          $set: {
            formula: f.formula,
            condicion: f.condicion || '',
            dependencias: f.dependencias || [],
            vigenciaHasta: null,
            activo: true
          }
        }
      );
      continue;
    }

    if (vigente) {
      await FormulaConcepto.updateOne(
        { _id: vigente._id },
        { $set: { vigenciaHasta: new Date(VIGENCIA_CAPA_C.getTime() - 1) } }
      );
    }

    const yaCapaC = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde: VIGENCIA_CAPA_C
    }).lean();

    if (yaCapaC) {
      await FormulaConcepto.updateOne(
        { _id: yaCapaC._id },
        {
          $set: {
            formula: f.formula,
            condicion: f.condicion || '',
            dependencias: f.dependencias || [],
            vigenciaHasta: null,
            activo: true
          }
        }
      );
      continue;
    }

    await FormulaConcepto.create({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde: VIGENCIA_CAPA_C,
      vigenciaHasta: null,
      condicion: f.condicion || '',
      formula: f.formula,
      dependencias: f.dependencias || [],
      activo: true
    });
  }
}

/** Conceptos y fórmulas Capa D (INFONAVIT + FONACOT) */
async function ensureCapaDConceptosForTenant(tenantId, empresaId) {
  const ConceptoNomina = await getConceptoNominaModel();

  for (const c of CONCEPTOS_CAPA_D) {
    const fiscal = c.fiscal || null;
    await ConceptoNomina.updateOne(
      { tenantId, codigo: c.codigo },
      {
        $set: {
          nombre: c.nombre,
          tipo: c.tipo,
          naturaleza: c.naturaleza,
          ordenCalculo: c.ordenCalculo,
          sat: c.sat || {},
          ...(fiscal ? { fiscal } : {}),
          metadata: c.metadata || {},
          aplicaTipoNomina: c.aplicaTipoNomina || [],
          activo: true,
          updatedAt: new Date()
        },
        $setOnInsert: {
          tenantId,
          empresaId,
          codigo: c.codigo,
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  await syncFormulasCapaD(tenantId);
}

async function syncFormulasCapaD(tenantId) {
  const FormulaConcepto = await getFormulaConceptoModel();

  for (const f of FORMULAS_CAPA_D) {
    const vigente = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaHasta: null,
      activo: true
    }).lean();

    if (vigente && vigente.formula === f.formula && vigente.condicion === (f.condicion || '')) {
      continue;
    }

    const mismaEra =
      vigente && new Date(vigente.vigenciaDesde).getTime() === VIGENCIA_CAPA_D.getTime();

    if (vigente && mismaEra) {
      await FormulaConcepto.updateOne(
        { _id: vigente._id },
        {
          $set: {
            formula: f.formula,
            condicion: f.condicion || '',
            dependencias: f.dependencias || [],
            vigenciaHasta: null,
            activo: true
          }
        }
      );
      continue;
    }

    if (vigente) {
      await FormulaConcepto.updateOne(
        { _id: vigente._id },
        { $set: { vigenciaHasta: new Date(VIGENCIA_CAPA_D.getTime() - 1) } }
      );
    }

    const yaCapaD = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde: VIGENCIA_CAPA_D
    }).lean();

    if (yaCapaD) {
      await FormulaConcepto.updateOne(
        { _id: yaCapaD._id },
        {
          $set: {
            formula: f.formula,
            condicion: f.condicion || '',
            dependencias: f.dependencias || [],
            vigenciaHasta: null,
            activo: true
          }
        }
      );
      continue;
    }

    await FormulaConcepto.create({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde: VIGENCIA_CAPA_D,
      vigenciaHasta: null,
      condicion: f.condicion || '',
      formula: f.formula,
      dependencias: f.dependencias || [],
      activo: true
    });
  }
}

/** Conceptos y fórmulas Capa E (cuota sindical / voluntarias) */
async function ensureCapaEConceptosForTenant(tenantId, empresaId) {
  const ConceptoNomina = await getConceptoNominaModel();

  for (const c of CONCEPTOS_CAPA_E) {
    const fiscal = c.fiscal || null;
    await ConceptoNomina.updateOne(
      { tenantId, codigo: c.codigo },
      {
        $set: {
          nombre: c.nombre,
          tipo: c.tipo,
          naturaleza: c.naturaleza,
          ordenCalculo: c.ordenCalculo,
          sat: c.sat || {},
          ...(fiscal ? { fiscal } : {}),
          metadata: c.metadata || {},
          aplicaTipoNomina: c.aplicaTipoNomina || [],
          activo: true,
          updatedAt: new Date()
        },
        $setOnInsert: {
          tenantId,
          empresaId,
          codigo: c.codigo,
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  await syncFormulasCapaE(tenantId);
}

async function syncFormulasCapaE(tenantId) {
  const FormulaConcepto = await getFormulaConceptoModel();

  for (const f of FORMULAS_CAPA_E) {
    const vigente = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaHasta: null,
      activo: true
    }).lean();

    if (vigente && vigente.formula === f.formula && vigente.condicion === (f.condicion || '')) {
      continue;
    }

    const mismaEra =
      vigente && new Date(vigente.vigenciaDesde).getTime() === VIGENCIA_CAPA_E.getTime();

    if (vigente && mismaEra) {
      await FormulaConcepto.updateOne(
        { _id: vigente._id },
        {
          $set: {
            formula: f.formula,
            condicion: f.condicion || '',
            dependencias: f.dependencias || [],
            vigenciaHasta: null,
            activo: true
          }
        }
      );
      continue;
    }

    if (vigente) {
      await FormulaConcepto.updateOne(
        { _id: vigente._id },
        { $set: { vigenciaHasta: new Date(VIGENCIA_CAPA_E.getTime() - 1) } }
      );
    }

    const yaCapaE = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde: VIGENCIA_CAPA_E
    }).lean();

    if (yaCapaE) {
      await FormulaConcepto.updateOne(
        { _id: yaCapaE._id },
        {
          $set: {
            formula: f.formula,
            condicion: f.condicion || '',
            dependencias: f.dependencias || [],
            vigenciaHasta: null,
            activo: true
          }
        }
      );
      continue;
    }

    await FormulaConcepto.create({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde: VIGENCIA_CAPA_E,
      vigenciaHasta: null,
      condicion: f.condicion || '',
      formula: f.formula,
      dependencias: f.dependencias || [],
      activo: true
    });
  }
}

/** Conceptos y fórmulas Capa F (desglose IMSS CFDI: 001 SS + 003 RCV) */
async function ensureCapaFConceptosForTenant(tenantId, empresaId) {
  const ConceptoNomina = await getConceptoNominaModel();

  for (const c of CONCEPTOS_CAPA_F) {
    const fiscal = c.fiscal || null;
    await ConceptoNomina.updateOne(
      { tenantId, codigo: c.codigo },
      {
        $set: {
          nombre: c.nombre,
          tipo: c.tipo,
          naturaleza: c.naturaleza,
          ordenCalculo: c.ordenCalculo,
          sat: c.sat || {},
          ...(fiscal ? { fiscal } : {}),
          metadata: c.metadata || {},
          aplicaTipoNomina: c.aplicaTipoNomina || [],
          activo: true,
          updatedAt: new Date()
        },
        $setOnInsert: {
          tenantId,
          empresaId,
          codigo: c.codigo,
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  await syncFormulasCapaF(tenantId);
}

async function syncFormulasCapaF(tenantId) {
  const FormulaConcepto = await getFormulaConceptoModel();

  for (const f of FORMULAS_CAPA_F) {
    const vigente = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaHasta: null,
      activo: true
    }).lean();

    if (vigente && vigente.formula === f.formula && vigente.condicion === (f.condicion || '')) {
      continue;
    }

    const mismaEra =
      vigente && new Date(vigente.vigenciaDesde).getTime() === VIGENCIA_CAPA_F.getTime();

    if (vigente && mismaEra) {
      await FormulaConcepto.updateOne(
        { _id: vigente._id },
        {
          $set: {
            formula: f.formula,
            condicion: f.condicion || '',
            dependencias: f.dependencias || [],
            vigenciaHasta: null,
            activo: true
          }
        }
      );
      continue;
    }

    if (vigente) {
      await FormulaConcepto.updateOne(
        { _id: vigente._id },
        { $set: { vigenciaHasta: new Date(VIGENCIA_CAPA_F.getTime() - 1) } }
      );
    }

    const yaCapaF = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde: VIGENCIA_CAPA_F
    }).lean();

    if (yaCapaF) {
      await FormulaConcepto.updateOne(
        { _id: yaCapaF._id },
        {
          $set: {
            formula: f.formula,
            condicion: f.condicion || '',
            dependencias: f.dependencias || [],
            vigenciaHasta: null,
            activo: true
          }
        }
      );
      continue;
    }

    await FormulaConcepto.create({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde: VIGENCIA_CAPA_F,
      vigenciaHasta: null,
      condicion: f.condicion || '',
      formula: f.formula,
      dependencias: f.dependencias || [],
      activo: true
    });
  }
}

/**
 * Capa A: importa metadatos del TSV legado (sin fórmulas SQL).
 * Los conceptos se guardan como L#### con metadata.legado completa.
 */
async function importarConceptosLegadoCapaA(tenantId, empresaId, filePath, options = {}) {
  const { dryRun = false, soloActivos = true, claEmpresa = null, mapeos = null } = options;
  const rows = parseConceptosLegadoFile(filePath);
  const ConceptoNomina = await getConceptoNominaModel();

  const conceptos = [];
  for (const row of rows) {
    const doc = mapLegacyRowToConcepto(row, tenantId, empresaId, { soloActivos, claEmpresa, mapeos });
    if (!doc) continue;

    const canonico = MAPEO_CANONICO_COMPLETO[doc.metadata.legado.claPerded];
    if (canonico) {
      doc.metadata.legado.codigoCanonico = canonico;
    }
    conceptos.push(doc);
  }

  if (dryRun) {
    return { dryRun: true, resumen: resumirImportacion(conceptos), conceptos };
  }

  let insertados = 0;
  let actualizados = 0;

  for (const doc of conceptos) {
    const res = await ConceptoNomina.updateOne(
      { tenantId, codigo: doc.codigo },
      {
        $set: {
          nombre: doc.nombre,
          tipo: doc.tipo,
          naturaleza: doc.naturaleza,
          claveSAT: doc.claveSAT,
          gravado: doc.gravado,
          aplicaTipoNomina: doc.aplicaTipoNomina,
          ordenCalculo: doc.ordenCalculo,
          sat: doc.sat,
          metadata: doc.metadata,
          activo: doc.activo,
          empresaId: doc.empresaId
        },
        $setOnInsert: {
          tenantId: doc.tenantId,
          codigo: doc.codigo,
          dependientes: []
        }
      },
      { upsert: true }
    );
    if (res.upsertedCount) insertados++;
    else if (res.modifiedCount) actualizados++;
  }

  await vincularCanonicoEnLegado(tenantId);

  return {
    dryRun: false,
    resumen: resumirImportacion(conceptos),
    insertados,
    actualizados,
    totalFilas: rows.length
  };
}

/** Escribe codigoCanonico en conceptos L#### según MAPEO_CANONICO_LEGADO */
async function vincularCanonicoEnLegado(tenantId) {
  const ConceptoNomina = await getConceptoNominaModel();
  for (const [claPerded, codigoCanonico] of Object.entries(MAPEO_CANONICO_COMPLETO)) {
    await ConceptoNomina.updateOne(
      { tenantId, codigo: legacyCodigo(claPerded) },
      { $set: { 'metadata.legado.codigoCanonico': codigoCanonico } }
    );
  }
}

/** Actualiza fórmulas ISR/IMSS/HE a versión con isrPeriodo e imssObrero */
async function syncFormulasFiscalesV2(tenantId) {
  const FormulaConcepto = await getFormulaConceptoModel();

  for (const f of FORMULAS_FISCALES_V2) {
    const vigente = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaHasta: null,
      activo: true
    }).lean();

    if (vigente && vigente.formula === f.formula && vigente.condicion === (f.condicion || '')) {
      continue;
    }

    if (vigente) {
      await FormulaConcepto.updateOne(
        { _id: vigente._id },
        { $set: { vigenciaHasta: new Date(VIGENCIA_FISCAL_V2.getTime() - 1) } }
      );
    }

    const yaV2 = await FormulaConcepto.findOne({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde: VIGENCIA_FISCAL_V2
    }).lean();

    if (yaV2) continue;

    await FormulaConcepto.create({
      tenantId,
      conceptoCodigo: f.conceptoCodigo,
      tipoPeriodo: f.tipoPeriodo,
      tipoNomina: f.tipoNomina,
      vigenciaDesde: VIGENCIA_FISCAL_V2,
      vigenciaHasta: null,
      condicion: f.condicion || '',
      formula: f.formula,
      dependencias: f.dependencias || [],
      activo: true
    });
  }
}

async function recalcularDependientes(tenantId) {
  const FormulaConcepto = await getFormulaConceptoModel();
  const ConceptoNomina = await getConceptoNominaModel();
  const formulas = await FormulaConcepto.find({ tenantId, activo: true }).lean();

  const dependientesMap = new Map();
  for (const f of formulas) {
    for (const dep of f.dependencias || []) {
      if (!dependientesMap.has(dep)) dependientesMap.set(dep, new Set());
      dependientesMap.get(dep).add(f.conceptoCodigo);
    }
  }

  const conceptos = await ConceptoNomina.find({ tenantId }).lean();
  for (const c of conceptos) {
    const deps = dependientesMap.has(c.codigo) ? [...dependientesMap.get(c.codigo)] : [];
    await ConceptoNomina.updateOne({ _id: c._id }, { $set: { dependientes: deps } });
  }
}

async function listConceptos(tenantId) {
  const ConceptoNomina = await getConceptoNominaModel();
  return ConceptoNomina.find({ tenantId }).sort({ ordenCalculo: 1, codigo: 1 }).lean();
}

function pickFormulaPreferida(candidatas) {
  if (!candidatas.length) return null;
  const ahora = Date.now();
  const vigentes = candidatas.filter((f) => {
    if (f.vigenciaHasta == null) return true;
    return new Date(f.vigenciaHasta).getTime() >= ahora;
  });
  const pool = vigentes.length ? vigentes : candidatas;
  pool.sort((a, b) => {
    const aEmp = a.empresaId != null ? 1 : 0;
    const bEmp = b.empresaId != null ? 1 : 0;
    if (bEmp !== aEmp) return bEmp - aEmp;
    if ((b.version || 0) !== (a.version || 0)) return (b.version || 0) - (a.version || 0);
    return new Date(b.vigenciaDesde) - new Date(a.vigenciaDesde);
  });
  return pool[0];
}

async function getConceptoConFormulas(tenantId, codigo) {
  const ConceptoNomina = await getConceptoNominaModel();
  const FormulaConcepto = await getFormulaConceptoModel();
  const concepto = await ConceptoNomina.findOne({ tenantId, codigo: String(codigo).toUpperCase() }).lean();
  if (!concepto) return null;

  const formulas = await FormulaConcepto.find({ tenantId, conceptoCodigo: concepto.codigo, activo: true })
    .sort({ tipoPeriodo: 1, tipoNomina: 1, version: -1, vigenciaDesde: -1 })
    .lean();

  return { concepto, formulas, pickFormulaPreferida };
}

async function validarDependenciasGrupo(tenantId, tipoPeriodo, tipoNomina, conceptoCodigo, dependencias) {
  const FormulaConcepto = await getFormulaConceptoModel();
  const formulasDelGrupo = await FormulaConcepto.find({
    tenantId,
    tipoPeriodo,
    tipoNomina,
    activo: true
  }).lean();

  const formulasSimuladas = [
    ...formulasDelGrupo.filter((f) => f.conceptoCodigo !== conceptoCodigo),
    { conceptoCodigo, dependencias: dependencias || [] }
  ];

  ordenarPorDependencias(formulasSimuladas);
  return { valido: true };
}

async function guardarFormula(tenantId, payload) {
  const validated = validateFormulaPayload({
    ...payload,
    conceptoCodigo: String(payload.conceptoCodigo).toUpperCase(),
    dependencias: (payload.dependencias || []).map((d) => String(d).toUpperCase())
  });

  const {
    conceptoCodigo,
    tipoPeriodo,
    tipoNomina,
    condicion,
    formula,
    dependencias,
    redondeo
  } = validated;

  const fase = Math.min(4, Math.max(1, Number(payload.fase) || 1));
  const tipoAplicacion = String(payload.tipoAplicacion || 'FIJO').toUpperCase() === 'EVENTUAL' ? 'EVENTUAL' : 'FIJO';
  const empresaId = payload.empresaId || null;
  const condicionNorm = normalizeConditionComparisons(condicion || '');

  validateFormulaSyntax(formula);
  if (condicionNorm) validateFormulaSyntax(condicionNorm);

  await validarDependenciasGrupo(
    tenantId,
    tipoPeriodo,
    tipoNomina,
    conceptoCodigo,
    dependencias
  );

  const FormulaConcepto = await getFormulaConceptoModel();
  const vigenciaDesde = new Date();
  vigenciaDesde.setHours(0, 0, 0, 0);

  const closeFilter = {
    tenantId,
    conceptoCodigo,
    tipoPeriodo,
    tipoNomina,
    vigenciaHasta: null,
    activo: true
  };
  if (empresaId) closeFilter.empresaId = empresaId;
  else closeFilter.$or = [{ empresaId: null }, { empresaId: { $exists: false } }];

  await FormulaConcepto.updateMany(closeFilter, {
    $set: { vigenciaHasta: new Date(vigenciaDesde.getTime() - 1) }
  });

  const last = await FormulaConcepto.findOne({
    tenantId,
    conceptoCodigo,
    tipoPeriodo,
    tipoNomina,
    ...(empresaId ? { empresaId } : { $or: [{ empresaId: null }, { empresaId: { $exists: false } }] })
  })
    .sort({ version: -1 })
    .lean();

  const doc = await FormulaConcepto.create({
    tenantId,
    empresaId,
    conceptoCodigo: String(conceptoCodigo).toUpperCase(),
    tipoPeriodo,
    tipoNomina,
    fase,
    tipoAplicacion,
    vigenciaDesde,
    vigenciaHasta: null,
    condicion: condicionNorm,
    formula,
    dependencias: dependencias || [],
    redondeo: redondeo ?? 2,
    version: (last?.version || 0) + 1,
    activo: true
  });

  await recalcularDependientes(tenantId);
  return doc;
}

const APLICA_EN = new Set(['nomina', 'prenomina', 'ambos']);
const FORMULAS_PRENOMINA = new Set([
  'salario_periodo',
  'horas_extra',
  'retardos',
  'faltas',
  'salida_anticipada',
  'manual'
]);
const DESGLOSE_MODOS = new Set([
  'todo_gravado',
  'todo_exento',
  'tope_uma',
  'tope_monto',
  'formula',
  'regla_ley'
]);

const IMSS_DESGLOSE_MODOS_SET = new Set([
  'todo_integra',
  'todo_excluye',
  'tope_uma',
  'tope_monto',
  'tope_pct_sbc',
  'regla_ley',
  'formula'
]);

const NATURALEZA_SDI_SET = new Set(['fijo', 'variable', 'excluido']);

function parseBoolFlag(v, fallback = false) {
  if (v === true || v === false) return v;
  if (v == null || v === '') return fallback;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'sí' || s === 'si';
}

function parseStringList(value) {
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildSatFiscalPatch(data, tipoFallback = 'percepcion', naturalezaFallback = 'gravado') {
  const tipo = String(data.tipo || tipoFallback).toLowerCase();
  const naturaleza = String(data.naturaleza || naturalezaFallback).toLowerCase();
  const satClave = String(data.satClave || data.claveSAT || data['sat.clave'] || '').trim();
  const satDesc = String(data.satDescripcion || data['sat.descripcion'] || '').trim();

  const fiscalNaturaleza = String(data.fiscalNaturaleza || data['fiscal.naturaleza'] || naturaleza).toLowerCase();
  const desgloseModo = String(data.desgloseModo || data['fiscal.desglose.modo'] || '').toLowerCase();
  const modo = DESGLOSE_MODOS.has(desgloseModo) ? desgloseModo : null;

  const { defaultFiscalFromNaturaleza, defaultImssConfig, emptyImssDesglose } = require('../../models/fiscalConceptoShared');
  const fiscalBase = defaultFiscalFromNaturaleza(fiscalNaturaleza || naturaleza);

  if (data.integraISR !== undefined || data['fiscal.integraISR'] !== undefined) {
    fiscalBase.integraISR = parseBoolFlag(data.integraISR ?? data['fiscal.integraISR'], fiscalBase.integraISR);
  }
  if (data.integraIMSS !== undefined || data['fiscal.integraIMSS'] !== undefined) {
    fiscalBase.integraIMSS = parseBoolFlag(data.integraIMSS ?? data['fiscal.integraIMSS'], fiscalBase.integraIMSS);
  }
  if (data.integraINFONAVIT !== undefined || data['fiscal.integraINFONAVIT'] !== undefined) {
    fiscalBase.integraINFONAVIT = parseBoolFlag(
      data.integraINFONAVIT ?? data['fiscal.integraINFONAVIT'],
      fiscalBase.integraINFONAVIT
    );
  }

  if (modo) fiscalBase.desglose.modo = modo;
  const topeUma = data.topeExentoUMA ?? data['fiscal.desglose.topeExentoUMA'];
  const topeMonto = data.topeExentoMonto ?? data['fiscal.desglose.topeExentoMonto'];
  if (topeUma !== undefined && topeUma !== '') {
    fiscalBase.desglose.topeExentoUMA = Number(topeUma) || 0;
  }
  if (topeMonto !== undefined && topeMonto !== '') {
    fiscalBase.desglose.topeExentoMonto = Number(topeMonto) || 0;
  }
  const formulaExento = data.formulaExento ?? data['fiscal.desglose.formulaExento'];
  const formulaGravado = data.formulaGravado ?? data['fiscal.desglose.formulaGravado'];
  const codigoRegla = data.codigoRegla ?? data['fiscal.desglose.codigoRegla'];
  if (formulaExento !== undefined) fiscalBase.desglose.formulaExento = String(formulaExento || '').trim();
  if (formulaGravado !== undefined) fiscalBase.desglose.formulaGravado = String(formulaGravado || '').trim();
  if (codigoRegla !== undefined) {
    fiscalBase.desglose.codigoRegla = String(codigoRegla || '').trim().toLowerCase();
  }

  // --- IMSS / SDI ---
  const natSdiRaw = String(
    data.naturalezaSdi || data['fiscal.imss.naturalezaSdi'] || ''
  ).toLowerCase();
  const imssModoRaw = String(
    data.imssDesgloseModo || data['fiscal.imss.desglose.modo'] || ''
  ).toLowerCase();
  const imssBase = defaultImssConfig({
    integraIMSS: fiscalBase.integraIMSS !== false,
    naturalezaSdi: NATURALEZA_SDI_SET.has(natSdiRaw) ? natSdiRaw : undefined
  });
  if (NATURALEZA_SDI_SET.has(natSdiRaw)) imssBase.naturalezaSdi = natSdiRaw;
  if (IMSS_DESGLOSE_MODOS_SET.has(imssModoRaw)) imssBase.desglose.modo = imssModoRaw;

  const imssTopeUma = data.imssTopeNoIntegraUMA ?? data['fiscal.imss.desglose.topeNoIntegraUMA'];
  const imssTopeMonto = data.imssTopeNoIntegraMonto ?? data['fiscal.imss.desglose.topeNoIntegraMonto'];
  const imssTopePct = data.imssTopeNoIntegraPctSbc ?? data['fiscal.imss.desglose.topeNoIntegraPctSbc'];
  if (imssTopeUma !== undefined && imssTopeUma !== '') {
    imssBase.desglose.topeNoIntegraUMA = Number(imssTopeUma) || 0;
  }
  if (imssTopeMonto !== undefined && imssTopeMonto !== '') {
    imssBase.desglose.topeNoIntegraMonto = Number(imssTopeMonto) || 0;
  }
  if (imssTopePct !== undefined && imssTopePct !== '') {
    imssBase.desglose.topeNoIntegraPctSbc = Number(imssTopePct) || 0;
  }
  const imssFormulaIntegra = data.imssFormulaIntegra ?? data['fiscal.imss.desglose.formulaIntegra'];
  const imssFormulaNoIntegra = data.imssFormulaNoIntegra ?? data['fiscal.imss.desglose.formulaNoIntegra'];
  const imssCodigoRegla = data.imssCodigoRegla ?? data['fiscal.imss.desglose.codigoRegla'];
  if (imssFormulaIntegra !== undefined) {
    imssBase.desglose.formulaIntegra = String(imssFormulaIntegra || '').trim();
  }
  if (imssFormulaNoIntegra !== undefined) {
    imssBase.desglose.formulaNoIntegra = String(imssFormulaNoIntegra || '').trim();
  }
  if (imssCodigoRegla !== undefined) {
    imssBase.desglose.codigoRegla = String(imssCodigoRegla || '').trim().toLowerCase();
  }

  if (imssBase.naturalezaSdi === 'excluido') {
    fiscalBase.integraIMSS = false;
    if (!IMSS_DESGLOSE_MODOS_SET.has(imssModoRaw)) imssBase.desglose.modo = 'todo_excluye';
  }
  fiscalBase.imss = {
    naturalezaSdi: imssBase.naturalezaSdi,
    desglose: emptyImssDesglose(imssBase.desglose)
  };

  return {
    claveSAT: satClave,
    sat: {
      tipo: satClave ? tipo : String(data.satTipo || tipo || ''),
      clave: satClave,
      descripcion: satDesc
    },
    fiscal: fiscalBase,
    gravado: fiscalBase.naturaleza !== 'exento' && fiscalBase.naturaleza !== 'informativo',
    metadata: {
      esVariableSdi: fiscalBase.imss?.naturalezaSdi === 'variable',
      naturalezaSdi: fiscalBase.imss?.naturalezaSdi || 'variable'
    }
  };
}

async function crearConcepto(tenantId, empresaId, data) {
  const validated = validateConceptoPayload({
    ...data,
    codigo: String(data.codigo).trim().toUpperCase()
  });

  const ConceptoNomina = await getConceptoNominaModel();
  const exists = await ConceptoNomina.findOne({ tenantId, codigo: validated.codigo }).lean();
  if (exists) throw new Error('Ya existe un concepto con ese código');

  const aplicaEn = APLICA_EN.has(String(data.aplicaEn || '').toLowerCase())
    ? String(data.aplicaEn).toLowerCase()
    : 'nomina';
  const formulaPrenominaRaw = String(data.formulaPrenomina || '').trim().toLowerCase();
  const formulaPrenomina = FORMULAS_PRENOMINA.has(formulaPrenominaRaw) ? formulaPrenominaRaw : undefined;
  const fase = Math.min(4, Math.max(1, Number(data.fase) || 1));
  const satFiscal = buildSatFiscalPatch(
    { ...data, tipo: validated.tipo, naturaleza: validated.naturaleza, claveSAT: validated.claveSAT },
    validated.tipo,
    validated.naturaleza
  );
  const { metadata: metaPatch, ...satRest } = satFiscal;

  return ConceptoNomina.create({
    tenantId,
    empresaId,
    codigo: validated.codigo,
    codigoExterno: String(data.codigoExterno || '').trim(),
    nombre: validated.nombre,
    tipo: validated.tipo,
    naturaleza: validated.naturaleza,
    categoria: String(data.categoria || 'ordinario').trim() || 'ordinario',
    ordenCalculo: validated.ordenCalculo,
    ordenImpresion:
      data.ordenImpresion != null && data.ordenImpresion !== ''
        ? Math.min(9999, Math.max(1, Math.round(Number(data.ordenImpresion)) || validated.ordenCalculo))
        : validated.ordenCalculo,
    fase,
    aplicaEn,
    clavePrenomina: String(data.clavePrenomina || '').trim().toUpperCase(),
    ...(formulaPrenomina ? { formulaPrenomina } : {}),
    tiposIncidencia: parseStringList(data.tiposIncidencia).map((s) => s.toUpperCase()),
    insumosContexto: parseStringList(data.insumosContexto),
    ...satRest,
    metadata: metaPatch || {},
    cuentaContable: String(data.cuentaContable || '').trim(),
    activo: true,
    aplicaTipoNomina: parseStringList(data.aplicaTipoNomina),
    aplicaTiposEmpleado: parseStringList(data.aplicaTiposEmpleado),
    aplicaTiposPeriodo: parseStringList(data.aplicaTiposPeriodo)
  });
}

/**
 * Actualiza propiedades del concepto (SAT, fiscal, ámbito, incidencias, etc.).
 * Sincroniza catálogo global y config empresa cuando existen.
 */
async function actualizarConcepto(tenantId, codigo, data, { empresaId = null, syncCatalog = true } = {}) {
  const ConceptoNomina = await getConceptoNominaModel();
  const codigoUp = String(codigo).trim().toUpperCase();
  const concepto = await ConceptoNomina.findOne({ tenantId, codigo: codigoUp });
  if (!concepto) throw new Error('Concepto no encontrado');

  const patch = {};
  if (data.nombre != null && String(data.nombre).trim()) patch.nombre = String(data.nombre).trim();
  if (data.tipo != null && ['percepcion', 'deduccion', 'otro_pago'].includes(String(data.tipo))) {
    patch.tipo = String(data.tipo);
  }
  if (data.naturaleza != null) {
    const n = String(data.naturaleza).toLowerCase();
    if (['fiscal', 'gravado', 'exento', 'mixto', 'informativo'].includes(n)) patch.naturaleza = n;
  }
  if (data.categoria !== undefined) {
    const cat = String(data.categoria || 'ordinario').trim();
    patch.categoria = cat || 'ordinario';
  }
  if (data.ordenCalculo != null && data.ordenCalculo !== '') {
    const o = Number(data.ordenCalculo);
    if (Number.isFinite(o)) patch.ordenCalculo = Math.min(9999, Math.max(1, Math.round(o)));
  }
  if (data.ordenImpresion != null && data.ordenImpresion !== '') {
    const oi = Number(data.ordenImpresion);
    if (Number.isFinite(oi)) patch.ordenImpresion = Math.min(9999, Math.max(1, Math.round(oi)));
  }
  if (data.fase != null && data.fase !== '') {
    const f = Number(data.fase);
    if (Number.isFinite(f)) patch.fase = Math.min(4, Math.max(1, Math.round(f)));
  }
  if (data.aplicaEn != null && APLICA_EN.has(String(data.aplicaEn).toLowerCase())) {
    patch.aplicaEn = String(data.aplicaEn).toLowerCase();
  }
  if (data.codigoExterno !== undefined) patch.codigoExterno = String(data.codigoExterno || '').trim();
  if (data.cuentaContable !== undefined) patch.cuentaContable = String(data.cuentaContable || '').trim();
  if (data.clavePrenomina !== undefined) {
    patch.clavePrenomina = String(data.clavePrenomina || '').trim().toUpperCase();
  }
  let unsetPrenomina = false;
  if (data.formulaPrenomina !== undefined) {
    const fp = String(data.formulaPrenomina || '').trim().toLowerCase();
    if (!fp) unsetPrenomina = true;
    else if (FORMULAS_PRENOMINA.has(fp)) patch.formulaPrenomina = fp;
  }
  if (data.tiposIncidencia !== undefined) {
    patch.tiposIncidencia = parseStringList(data.tiposIncidencia).map((s) => s.toUpperCase());
  }
  if (data.insumosContexto !== undefined) {
    patch.insumosContexto = parseStringList(data.insumosContexto);
  }
  if (data.aplicaTiposEmpleado !== undefined) {
    patch.aplicaTiposEmpleado = parseStringList(data.aplicaTiposEmpleado);
  }
  if (data.aplicaTiposPeriodo !== undefined) {
    patch.aplicaTiposPeriodo = parseStringList(data.aplicaTiposPeriodo);
  }
  if (data.aplicaTipoNomina !== undefined) {
    patch.aplicaTipoNomina = parseStringList(data.aplicaTipoNomina);
  }

  const tipoEff = patch.tipo || concepto.tipo;
  const natEff = patch.naturaleza || concepto.naturaleza;
  const satFiscal = buildSatFiscalPatch({ ...data, tipo: tipoEff, naturaleza: natEff }, tipoEff, natEff);
  const { metadata: metaPatch, ...satRest } = satFiscal;
  Object.assign(patch, satRest);
  if (metaPatch) {
    patch.metadata = { ...(concepto.metadata || {}), ...metaPatch };
  }

  const updateOps = { $set: patch };
  if (unsetPrenomina) updateOps.$unset = { formulaPrenomina: 1 };
  await ConceptoNomina.updateOne({ _id: concepto._id }, updateOps);

  if (syncCatalog) {
    try {
      const getConceptCatalogModel = require('../../models/conceptCatalog');
      const Catalog = await getConceptCatalogModel();
      const catalogPatch = {
        nombre: patch.nombre || concepto.nombre,
        tipo: tipoEff,
        naturaleza: natEff,
        fase: patch.fase != null ? patch.fase : concepto.fase,
        aplicaEn: patch.aplicaEn || concepto.aplicaEn,
        claveSAT: patch.claveSAT,
        sat: patch.sat,
        fiscal: patch.fiscal,
        ordenDefault: patch.ordenCalculo != null ? patch.ordenCalculo : concepto.ordenCalculo
      };
      if (patch.clavePrenomina !== undefined) catalogPatch.clavePrenomina = patch.clavePrenomina;
      if (patch.formulaPrenomina !== undefined) catalogPatch.formulaPrenomina = patch.formulaPrenomina;
      if (patch.tiposIncidencia !== undefined) catalogPatch.tiposIncidencia = patch.tiposIncidencia;
      if (patch.insumosContexto !== undefined) catalogPatch.insumosContexto = patch.insumosContexto;
      const catalogOps = { $set: catalogPatch };
      if (unsetPrenomina) catalogOps.$unset = { formulaPrenomina: 1 };
      await Catalog.updateOne({ codigo: codigoUp }, catalogOps);
    } catch (_) {
      /* catálogo global opcional */
    }
  }

  if (empresaId && data.tipoAplicacion != null) {
    const app = String(data.tipoAplicacion).toUpperCase();
    if (app === 'FIJO' || app === 'EVENTUAL') {
      try {
        const getCompanyConceptConfigModel = require('../../models/companyConceptConfig');
        const Config = await getCompanyConceptConfigModel();
        await Config.updateOne(
          { tenantId, empresaId, conceptoCodigo: codigoUp },
          { $set: { tipoAplicacion: app }, $setOnInsert: { activo: true, deshabilitado: false } },
          { upsert: true }
        );
      } catch (_) {
        /* config empresa opcional */
      }
    }
  }

  return ConceptoNomina.findOne({ tenantId, codigo: codigoUp }).lean();
}

async function toggleConcepto(tenantId, codigo) {
  const ConceptoNomina = await getConceptoNominaModel();
  const concepto = await ConceptoNomina.findOne({ tenantId, codigo }).lean();
  if (!concepto) throw new Error('Concepto no encontrado');

  if (concepto.activo && concepto.dependientes?.length) {
    throw new Error(
      `No se puede desactivar: otros conceptos dependen de él (${concepto.dependientes.join(', ')})`
    );
  }

  await ConceptoNomina.updateOne({ _id: concepto._id }, { $set: { activo: !concepto.activo } });
}

module.exports = {
  ensureNominaConceptsForTenant,
  ensureCapaBConceptosForTenant,
  ensureCapaCConceptosForTenant,
  ensureCapaDConceptosForTenant,
  ensureCapaEConceptosForTenant,
  ensureCapaFConceptosForTenant,
  syncFormulasFiscalesV2,
  syncFormulasCapaB,
  syncFormulasCapaC,
  syncFormulasCapaD,
  syncFormulasCapaE,
  syncFormulasCapaF,
  importarConceptosLegadoCapaA,
  vincularCanonicoEnLegado,
  recalcularDependientes,
  listConceptos,
  getConceptoConFormulas,
  pickFormulaPreferida,
  validarDependenciasGrupo,
  guardarFormula,
  crearConcepto,
  actualizarConcepto,
  toggleConcepto
};

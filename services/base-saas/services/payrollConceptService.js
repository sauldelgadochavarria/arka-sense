'use strict';

const getConceptoNominaModel = require('../models/conceptoNomina');
const {
  ensureConceptCatalog,
  ensureCompanyConceptConfigs,
  aplicaEnPrenomina,
  aplicaEnNomina
} = require('./nomina/conceptResolutionService');

/**
 * Vista compatible con el motor de pre-nómina (antes payroll_concepts).
 */
function toPrenominaShape(doc) {
  if (!doc) return null;
  return {
    _id: doc._id,
    tenantId: doc.tenantId,
    empresaId: doc.empresaId,
    clave: (doc.clavePrenomina || doc.codigo || '').toUpperCase(),
    nombre: doc.nombre,
    tipo: doc.tipo === 'deduccion' ? 'deduccion' : 'percepcion',
    formula: doc.formulaPrenomina || 'manual',
    valorDefault: 0,
    codigoExterno: doc.codigoExterno || '',
    codigoCatalogo: doc.codigo,
    tiposIncidencia: doc.tiposIncidencia || [],
    insumosContexto: doc.insumosContexto || [],
    aplicaEn: doc.aplicaEn || 'prenomina',
    cuentaContable: doc.cuentaContable || '',
    activo: doc.activo !== false,
    orden: doc.ordenCalculo ?? 100,
    // documento fuente (misma colección)
    conceptoId: doc._id,
    codigo: doc.codigo
  };
}

async function listConceptosUnificados(tenantId, { ambito } = {}) {
  const Concepto = await getConceptoNominaModel();
  const filter = { tenantId };
  if (ambito === 'nomina') {
    filter.$or = [{ aplicaEn: 'nomina' }, { aplicaEn: 'ambos' }, { aplicaEn: { $exists: false } }];
  } else if (ambito === 'prenomina') {
    filter.aplicaEn = { $in: ['prenomina', 'ambos'] };
  }
  return Concepto.find(filter).sort({ ordenCalculo: 1, codigo: 1 }).lean();
}

async function listPrenominaConceptos(tenantId, { soloActivos = true } = {}) {
  const Concepto = await getConceptoNominaModel();
  const filter = {
    tenantId,
    aplicaEn: { $in: ['prenomina', 'ambos'] }
  };
  if (soloActivos) filter.activo = true;
  const docs = await Concepto.find(filter).sort({ ordenCalculo: 1, codigo: 1 }).lean();
  return docs.map(toPrenominaShape);
}

async function ensurePayrollConceptsForTenant(tenantId, empresaId) {
  await ensureConceptCatalog();
  await ensureCompanyConceptConfigs(tenantId, empresaId);
  let list = await listPrenominaConceptos(tenantId, { soloActivos: false });
  if (list.length) return list.filter((c) => c.activo);

  // Compat: si aún no hay sync, forzar otra pasada
  await ensureCompanyConceptConfigs(tenantId, empresaId);
  list = await listPrenominaConceptos(tenantId, { soloActivos: true });
  return list;
}

module.exports = {
  toPrenominaShape,
  listConceptosUnificados,
  listPrenominaConceptos,
  ensurePayrollConceptsForTenant,
  aplicaEnPrenomina,
  aplicaEnNomina
};

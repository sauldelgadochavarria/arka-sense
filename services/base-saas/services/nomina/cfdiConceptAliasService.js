'use strict';

const getSubsidiaryConceptConfigModel = require('../../models/subsidiaryConceptConfig');
const getConceptoNominaModel = require('../../models/conceptoNomina');
const getFormulaConceptoModel = require('../../models/formulaConcepto');
const { inferCodigoMotorFromSat } = require('./satConceptoInferService');
const { CODIGOS_MOTOR_CONOCIDOS } = require('../../config/satConceptoMotorMap');

const FORMULA_SUELDO_DIAS_PAGADOS = 'sueldoDiario * diasPagados';
const FORMULA_SUELDO_DIAS_LABORADOS = 'sueldoDiario * diasLaborados';
const FORMULA_SEPTIMO_DIA = 'sueldoDiario * diasDescansoPagados';

/**
 * Núcleo fiscal/operativo que siempre puede calcularse aunque no venga en el CFDI.
 * Prestaciones (PRIMA_DOMINICAL, PREMIO_*, DESPENSA, fondo…) solo si están ligadas al CFDI de la sub.
 */
const CORE_CALCULO_MOTOR = new Set([
  'SUELDO',
  'SEPTIMO_DIA',
  'HORAS_EXTRA_DOBLES',
  'HORAS_EXTRA_TRIPLES',
  'HORAS_EXTRA_SENCILLAS',
  'ISR',
  'ISR_SAT',
  'ISR_PROYECTADO',
  'ISR_AJUSTADO',
  'ISR_DIFERENCIA',
  'SUBSIDIO_EMPLEO',
  'IMSS_OBRERO',
  'IMSS_RCV',
  'IMSS_PATRONAL',
  'INFONAVIT',
  'FONACOT',
  'PERCEPCIONES_GRAVADAS',
  'DEDUCCIONES_TOTALES',
  'NETO_PAGAR',
  'SALARIO_PERIODO'
]);

/**
 * Si la subsidiaria tiene conceptos CFDI, el cálculo se limita a:
 * - núcleo fiscal/operativo (CORE_CALCULO_MOTOR)
 * - motores ligados a claves CFDI de esa sub
 * - claves CFDI propias de la sub (aunque no mapeen a motor conocido)
 * Evita que caigan en el recibo semillas como PRIMA_DOMINICAL que no están en el listado de la sub.
 */
function filterFormulasByCfdiScope(formulas, { aliasByMotor, motorByCfdi, cfdiCodigos, hasCfdiScope }) {
  if (!hasCfdiScope) return formulas || [];
  const allowed = new Set(CORE_CALCULO_MOTOR);
  for (const motor of aliasByMotor.keys()) allowed.add(String(motor).toUpperCase());
  for (const [cfdi, motor] of motorByCfdi.entries()) {
    if (cfdi) allowed.add(String(cfdi).toUpperCase());
    if (motor) allowed.add(String(motor).toUpperCase());
  }
  // Incluir claves CFDI de la sub aunque no tengan alias a motor conocido
  // (p.ej. 135 Bono Recreativo con fórmula propia y SAT 038 compartido con 132).
  for (const code of cfdiCodigos || []) {
    if (code) allowed.add(String(code).toUpperCase());
  }
  return (formulas || []).filter((f) => allowed.has(String(f.conceptoCodigo || '').toUpperCase()));
}

/**
 * Si un concepto CFDI ya tiene fórmula propia, úsala y no dupliques la del motor alias.
 * Busca fórmulas en todas las claves CFDI de la sub (no solo las del mapa motor→alias).
 */
async function mergeCfdiOwnFormulas({
  tenantId,
  periodo,
  formulas,
  aliasByMotor,
  motorByCfdi,
  cfdiCodigos = null,
  fecha = null
}) {
  const list = (formulas || []).map((f) => ({ ...f }));
  const alias = new Map(aliasByMotor || []);
  const byCfdi = motorByCfdi instanceof Map ? motorByCfdi : new Map();
  const fromScope = Array.isArray(cfdiCodigos)
    ? cfdiCodigos.map((c) => String(c || '').toUpperCase()).filter(Boolean)
    : [];
  const cfdiCodes = [...new Set([...fromScope, ...byCfdi.keys()].filter(Boolean))];
  if (!tenantId || !periodo || !cfdiCodes.length) {
    return { formulas: list, aliasByMotor: alias };
  }

  const Formula = await getFormulaConceptoModel();
  const fechaRef = fecha || periodo.fechaInicio || new Date();
  const rows = await Formula.find({
    tenantId,
    conceptoCodigo: { $in: cfdiCodes },
    tipoPeriodo: periodo.tipoPeriodo,
    tipoNomina: periodo.tipoNomina || 'ordinaria',
    activo: true,
    vigenciaDesde: { $lte: fechaRef },
    $and: [{ $or: [{ vigenciaHasta: null }, { vigenciaHasta: { $gte: fechaRef } }] }]
  })
    .sort({ version: -1, vigenciaDesde: -1 })
    .lean();

  const ownByCodigo = new Map();
  for (const f of rows) {
    const code = String(f.conceptoCodigo || '').toUpperCase();
    if (!ownByCodigo.has(code)) ownByCodigo.set(code, f);
  }
  if (!ownByCodigo.size) {
    return { formulas: list, aliasByMotor: alias };
  }

  // Solo quitar el motor alias cuando la clave CFDI que lo "gana" es la del mapa 1:1.
  // Otras claves CFDI con fórmula propia (p.ej. 135) se agregan sin desalojar el motor de 132.
  const motorsToDrop = new Set();
  for (const [cfdi, motor] of byCfdi.entries()) {
    if (!ownByCodigo.has(String(cfdi).toUpperCase())) continue;
    if (motor) {
      motorsToDrop.add(String(motor).toUpperCase());
      alias.delete(String(motor).toUpperCase());
    }
  }

  const filtered = list.filter(
    (f) => !motorsToDrop.has(String(f.conceptoCodigo || '').toUpperCase())
  );
  const present = new Set(filtered.map((f) => String(f.conceptoCodigo || '').toUpperCase()));
  for (const f of ownByCodigo.values()) {
    const code = String(f.conceptoCodigo).toUpperCase();
    if (present.has(code)) continue;
    filtered.push({
      conceptoCodigo: code,
      formula: f.formula,
      condicion: f.condicion || '',
      dependencias: f.dependencias || [],
      redondeo: f.redondeo ?? 2,
      fase: f.fase || 1,
      tipoAplicacion: f.tipoAplicacion || 'FIJO',
      version: f.version || 1,
      orden: f.orden || 100
    });
  }

  return { formulas: filtered, aliasByMotor: alias };
}

function formulaUsaDiasLaboradosOTrabajados(formula) {
  const f = String(formula || '');
  return /diasTrabajados|diasLaborados/i.test(f) && !/diasPagados/i.test(f);
}

function healSueldoFormula(formula, { hasSeptimoSeparado }) {
  const f = String(formula || '').trim();
  if (hasSeptimoSeparado) {
    if (/diasPagados/i.test(f) && !/diasLaborados|diasTrabajados/i.test(f)) {
      return f.replace(/PERIODO\.diasPagados|diasPagados/gi, (m) =>
        /PERIODO/i.test(m) ? 'PERIODO.diasLaborados' : 'diasLaborados'
      );
    }
    if (formulaUsaDiasLaboradosOTrabajados(f) || !f) return f || FORMULA_SUELDO_DIAS_LABORADOS;
    return f;
  }
  if (formulaUsaDiasLaboradosOTrabajados(f)) {
    return f
      .replace(/PERIODO\.diasTrabajados/gi, 'PERIODO.diasPagados')
      .replace(/PERIODO\.diasLaborados/gi, 'PERIODO.diasPagados')
      .replace(/\bdiasTrabajados\b/gi, 'diasPagados')
      .replace(/\bdiasLaborados\b/gi, 'diasPagados');
  }
  return f || FORMULA_SUELDO_DIAS_PAGADOS;
}

/**
 * Resuelve mapa motor → clave CFDI de la subsidiaria (import SAT).
 * @returns {Promise<{ aliasByMotor: Map<string,string>, motorByCfdi: Map<string,string>, cfdiCodigos: string[] }>}
 */
async function buildCfdiMotorAliasMap(tenantId, empresaId, subsidiariaId) {
  const aliasByMotor = new Map();
  const motorByCfdi = new Map();
  const cfdiCodigos = [];
  if (!tenantId || !empresaId || !subsidiariaId) {
    return { aliasByMotor, motorByCfdi, cfdiCodigos };
  }

  const SubCfg = await getSubsidiaryConceptConfigModel();
  const Concepto = await getConceptoNominaModel();
  const rows = await SubCfg.find({
    tenantId,
    empresaId,
    subsidiariaId,
    activo: true,
    deshabilitado: { $ne: true },
    origen: { $in: ['cfdi', 'cfdi_sat', 'historico'] }
  }).lean();
  if (!rows.length) return { aliasByMotor, motorByCfdi, cfdiCodigos };

  const conceptos = await Concepto.find({
    tenantId,
    empresaId,
    codigo: { $in: rows.map((r) => r.conceptoCodigo) }
  }).lean();
  const byCodigo = new Map(conceptos.map((c) => [String(c.codigo).toUpperCase(), c]));

  for (const row of rows) {
    const cfdi = String(row.conceptoCodigo || '')
      .trim()
      .toUpperCase();
    if (!cfdi) continue;
    cfdiCodigos.push(cfdi);
    const concepto = byCodigo.get(cfdi) || {};
    let motor = String(row.codigoMotor || concepto.metadata?.codigoMotor || '')
      .trim()
      .toUpperCase();

    if (!motor || motor === cfdi) {
      try {
        const inferred = await inferCodigoMotorFromSat(
          {
            conceptoCodigo: cfdi,
            claveInterna: row.claveInternaCfdi || cfdi,
            claveSat: row.claveSat || concepto.claveSAT || concepto.sat?.clave,
            tipo: row.tipo || concepto.tipo,
            nombre: row.aliasNombre || concepto.nombre
          },
          { tenantId, empresaId, subsidiariaId }
        );
        motor = String(inferred.codigo || '')
          .trim()
          .toUpperCase();
      } catch (_) {
        motor = '';
      }
    }

    if (!motor || !CODIGOS_MOTOR_CONOCIDOS.has(motor)) continue;
    // Si el propio código ya es motor, no hay alias de presentación
    if (cfdi === motor) continue;
    // Un motor → una clave CFDI (primera gana)
    if (aliasByMotor.has(motor)) continue;
    aliasByMotor.set(motor, cfdi);
    motorByCfdi.set(cfdi, motor);
  }

  return { aliasByMotor, motorByCfdi, cfdiCodigos: [...new Set(cfdiCodigos)] };
}

/**
 * Ajusta el set de fórmulas del período:
 * - Si hay CFDI de séptimo día → formula SEPTIMO_DIA + SUELDO por días laborados
 * - Si no → SUELDO usa diasPagados (6+1 embebido)
 */
function applySeptimoAndSueldoFormulas(formulas, { hasSeptimoCfdiAlias }) {
  const list = (formulas || []).map((f) => ({ ...f }));
  const byCodigo = new Map(list.map((f) => [f.conceptoCodigo, f]));

  if (hasSeptimoCfdiAlias && !byCodigo.has('SEPTIMO_DIA')) {
    const sueldo = byCodigo.get('SUELDO');
    list.push({
      conceptoCodigo: 'SEPTIMO_DIA',
      formula: FORMULA_SEPTIMO_DIA,
      condicion: '',
      dependencias: [],
      redondeo: 2,
      fase: sueldo?.fase || 1,
      tipoAplicacion: 'FIJO',
      version: 1,
      orden: (sueldo?.orden || 100) + 1
    });
    byCodigo.set('SEPTIMO_DIA', list[list.length - 1]);
  }

  const hasSeptimoSeparado = hasSeptimoCfdiAlias || byCodigo.has('SEPTIMO_DIA');
  for (const f of list) {
    if (f.conceptoCodigo === 'SUELDO') {
      f.formula = healSueldoFormula(f.formula, { hasSeptimoSeparado });
    }
  }
  return list;
}

async function prepareFormulasConAliasesCfdi(tenantId, empresaId, subsidiariaId, formulas) {
  const { aliasByMotor, motorByCfdi, cfdiCodigos } = await buildCfdiMotorAliasMap(
    tenantId,
    empresaId,
    subsidiariaId
  );
  const hasCfdiConfigs =
    Boolean(subsidiariaId) &&
    (aliasByMotor.size > 0 || motorByCfdi.size > 0 || (cfdiCodigos && cfdiCodigos.length > 0));

  const hasSeptimoCfdiAlias = aliasByMotor.has('SEPTIMO_DIA');
  let adjusted = applySeptimoAndSueldoFormulas(formulas, { hasSeptimoCfdiAlias });
  adjusted = filterFormulasByCfdiScope(adjusted, {
    aliasByMotor,
    motorByCfdi,
    cfdiCodigos,
    hasCfdiScope: hasCfdiConfigs
  });
  return {
    formulas: adjusted,
    aliasByMotor,
    motorByCfdi,
    cfdiCodigos: cfdiCodigos || [],
    hasSeptimoCfdiAlias,
    hasCfdiScope: hasCfdiConfigs
  };
}

module.exports = {
  buildCfdiMotorAliasMap,
  applySeptimoAndSueldoFormulas,
  prepareFormulasConAliasesCfdi,
  filterFormulasByCfdiScope,
  mergeCfdiOwnFormulas,
  healSueldoFormula,
  CORE_CALCULO_MOTOR,
  FORMULA_SUELDO_DIAS_PAGADOS,
  FORMULA_SUELDO_DIAS_LABORADOS,
  FORMULA_SEPTIMO_DIA
};

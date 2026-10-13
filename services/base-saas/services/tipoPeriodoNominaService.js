'use strict';

const getTipoPeriodoNominaModel = require('../models/tipoPeriodoNomina');
const { TIPOS_PERIODO_DEFAULT } = require('../config/tipoPeriodoDefaults');
const { parseCalendarioFromBody, normalizeWeekday } = require('../libs/calendarioPeriodo');

function calendarioFromData(data = {}) {
  const diasPeriodo = Number(data.diasPeriodo) || 0;
  let modoCalendario = String(data.modoCalendario || '').trim();
  if (modoCalendario !== 'por_dias' && modoCalendario !== 'calendario_fijo') {
    modoCalendario = diasPeriodo > 0 ? 'por_dias' : 'calendario_fijo';
  }
  let diaPago = null;
  if (data.diaPago !== '' && data.diaPago != null) {
    const n = Number(data.diaPago);
    if (Number.isFinite(n) && n >= 0 && n <= 6) diaPago = Math.trunc(n);
  }
  const offsetRaw = Number(data.offsetPagoDias);
  return {
    diaInicioSemana: normalizeWeekday(data.diaInicioSemana, 1),
    modoCalendario,
    diaPago,
    offsetPagoDias: Number.isFinite(offsetRaw) ? Math.trunc(offsetRaw) : 0
  };
}

function normalizeSubId(subsidiariaId) {
  if (subsidiariaId === undefined) return undefined;
  if (subsidiariaId === null || subsidiariaId === '') return null;
  return subsidiariaId;
}

/** Filtro: solo empresa-wide (sin sub). */
function empresaWideOr() {
  return [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }];
}

/**
 * Asegura defaults del catálogo compartido (prenómina + nómina) en el ámbito
 * empresa o subsidiaria activa.
 */
async function ensureTiposPeriodoForTenant(tenantId, empresaId, subsidiariaId = null) {
  if (!tenantId || !empresaId) return;
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  const subId = normalizeSubId(subsidiariaId);
  const scopeSub = subId === undefined ? null : subId;

  for (const t of TIPOS_PERIODO_DEFAULT) {
    const filter = {
      tenantId,
      empresaId,
      codigoLegado: t.codigoLegado,
      ...(scopeSub ? { subsidiariaId: scopeSub } : { $or: empresaWideOr() })
    };
    // Match exacto con subsidiariaId null para upsert limpio
    const upsertFilter = {
      tenantId,
      empresaId,
      codigoLegado: t.codigoLegado,
      subsidiariaId: scopeSub
    };
    await TipoPeriodoNomina.updateOne(
      upsertFilter,
      {
        $setOnInsert: {
          tenantId,
          empresaId,
          subsidiariaId: scopeSub,
          codigoLegado: t.codigoLegado,
          nombre: t.nombre,
          tipoMotor: t.tipoMotor,
          diasPeriodo: t.diasPeriodo,
          esSeptimo: t.esSeptimo,
          diasLaborables: t.diasLaborables,
          leyenda: t.leyenda || '',
          periodicidadPagoSat: t.periodicidadPagoSat,
          diaInicioSemana: 1,
          modoCalendario: t.diasPeriodo > 0 ? 'por_dias' : 'calendario_fijo',
          diaPago: null,
          offsetPagoDias: 0,
          aplicaAsistenciaPrenomina: t.aplicaAsistenciaPrenomina,
          compartirConNomina: t.compartirConNomina,
          activo: true
        }
      },
      { upsert: true }
    );
    // Evita warning lint unused
    void filter;
  }
}

/**
 * Lista tipos del catálogo compartido.
 * - Con subsidiariaId: tipos de esa sub; si aún no hay, fallback a empresa-wide.
 * - Sin subsidiariaId (undefined): todos de la empresa (compat).
 * - subsidiariaId null: solo empresa-wide.
 */
async function listTiposPeriodo(tenantId, soloActivos = false, empresaId = null, subsidiariaId = undefined) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  const base = { tenantId };
  if (empresaId) base.empresaId = empresaId;
  if (soloActivos) base.activo = true;

  const subId = normalizeSubId(subsidiariaId);

  if (subId) {
    const subRows = await TipoPeriodoNomina.find({ ...base, subsidiariaId: subId })
      .sort({ codigoLegado: 1 })
      .lean();
    if (subRows.length) return subRows;
    return TipoPeriodoNomina.find({ ...base, $or: empresaWideOr() })
      .sort({ codigoLegado: 1 })
      .lean();
  }

  if (subId === null) {
    return TipoPeriodoNomina.find({ ...base, $or: empresaWideOr() })
      .sort({ codigoLegado: 1 })
      .lean();
  }

  return TipoPeriodoNomina.find(base).sort({ codigoLegado: 1 }).lean();
}

async function getTipoPeriodoById(tenantId, id) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  return TipoPeriodoNomina.findOne({ tenantId, _id: id }).lean();
}

async function crearTipoPeriodo(tenantId, empresaId, data) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  const codigoLegado = Number(data.codigoLegado);
  if (!Number.isFinite(codigoLegado)) throw new Error('Código interno requerido');

  const subId = normalizeSubId(data.subsidiariaId);
  const scopeSub = subId === undefined ? null : subId;

  const existsQ = {
    tenantId,
    empresaId,
    codigoLegado,
    ...(scopeSub ? { subsidiariaId: scopeSub } : { $or: empresaWideOr() })
  };
  const exists = await TipoPeriodoNomina.findOne(existsQ).lean();
  if (exists) {
    throw new Error(
      `El código interno ${codigoLegado} ya está asignado a «${exists.nombre}». Elige otro.`
    );
  }

  const cal = calendarioFromData(data);

  return TipoPeriodoNomina.create({
    tenantId,
    empresaId,
    subsidiariaId: scopeSub,
    codigoLegado,
    codigoExterno: String(data.codigoExterno || '').trim(),
    nombre: String(data.nombre || '').trim(),
    tipoMotor: data.tipoMotor || 'quincenal',
    diasPeriodo: Number(data.diasPeriodo) || 0,
    esSeptimo: Boolean(data.esSeptimo),
    diasLaborables: Number(data.diasLaborables) || 0,
    leyenda: String(data.leyenda || '').trim(),
    periodicidadPagoSat: data.periodicidadPagoSat != null ? Number(data.periodicidadPagoSat) : null,
    diaInicioSemana: cal.diaInicioSemana,
    modoCalendario: cal.modoCalendario,
    diaPago: cal.diaPago,
    offsetPagoDias: cal.offsetPagoDias,
    aplicaAsistenciaPrenomina: data.aplicaAsistenciaPrenomina !== false,
    compartirConNomina: data.compartirConNomina !== false,
    activo: true
  });
}

async function toggleTipoPeriodo(tenantId, id) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  const doc = await TipoPeriodoNomina.findOne({ tenantId, _id: id });
  if (!doc) throw new Error('Tipo de período no encontrado');
  doc.activo = !doc.activo;
  await doc.save();
}

async function actualizarTipoPeriodo(tenantId, id, data) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  const doc = await TipoPeriodoNomina.findOne({ tenantId, _id: id });
  if (!doc) throw new Error('Tipo de período no encontrado');

  const codigoLegado = Number(data.codigoLegado);
  if (!Number.isFinite(codigoLegado)) throw new Error('Código interno requerido');

  const subId = doc.subsidiariaId || null;
  const duplicado = await TipoPeriodoNomina.findOne({
    tenantId,
    empresaId: doc.empresaId,
    codigoLegado,
    _id: { $ne: doc._id },
    ...(subId ? { subsidiariaId: subId } : { $or: empresaWideOr() })
  }).lean();
  if (duplicado) {
    throw new Error(
      `El código interno ${codigoLegado} ya está asignado a «${duplicado.nombre}». Elige otro.`
    );
  }

  const cal = calendarioFromData(data);

  doc.codigoLegado = codigoLegado;
  doc.codigoExterno = String(data.codigoExterno || '').trim();
  doc.nombre = String(data.nombre || '').trim();
  doc.tipoMotor = data.tipoMotor || doc.tipoMotor;
  doc.diasPeriodo = Number(data.diasPeriodo) || 0;
  doc.esSeptimo = Boolean(data.esSeptimo);
  doc.diasLaborables = Number(data.diasLaborables) || 0;
  doc.leyenda = String(data.leyenda || '').trim();
  doc.periodicidadPagoSat =
    data.periodicidadPagoSat != null && data.periodicidadPagoSat !== ''
      ? Number(data.periodicidadPagoSat)
      : null;
  doc.diaInicioSemana = cal.diaInicioSemana;
  doc.modoCalendario = cal.modoCalendario;
  doc.diaPago = cal.diaPago;
  doc.offsetPagoDias = cal.offsetPagoDias;
  doc.aplicaAsistenciaPrenomina = data.aplicaAsistenciaPrenomina !== false;
  doc.compartirConNomina = data.compartirConNomina !== false;
  await doc.save();
  return doc.toObject();
}

async function nextCodigoLegado(tenantId, empresaId = null, subsidiariaId = undefined) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  const q = { tenantId, codigoLegado: { $ne: null } };
  if (empresaId) q.empresaId = empresaId;
  const subId = normalizeSubId(subsidiariaId);
  if (subId) q.subsidiariaId = subId;
  else if (subId === null) q.$or = empresaWideOr();
  const top = await TipoPeriodoNomina.find(q)
    .sort({ codigoLegado: -1 })
    .limit(1)
    .select('codigoLegado')
    .lean();
  const max = top[0]?.codigoLegado;
  return Number.isFinite(Number(max)) ? Number(max) + 1 : 1;
}

async function listCodigosLegadoOcupados(
  tenantId,
  excludeId = null,
  empresaId = null,
  subsidiariaId = undefined
) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  const q = { tenantId, codigoLegado: { $ne: null } };
  if (empresaId) q.empresaId = empresaId;
  const subId = normalizeSubId(subsidiariaId);
  if (subId) q.subsidiariaId = subId;
  else if (subId === null) q.$or = empresaWideOr();
  if (excludeId) q._id = { $ne: excludeId };
  const rows = await TipoPeriodoNomina.find(q).select('codigoLegado').lean();
  return rows.map((r) => Number(r.codigoLegado)).filter((n) => Number.isFinite(n));
}

/**
 * Prefiere candidatos de la subsidiaria; si no hay, empresa-wide.
 */
function preferTiposDeSubsidiaria(candidatos, subsidiariaId) {
  if (!subsidiariaId || !candidatos?.length) return candidatos || [];
  const sub = candidatos.filter((c) => c.subsidiariaId && String(c.subsidiariaId) === String(subsidiariaId));
  if (sub.length) return sub;
  return candidatos.filter((c) => !c.subsidiariaId);
}

module.exports = {
  ensureTiposPeriodoForTenant,
  listTiposPeriodo,
  getTipoPeriodoById,
  crearTipoPeriodo,
  actualizarTipoPeriodo,
  toggleTipoPeriodo,
  nextCodigoLegado,
  listCodigosLegadoOcupados,
  preferTiposDeSubsidiaria,
  parseCalendarioFromBody
};

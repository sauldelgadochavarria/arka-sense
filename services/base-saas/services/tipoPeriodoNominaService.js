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

async function ensureTiposPeriodoForTenant(tenantId, empresaId) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  for (const t of TIPOS_PERIODO_DEFAULT) {
    await TipoPeriodoNomina.updateOne(
      { tenantId, codigoLegado: t.codigoLegado },
      {
        $setOnInsert: {
          tenantId,
          empresaId,
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
  }
}

async function listTiposPeriodo(tenantId, soloActivos = false) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  const filter = { tenantId };
  if (soloActivos) filter.activo = true;
  return TipoPeriodoNomina.find(filter).sort({ codigoLegado: 1 }).lean();
}

async function getTipoPeriodoById(tenantId, id) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  return TipoPeriodoNomina.findOne({ tenantId, _id: id }).lean();
}

async function crearTipoPeriodo(tenantId, empresaId, data) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  const codigoLegado = Number(data.codigoLegado);
  if (!Number.isFinite(codigoLegado)) throw new Error('Código interno requerido');

  const exists = await TipoPeriodoNomina.findOne({ tenantId, codigoLegado }).lean();
  if (exists) {
    throw new Error(
      `El código interno ${codigoLegado} ya está asignado a «${exists.nombre}». Elige otro.`
    );
  }

  const cal = calendarioFromData(data);

  return TipoPeriodoNomina.create({
    tenantId,
    empresaId,
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

  const duplicado = await TipoPeriodoNomina.findOne({
    tenantId,
    codigoLegado,
    _id: { $ne: doc._id }
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

async function nextCodigoLegado(tenantId) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  const top = await TipoPeriodoNomina.find({ tenantId, codigoLegado: { $ne: null } })
    .sort({ codigoLegado: -1 })
    .limit(1)
    .select('codigoLegado')
    .lean();
  const max = top[0]?.codigoLegado;
  return Number.isFinite(Number(max)) ? Number(max) + 1 : 1;
}

async function listCodigosLegadoOcupados(tenantId, excludeId = null) {
  const TipoPeriodoNomina = await getTipoPeriodoNominaModel();
  const q = { tenantId, codigoLegado: { $ne: null } };
  if (excludeId) q._id = { $ne: excludeId };
  const rows = await TipoPeriodoNomina.find(q).select('codigoLegado').lean();
  return rows.map((r) => Number(r.codigoLegado)).filter((n) => Number.isFinite(n));
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
  parseCalendarioFromBody
};

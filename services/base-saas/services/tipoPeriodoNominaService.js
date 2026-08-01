'use strict';

const getTipoPeriodoNominaModel = require('../models/tipoPeriodoNomina');
const { TIPOS_PERIODO_DEFAULT } = require('../config/tipoPeriodoDefaults');

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
  if (!Number.isFinite(codigoLegado)) throw new Error('Código legado requerido');

  const exists = await TipoPeriodoNomina.findOne({ tenantId, codigoLegado }).lean();
  if (exists) throw new Error('Ya existe un tipo de período con ese código legado');

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
  if (!Number.isFinite(codigoLegado)) throw new Error('Código legado requerido');

  const duplicado = await TipoPeriodoNomina.findOne({
    tenantId,
    codigoLegado,
    _id: { $ne: doc._id }
  }).lean();
  if (duplicado) throw new Error('Ya existe otro tipo con ese código legado');

  doc.codigoLegado = codigoLegado;
  doc.codigoExterno = String(data.codigoExterno || '').trim();
  doc.nombre = String(data.nombre || '').trim();
  doc.tipoMotor = data.tipoMotor || doc.tipoMotor;
  doc.diasPeriodo = Number(data.diasPeriodo) || 0;
  doc.esSeptimo = Boolean(data.esSeptimo);
  doc.diasLaborables = Number(data.diasLaborables) || 0;
  doc.leyenda = String(data.leyenda || '').trim();
  doc.periodicidadPagoSat = data.periodicidadPagoSat != null && data.periodicidadPagoSat !== ''
    ? Number(data.periodicidadPagoSat)
    : null;
  doc.aplicaAsistenciaPrenomina = data.aplicaAsistenciaPrenomina !== false;
  doc.compartirConNomina = data.compartirConNomina !== false;
  await doc.save();
  return doc.toObject();
}

module.exports = {
  ensureTiposPeriodoForTenant,
  listTiposPeriodo,
  getTipoPeriodoById,
  crearTipoPeriodo,
  actualizarTipoPeriodo,
  toggleTipoPeriodo
};

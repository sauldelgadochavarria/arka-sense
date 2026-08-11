'use strict';

/**
 * Asigna el siguiente número de período por tenant + año + tipoPeriodo.
 * La secuencia reinicia cada año calendario (fechaInicio).
 */
async function asignarNumeroPeriodo(PeriodoNomina, { tenantId, tipoPeriodo, fechaInicio }) {
  const fecha = fechaInicio instanceof Date ? fechaInicio : new Date(fechaInicio);
  const anio = fecha.getFullYear();
  const last = await PeriodoNomina.findOne({
    tenantId,
    anio,
    tipoPeriodo: String(tipoPeriodo || '').toLowerCase()
  })
    .sort({ numeroPeriodo: -1 })
    .select('numeroPeriodo')
    .lean();

  const numeroPeriodo = (Number(last?.numeroPeriodo) || 0) + 1;
  return { anio, numeroPeriodo };
}

/**
 * Rellena anio/numeroPeriodo en períodos antiguos que no lo tengan.
 */
async function ensureNumerosPeriodoTenant(PeriodoNomina, tenantId) {
  const sinNumero = await PeriodoNomina.find({
    tenantId,
    $or: [{ numeroPeriodo: null }, { numeroPeriodo: { $exists: false } }, { numeroPeriodo: 0 }]
  })
    .sort({ tipoPeriodo: 1, fechaInicio: 1 })
    .lean();

  if (!sinNumero.length) return 0;

  let updated = 0;
  const counters = new Map(); // key anio|tipo -> next

  for (const p of sinNumero) {
    const anio = p.anio || new Date(p.fechaInicio).getFullYear();
    const tipo = String(p.tipoPeriodo || '').toLowerCase();
    const key = `${anio}|${tipo}`;

    if (!counters.has(key)) {
      const last = await PeriodoNomina.findOne({
        tenantId,
        anio,
        tipoPeriodo: tipo,
        numeroPeriodo: { $gt: 0 }
      })
        .sort({ numeroPeriodo: -1 })
        .select('numeroPeriodo')
        .lean();
      counters.set(key, (Number(last?.numeroPeriodo) || 0) + 1);
    }

    const numeroPeriodo = counters.get(key);
    counters.set(key, numeroPeriodo + 1);
    await PeriodoNomina.updateOne({ _id: p._id }, { $set: { anio, numeroPeriodo } });
    updated += 1;
  }
  return updated;
}

module.exports = {
  asignarNumeroPeriodo,
  ensureNumerosPeriodoTenant
};

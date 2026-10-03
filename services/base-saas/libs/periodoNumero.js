'use strict';

const { resolvePeriodRange } = require('./payrollPeriodDates');

/** YYYY-MM-DD en UTC — coincide con cómo se persisten fechaInicio/fechaFin (T00:00Z / T23:59Z). */
function ymdUtc(date) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function addUtcDays(date, n) {
  const d = startOfUtcDay(date);
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d;
}

/** Días inclusivos por calendario UTC (evita off-by-one México vs contenedor UTC). */
function diasPeriodoUtc(inicio, fin) {
  const a = ymdUtc(inicio);
  const b = ymdUtc(fin);
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.round(
    (Date.parse(`${b}T12:00:00.000Z`) - Date.parse(`${a}T12:00:00.000Z`)) / dayMs
  );
  return Math.max(1, diff + 1);
}

/**
 * Asigna el siguiente número de período por tenant + empresa + subsidiaria + año + tipoPeriodo + tipoNomina.
 */
async function asignarNumeroPeriodo(
  PeriodoNomina,
  { tenantId, empresaId, subsidiariaId, tipoPeriodo, tipoNomina, fechaInicio }
) {
  const fecha = fechaInicio instanceof Date ? fechaInicio : new Date(fechaInicio);
  const anio = fecha.getUTCFullYear();
  const scope = {
    tenantId,
    anio,
    tipoPeriodo: String(tipoPeriodo || '').toLowerCase(),
    tipoNomina: String(tipoNomina || 'ordinaria').toLowerCase()
  };
  if (empresaId) scope.empresaId = empresaId;
  if (subsidiariaId) scope.subsidiariaId = subsidiariaId;
  else scope.$or = [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }];

  const last = await PeriodoNomina.findOne(scope)
    .sort({ numeroPeriodo: -1 })
    .select('numeroPeriodo')
    .lean();

  let numeroPeriodo = (Number(last?.numeroPeriodo) || 0) + 1;
  for (let guard = 0; guard < 200; guard += 1) {
    const clashQ = { ...scope, numeroPeriodo };
    const clash = await PeriodoNomina.findOne(clashQ).select('_id').lean();
    if (!clash) return { anio, numeroPeriodo };
    numeroPeriodo += 1;
  }
  return { anio, numeroPeriodo };
}

function diasMotorDefault(tipoPeriodo) {
  switch (String(tipoPeriodo || '').toLowerCase()) {
    case 'semanal':
      return 7;
    case 'catorcenal':
      return 14;
    case 'decena':
      return 10;
    default:
      return 0;
  }
}

/**
 * Siguiente ventana tras el último período.
 * Para semanal/catorcenal/decena (y cuando hay histórico CFDI) continúa en días
 * consecutivos desde fechaFin+1 con la misma duración — no re-ancla a lunes calendario
 * (eso causaba solapes tipo 27/9–3/10 → 28/9–4/10).
 *
 * Usa calendario UTC porque los períodos se guardan como T00:00:00.000Z / T23:59:59.999Z
 * del día de negocio (mismo criterio que el listado en contenedor UTC).
 */
function rangoSiguienteTrasUltimo(tipoPeriodo, fechaFinUltimo, tipoPeriodoRef = null, opts = {}) {
  const tipo = String(tipoPeriodo || 'quincenal').toLowerCase();
  const finUltimo = startOfUtcDay(fechaFinUltimo);
  const inicio = addUtcDays(finUltimo, 1);

  let dias = Number(opts.diasPeriodo) || Number(tipoPeriodoRef?.diasPeriodo) || 0;
  if (!dias && opts.fechaInicioUltimo) {
    dias = diasPeriodoUtc(opts.fechaInicioUltimo, fechaFinUltimo);
  }
  if (!dias) dias = diasMotorDefault(tipo);

  const usarConsecutivo =
    opts.continuarConsecutivo === true ||
    tipo === 'semanal' ||
    tipo === 'catorcenal' ||
    tipo === 'decena';

  if (usarConsecutivo && dias > 0) {
    const fechaInicio = startOfUtcDay(inicio);
    const fechaFin = endOfUtcDay(addUtcDays(inicio, dias - 1));
    return {
      ref: fechaInicio,
      range: { fechaInicio, fechaFin },
      diasPeriodo: dias
    };
  }

  // Quincenal / mensual / etc.: anclaje de calendario con anti-solape
  let ref = inicio;
  let range = resolvePeriodRange(tipo, ref, tipoPeriodoRef);
  for (let i = 0; i < 24; i += 1) {
    if (startOfUtcDay(range.fechaInicio).getTime() > finUltimo.getTime()) break;
    ref = addUtcDays(range.fechaFin, 1);
    range = resolvePeriodRange(tipo, ref, tipoPeriodoRef);
  }
  return { ref, range, diasPeriodo: diasPeriodoUtc(range.fechaInicio, range.fechaFin) };
}

/**
 * Mapa key `tipoPeriodo|tipoNomina` → propuesta de siguiente ventana (# y fechas)
 * a partir del último período histórico por combinación.
 */
async function mapSugerenciasSiguientePeriodo(
  PeriodoNomina,
  {
    tenantId,
    empresaId,
    subsidiariaId = undefined,
    defaults = [
      ['quincenal', 'ordinaria'],
      ['semanal', 'ordinaria']
    ]
  } = {}
) {
  const match = { tenantId };
  if (empresaId) match.empresaId = empresaId;
  if (subsidiariaId) match.subsidiariaId = subsidiariaId;
  else if (subsidiariaId === null) {
    match.$or = [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }];
  }

  const groups = await PeriodoNomina.aggregate([
    { $match: match },
    { $sort: { fechaFin: -1, numeroPeriodo: -1 } },
    {
      $group: {
        _id: { tipoPeriodo: '$tipoPeriodo', tipoNomina: '$tipoNomina' },
        fechaInicio: { $first: '$fechaInicio' },
        fechaFin: { $first: '$fechaFin' },
        anio: { $first: '$anio' },
        numeroPeriodo: { $first: '$numeroPeriodo' },
        diasPeriodo: { $first: '$diasPeriodo' },
        estatus: { $first: '$estatus' }
      }
    }
  ]);

  const map = {};

  for (const g of groups) {
    const tipo = String(g._id.tipoPeriodo || '').toLowerCase();
    const nomina = String(g._id.tipoNomina || 'ordinaria').toLowerCase();
    if (!tipo) continue;
    const { ref, range, diasPeriodo } = rangoSiguienteTrasUltimo(tipo, g.fechaFin, null, {
      fechaInicioUltimo: g.fechaInicio,
      diasPeriodo: g.diasPeriodo
    });
    const { anio, numeroPeriodo } = await asignarNumeroPeriodo(PeriodoNomina, {
      tenantId,
      empresaId,
      subsidiariaId: subsidiariaId || null,
      tipoPeriodo: tipo,
      tipoNomina: nomina,
      fechaInicio: range.fechaInicio
    });
    map[`${tipo}|${nomina}`] = {
      tieneHistorico: true,
      ultimo: {
        fechaInicio: ymdUtc(g.fechaInicio),
        fechaFin: ymdUtc(g.fechaFin),
        anio: g.anio,
        numeroPeriodo: g.numeroPeriodo,
        estatus: g.estatus
      },
      fechaReferencia: ymdUtc(ref),
      fechaInicio: ymdUtc(range.fechaInicio),
      fechaFin: ymdUtc(range.fechaFin),
      diasPeriodo: diasPeriodo || diasPeriodoUtc(range.fechaInicio, range.fechaFin),
      anio,
      numeroPeriodo
    };
  }

  for (const [tipo, nomina] of defaults) {
    const key = `${tipo}|${nomina}`;
    if (map[key]) continue;
    const hoy = new Date();
    const range = resolvePeriodRange(tipo, hoy);
    const { anio, numeroPeriodo } = await asignarNumeroPeriodo(PeriodoNomina, {
      tenantId,
      empresaId,
      subsidiariaId: subsidiariaId || null,
      tipoPeriodo: tipo,
      tipoNomina: nomina,
      fechaInicio: range.fechaInicio
    });
    map[key] = {
      tieneHistorico: false,
      ultimo: null,
      fechaReferencia: ymdUtc(hoy),
      fechaInicio: ymdUtc(range.fechaInicio),
      fechaFin: ymdUtc(range.fechaFin),
      diasPeriodo: diasPeriodoUtc(range.fechaInicio, range.fechaFin),
      anio,
      numeroPeriodo
    };
  }

  return map;
}

/**
 * Elige la sugerencia por defecto: última ordinaria con histórico más reciente, o quincenal/ordinaria.
 */
function pickSugerenciaDefault(map) {
  let bestKey = 'quincenal|ordinaria';
  let best = map[bestKey] || null;
  for (const [key, s] of Object.entries(map || {})) {
    if (!s?.tieneHistorico || !s.ultimo?.fechaFin) continue;
    if (!key.endsWith('|ordinaria')) continue;
    if (!best?.tieneHistorico || !best.ultimo?.fechaFin || s.ultimo.fechaFin > best.ultimo.fechaFin) {
      best = s;
      bestKey = key;
    }
  }
  if (!best && map['semanal|ordinaria']) {
    bestKey = 'semanal|ordinaria';
    best = map[bestKey];
  }
  const pipe = String(bestKey).lastIndexOf('|');
  const left = pipe >= 0 ? String(bestKey).slice(0, pipe) : String(bestKey);
  const tipoNomina = pipe >= 0 ? String(bestKey).slice(pipe + 1) : 'ordinaria';
  const tipoPeriodoId = left.startsWith('id:') ? left.slice(3) : best?.tipoPeriodoId || '';
  const tipoPeriodo = left.startsWith('id:')
    ? best?.tipoPeriodo || 'quincenal'
    : left || 'quincenal';
  return {
    key: bestKey,
    tipoPeriodo,
    tipoPeriodoId: tipoPeriodoId || '',
    tipoNomina: tipoNomina || 'ordinaria',
    sugerencia: best || null
  };
}

/**
 * Rellena anio/numeroPeriodo en períodos antiguos que no lo tengan.
 */
async function ensureNumerosPeriodoTenant(PeriodoNomina, tenantId) {
  const sinNumero = await PeriodoNomina.find({
    tenantId,
    $or: [{ numeroPeriodo: null }, { numeroPeriodo: { $exists: false } }, { numeroPeriodo: 0 }]
  })
    .sort({ tipoPeriodo: 1, tipoNomina: 1, fechaInicio: 1 })
    .lean();

  if (!sinNumero.length) return 0;

  let updated = 0;
  const counters = new Map(); // key anio|tipo|nomina -> next

  for (const p of sinNumero) {
    const anio = p.anio || new Date(p.fechaInicio).getFullYear();
    const tipo = String(p.tipoPeriodo || '').toLowerCase();
    const nomina = String(p.tipoNomina || 'ordinaria').toLowerCase();
    const key = `${anio}|${tipo}|${nomina}`;

    if (!counters.has(key)) {
      const last = await PeriodoNomina.findOne({
        tenantId,
        empresaId: p.empresaId,
        anio,
        tipoPeriodo: tipo,
        tipoNomina: nomina,
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
  ensureNumerosPeriodoTenant,
  mapSugerenciasSiguientePeriodo,
  pickSugerenciaDefault,
  rangoSiguienteTrasUltimo,
  diasPeriodoUtc,
  ymdUtc,
  startOfUtcDay,
  endOfUtcDay
};

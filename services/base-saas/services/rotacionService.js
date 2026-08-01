'use strict';

const { parseOptionalObjectId, trimString, parseDate } = require('../libs/formHelpers');
const { startOfDay } = require('../libs/timeHelpers');
const { normalizeTipoPlantilla } = require('../config/plantillasHorario');

function parseMatrixSlots(body, numSemanas) {
  const slots = [];
  const semanas = Math.max(1, Math.min(12, Number(numSemanas) || 1));

  for (let s = 0; s < semanas; s += 1) {
    for (let d = 0; d < 7; d += 1) {
      const key = `slot_${s}_${d}`;
      const raw = body[key];
      const esDescanso = raw === 'descanso' || raw === '__descanso__';
      const turnoId = esDescanso ? null : parseOptionalObjectId(raw);
      if (esDescanso || turnoId) {
        slots.push({ semanaIndex: s, diaSemana: d, turnoId, esDescanso });
      }
    }
  }

  return slots;
}

function parseCicloSlots(body) {
  const slots = [];
  const rawList = body.cicloSlots;
  const indices = new Set();

  if (Array.isArray(rawList)) {
    rawList.forEach((raw, i) => {
      indices.add(i);
      const esDescanso = raw === 'descanso' || raw === '__descanso__';
      const turnoId = esDescanso ? null : parseOptionalObjectId(raw);
      if (esDescanso || turnoId) slots.push({ turnoId, esDescanso });
    });
  } else {
    Object.keys(body)
      .filter((k) => k.startsWith('ciclo_'))
      .forEach((key) => {
        const idx = Number(key.replace('ciclo_', ''));
        if (!Number.isNaN(idx)) indices.add(idx);
      });

    const sorted = [...indices].sort((a, b) => a - b);
    for (const i of sorted) {
      const raw = body[`ciclo_${i}`];
      if (raw === '' || raw === undefined) continue;
      const esDescanso = raw === 'descanso' || raw === '__descanso__';
      const turnoId = esDescanso ? null : parseOptionalObjectId(raw);
      if (esDescanso || turnoId) slots.push({ turnoId, esDescanso });
    }
  }

  return slots;
}

function slotMapFromPlantilla(plantilla) {
  const map = new Map();
  for (const slot of plantilla?.slots || []) {
    map.set(`${slot.semanaIndex}_${slot.diaSemana}`, slot);
  }
  return map;
}

function daysBetween(anchor, target) {
  const a = startOfDay(anchor);
  const t = startOfDay(target);
  return Math.round((t - a) / 86400000);
}

function computeCyclePosition(fechaAncla, fecha, numSemanas) {
  const anchor = startOfDay(fechaAncla);
  const diffDays = daysBetween(anchor, fecha);
  const cycleLen = numSemanas * 7;
  const pos = ((diffDays % cycleLen) + cycleLen) % cycleLen;
  const semanaIndex = Math.floor(pos / 7);
  const diaSemana = (anchor.getDay() + pos) % 7;
  return { semanaIndex, diaSemana, diffDays };
}

function resolveMatrizSlot(plantilla, fechaAncla, fecha) {
  if (!plantilla?.slots?.length) return null;
  const { semanaIndex, diaSemana } = computeCyclePosition(
    fechaAncla,
    fecha,
    plantilla.numSemanas || 1
  );
  return (
    plantilla.slots.find((s) => s.semanaIndex === semanaIndex && s.diaSemana === diaSemana) || null
  );
}

function resolveSecuenciaSlot(plantilla, fechaAncla, fecha) {
  const ciclo = plantilla?.cicloSlots || [];
  if (!ciclo.length) return null;
  const diffDays = daysBetween(fechaAncla, fecha);
  const len = ciclo.length;
  const idx = ((diffDays % len) + len) % len;
  const step = ciclo[idx];
  return {
    turnoId: step.esDescanso ? null : step.turnoId,
    esDescanso: !!step.esDescanso,
    cicloIndex: idx
  };
}

function resolveFijoSlot(plantilla) {
  if (!plantilla?.turnoFijoId) return null;
  return { turnoId: plantilla.turnoFijoId, esDescanso: false };
}

function getPlantillaTipo(plantilla) {
  return normalizeTipoPlantilla(plantilla?.tipo);
}

function resolveSlotFromPlantilla(plantilla, fechaAncla, fecha) {
  if (!plantilla) return null;
  const tipo = getPlantillaTipo(plantilla);

  if (tipo === 'fijo') {
    return resolveFijoSlot(plantilla);
  }
  if (tipo === 'secuencia') {
    return resolveSecuenciaSlot(plantilla, fechaAncla, fecha);
  }
  return resolveMatrizSlot(plantilla, fechaAncla, fecha);
}

function describeSlot(slot, turnoMap) {
  if (!slot) return '—';
  if (slot.esDescanso || !slot.turnoId) return 'Descanso';
  return turnoMap.get(String(slot.turnoId)) || 'Turno';
}

function describePlantillaResumen(plantilla, turnoMap) {
  const tipo = getPlantillaTipo(plantilla);
  if (tipo === 'fijo') {
    return plantilla.turnoFijoId ? turnoMap.get(String(plantilla.turnoFijoId)) || 'Turno fijo' : 'Sin turno';
  }
  if (tipo === 'secuencia') {
    const parts = (plantilla.cicloSlots || []).map((s) => describeSlot(s, turnoMap));
    return parts.length ? parts.join(' → ') : 'Secuencia vacía';
  }
  const n = (plantilla.slots || []).length;
  return `${plantilla.numSemanas || 1} sem · ${n} celdas`;
}

function buildPreviewPlantilla(plantilla, fechaAncla, fechaInicio, dias, turnoMap) {
  const anchor = startOfDay(fechaAncla);
  const inicio = startOfDay(fechaInicio);
  const rows = [];
  for (let i = 0; i < dias; i += 1) {
    const fecha = new Date(inicio.getTime() + i * 86400000);
    const slot = resolveSlotFromPlantilla(plantilla, anchor, fecha);
    rows.push({
      fecha,
      label: describeSlot(slot, turnoMap),
      esDescanso: !!(slot?.esDescanso || (slot && !slot.turnoId && slot.esDescanso !== false && getPlantillaTipo(plantilla) !== 'fijo'))
    });
  }
  return rows;
}

function buildMatrizSemanas(fechaInicio, numSemanas) {
  const inicio = startOfDay(fechaInicio);
  const semanas = [];
  for (let w = 0; w < numSemanas; w += 1) {
    const dias = [];
    for (let d = 0; d < 7; d += 1) {
      const fecha = new Date(inicio.getTime() + (w * 7 + d) * 86400000);
      dias.push({ fecha, diaSemana: fecha.getDay() });
    }
    semanas.push(dias);
  }
  return semanas;
}

function validatePlantillaSlots(slots, numSemanas) {
  const seen = new Set();
  for (const slot of slots) {
    const key = `${slot.semanaIndex}_${slot.diaSemana}`;
    if (seen.has(key)) {
      return { ok: false, error: `Celda duplicada en semana ${slot.semanaIndex + 1}, día ${slot.diaSemana}` };
    }
    seen.add(key);
    if (slot.semanaIndex >= numSemanas) {
      return { ok: false, error: 'Semana fuera del rango del ciclo' };
    }
  }
  return { ok: true };
}

function validateCicloSlots(cicloSlots) {
  if (!cicloSlots.length) {
    return { ok: false, error: 'La secuencia debe tener al menos un paso (turno o descanso)' };
  }
  if (cicloSlots.length > 60) {
    return { ok: false, error: 'La secuencia no puede exceder 60 pasos' };
  }
  return { ok: true };
}

function buildPlantillaPayload(body, tenantId, empresaId) {
  const tipo = normalizeTipoPlantilla(body.tipo);
  const base = {
    tenantId,
    empresaId,
    nombre: trimString(body.nombre),
    descripcion: trimString(body.descripcion),
    tipo
  };

  if (tipo === 'fijo') {
    const turnoFijoId = parseOptionalObjectId(body.turnoFijoId);
    if (!turnoFijoId) {
      const err = new Error('INVALID_FIXED_SHIFT');
      err.userMessage = 'Selecciona el turno fijo de la plantilla';
      throw err;
    }
    return {
      ...base,
      turnoFijoId,
      cicloSlots: [],
      numSemanas: 1,
      slots: []
    };
  }

  if (tipo === 'secuencia') {
    const cicloSlots = parseCicloSlots(body);
    const validation = validateCicloSlots(cicloSlots);
    if (!validation.ok) {
      const err = new Error('INVALID_SEQUENCE');
      err.userMessage = validation.error;
      throw err;
    }
    return {
      ...base,
      turnoFijoId: null,
      cicloSlots,
      numSemanas: 1,
      slots: []
    };
  }

  const numSemanas = Math.max(1, Math.min(12, Number(body.numSemanas) || 2));
  const slots = parseMatrixSlots(body, numSemanas);
  const validation = validatePlantillaSlots(slots, numSemanas);
  if (!validation.ok) {
    const err = new Error('INVALID_ROTATION_SLOTS');
    err.userMessage = validation.error;
    throw err;
  }

  return {
    ...base,
    turnoFijoId: null,
    cicloSlots: [],
    numSemanas,
    slots
  };
}

function parseFechaAncla(body) {
  return parseDate(body.fechaAncla) || startOfDay(new Date());
}

module.exports = {
  parseMatrixSlots,
  parseCicloSlots,
  slotMapFromPlantilla,
  computeCyclePosition,
  resolveSlotFromPlantilla,
  resolveMatrizSlot,
  resolveSecuenciaSlot,
  resolveFijoSlot,
  getPlantillaTipo,
  describeSlot,
  describePlantillaResumen,
  buildPreviewPlantilla,
  buildMatrizSemanas,
  validatePlantillaSlots,
  validateCicloSlots,
  buildPlantillaPayload,
  parseFechaAncla,
  daysBetween
};

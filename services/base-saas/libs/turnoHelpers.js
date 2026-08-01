'use strict';

const { parseTimeHHMM, applyTimeToDate } = require('./timeHelpers');

function addMinutesToTimeHHMM(timeStr, deltaMin) {
  const parsed = parseTimeHHMM(timeStr);
  if (!parsed) return '—';
  const total = parsed.hours * 60 + parsed.minutes + Number(deltaMin || 0);
  const normalized = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function computeVentanaHolgura(horaReferencia, holguraAntesMin, holguraDespuesMin) {
  const antes = holguraAntesMin ?? 180;
  const despues = holguraDespuesMin ?? 180;
  return {
    desde: addMinutesToTimeHHMM(horaReferencia, -antes),
    hasta: addMinutesToTimeHHMM(horaReferencia, despues)
  };
}

function describeVentanaTurno(turno) {
  if (!turno?.horaEntrada || !turno?.horaSalida) return '';
  const ent = computeVentanaHolgura(turno.horaEntrada, turno.holguraAntesMin, turno.holguraDespuesMin);
  const sal = computeVentanaHolgura(turno.horaSalida, turno.holguraAntesMin, turno.holguraDespuesMin);
  return `Entrada ${turno.horaEntrada} (${ent.desde}–${ent.hasta}) · Salida ${turno.horaSalida} (${sal.desde}–${sal.hasta})`;
}

function labelTipoTurno(tipo, tiposTurno) {
  const found = (tiposTurno || []).find((t) => t.value === tipo);
  return found ? found.label : tipo || '—';
}

function labelModoTolerancia(modo, modos) {
  const found = (modos || []).find((m) => m.value === modo);
  return found ? found.value : modo || 'normal';
}

function isTimestampInHolgura(timestamp, fecha, horaReferencia, holguraAntesMin, holguraDespuesMin) {
  if (!timestamp || !horaReferencia) return false;
  const center = applyTimeToDate(fecha, horaReferencia);
  if (!center) return false;
  const antes = holguraAntesMin ?? 180;
  const despues = holguraDespuesMin ?? 180;
  const desde = new Date(center.getTime() - antes * 60000);
  const hasta = new Date(center.getTime() + despues * 60000);
  const ts = new Date(timestamp);
  return ts >= desde && ts <= hasta;
}

module.exports = {
  addMinutesToTimeHHMM,
  computeVentanaHolgura,
  describeVentanaTurno,
  labelTipoTurno,
  labelModoTolerancia,
  isTimestampInHolgura
};

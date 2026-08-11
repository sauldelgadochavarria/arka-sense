'use strict';

/**
 * Resuelve SDI y SBC topado (25 UMA) para IMSS.
 * - fijo: SDI capturado o, si vacío, salario diario contratado
 * - variable / mixto: SDI capturado (promedio de variables + fijo según política del patrón)
 */

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function resolverSdi(empleado = {}) {
  const sd = toNum(empleado.salarioDiario);
  const sdiCap = toNum(empleado.sdi);
  if (sdiCap > 0) return sdiCap;
  return sd;
}

function sbcTopado(sdi, uma, topeUma = 25) {
  const tope = toNum(uma) * toNum(topeUma, 25);
  if (tope <= 0) return toNum(sdi);
  return Math.min(toNum(sdi), tope);
}

function resolverBaseImss(empleado = {}, uma = 0, topeUma = 25) {
  const sdi = resolverSdi(empleado);
  const sbc = sbcTopado(sdi, uma, topeUma);
  return {
    tipoSalario: String(empleado.tipoSalario || 'fijo').toLowerCase() || 'fijo',
    salarioDiario: toNum(empleado.salarioDiario),
    sdi,
    sbc,
    topeSbc: toNum(uma) * toNum(topeUma, 25)
  };
}

module.exports = {
  resolverSdi,
  sbcTopado,
  resolverBaseImss
};

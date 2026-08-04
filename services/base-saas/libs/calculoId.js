'use strict';

const crypto = require('crypto');

function stamp() {
  const d = new Date();
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function shortToken(bytes = 3) {
  return crypto.randomBytes(bytes).toString('hex').toUpperCase();
}

/** ID de lote (una corrida de cálculo del período). Ej. LOT-20260804-152301-A1B2C3 */
function generateCalculoLoteId() {
  return `LOT-${stamp()}-${shortToken(3)}`;
}

/**
 * ID de cálculo por recibo. Ej. CALC-20260804-152301-001-F9A1
 * @param {string} loteId
 * @param {string|number} seqOrNumEmpleado
 */
function generateCalculoId(loteId, seqOrNumEmpleado) {
  const seq = String(seqOrNumEmpleado || '000')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase()
    .padStart(3, '0');
  const base = String(loteId || '').replace(/^LOT-/, '') || stamp();
  return `CALC-${base}-${seq}-${shortToken(2)}`;
}

module.exports = {
  generateCalculoLoteId,
  generateCalculoId
};

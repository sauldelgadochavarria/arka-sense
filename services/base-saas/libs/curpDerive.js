'use strict';

/**
 * Derivación y validación básica de CURP (18 chars).
 * Fecha: posiciones 5–10 AAMMDD; siglo por posición 17 (dígito=antes 2000, letra=2000+).
 * Sexo: posición 11. Entidad nacimiento: 12–13.
 */

const CURP_RE = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HMX]\w{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/i;

function normalizeCurp(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function digitoVerificadorCurp(curp17) {
  const DIC = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const c = curp17.charAt(i);
    const val = DIC.indexOf(c);
    sum += (val >= 0 ? val : 0) * (18 - i);
  }
  const dig = 10 - (sum % 10);
  return dig === 10 ? '0' : String(dig);
}

function validarCurp(raw) {
  const curp = normalizeCurp(raw);
  if (curp.length !== 18) return { ok: false, curp, error: 'curp_longitud' };
  if (!CURP_RE.test(curp)) return { ok: false, curp, error: 'curp_estructura' };
  const expected = digitoVerificadorCurp(curp.slice(0, 17));
  if (expected !== curp.charAt(17)) return { ok: false, curp, error: 'curp_digito' };
  return { ok: true, curp };
}

function deriveFromCurp(raw) {
  const v = validarCurp(raw);
  if (!v.ok) return { ...v, fechaNacimiento: null, sexo: '', entidadNacimiento: '' };

  const curp = v.curp;
  const yy = Number(curp.slice(4, 6));
  const mm = Number(curp.slice(6, 8));
  const dd = Number(curp.slice(8, 10));
  const sigloChar = curp.charAt(16);
  const century = /\d/.test(sigloChar) ? 1900 : 2000;
  const year = century + yy;
  let fechaNacimiento = null;
  try {
    const d = new Date(Date.UTC(year, mm - 1, dd));
    if (d.getUTCFullYear() === year && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd) {
      fechaNacimiento = d;
    }
  } catch (_) {
    /* ignore */
  }

  const sexChar = curp.charAt(10).toUpperCase();
  const sexo = sexChar === 'H' ? 'M' : sexChar === 'M' ? 'F' : sexChar === 'X' ? 'X' : '';

  return {
    ok: true,
    curp,
    fechaNacimiento,
    sexo,
    entidadNacimiento: curp.slice(11, 13).toUpperCase(),
    origen: 'curp'
  };
}

module.exports = {
  normalizeCurp,
  validarCurp,
  deriveFromCurp,
  digitoVerificadorCurp
};

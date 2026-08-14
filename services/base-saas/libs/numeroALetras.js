'use strict';

const UNIDADES = [
  '',
  'UN',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE'
];
const DECENAS = [
  '',
  'DIEZ',
  'VEINTE',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA'
];
const ESPECIALES = {
  11: 'ONCE',
  12: 'DOCE',
  13: 'TRECE',
  14: 'CATORCE',
  15: 'QUINCE',
  16: 'DIECISEIS',
  17: 'DIECISIETE',
  18: 'DIECIOCHO',
  19: 'DIECINUEVE',
  21: 'VEINTIUN',
  22: 'VEINTIDOS',
  23: 'VEINTITRES',
  24: 'VEINTICUATRO',
  25: 'VEINTICINCO',
  26: 'VEINTISEIS',
  27: 'VEINTISIETE',
  28: 'VEINTIOCHO',
  29: 'VEINTINUEVE'
};
const CENTENAS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS'
];

function decenaALetras(n) {
  if (n === 0) return '';
  if (n < 10) return UNIDADES[n];
  if (ESPECIALES[n]) return ESPECIALES[n];
  if (n < 30) return 'VEINTI' + UNIDADES[n - 20];
  const d = Math.floor(n / 10);
  const u = n % 10;
  return DECENAS[d] + (u ? ' Y ' + UNIDADES[u] : '');
}

function centenaALetras(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const r = n % 100;
  return (CENTENAS[c] + (r ? ' ' + decenaALetras(r) : '')).trim();
}

function grupoALetras(n) {
  return centenaALetras(n);
}

function numeroEnteroALetras(n) {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1e6);
  const miles = Math.floor((n % 1e6) / 1000);
  const resto = n % 1000;
  const parts = [];
  if (millones) {
    parts.push(millones === 1 ? 'UN MILLON' : grupoALetras(millones) + ' MILLONES');
  }
  if (miles) {
    parts.push(miles === 1 ? 'MIL' : grupoALetras(miles) + ' MIL');
  }
  if (resto) parts.push(grupoALetras(resto));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Convierte un monto a leyenda MXN, ej. "(SEIS MIL PESOS 50/100 M.N.)" */
function cantidadConLetra(monto) {
  const n = Math.round((Number(monto) || 0) * 100) / 100;
  const entero = Math.floor(n);
  const centavos = Math.round((n - entero) * 100);
  let letras = numeroEnteroALetras(entero);
  if (entero === 1) letras = 'UN';
  const pesos = entero === 1 ? 'PESO' : 'PESOS';
  return `(${letras} ${pesos} ${String(centavos).padStart(2, '0')}/100 M.N.)`;
}

module.exports = { cantidadConLetra, numeroEnteroALetras };

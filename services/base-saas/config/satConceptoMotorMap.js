'use strict';

/**
 * Mapa canónico: (tipo CFDI + clave SAT) → código del motor PayPilot.
 * Usado al importar históricos CFDI para inferir configuración de conceptos
 * de ley y prestaciones predefinidas (por subsidiaria).
 *
 * tipo: percepcion | deduccion | otro_pago
 * claveSat: c_TipoPercepcion / c_TipoDeduccion / c_TipoOtroPago (3 dígitos)
 */

/** Claves unívocas (1 SAT → 1 motor). */
const SAT_MOTOR_UNICO = {
  'percepcion|002': { codigo: 'AGUINALDO', categoria: 'ley' },
  'percepcion|003': { codigo: 'PTU', categoria: 'ley' },
  'percepcion|005': { codigo: 'FONDO_AHORRO_EMPRESA', categoria: 'prestacion' },
  'percepcion|010': { codigo: 'PREMIO_PUNTUALIDAD', categoria: 'prestacion' },
  'percepcion|020': { codigo: 'PRIMA_DOMINICAL', categoria: 'ley' },
  'percepcion|021': { codigo: 'PRIMA_VACACIONAL', categoria: 'ley' },
  'percepcion|022': { codigo: 'PRIMA_ANTIGUEDAD', categoria: 'ley' },
  'percepcion|029': { codigo: 'DESPENSA', categoria: 'prestacion' },
  'percepcion|049': { codigo: 'PREMIO_ASISTENCIA', categoria: 'prestacion' },

  'deduccion|001': { codigo: 'IMSS_OBRERO', categoria: 'ley' },
  'deduccion|002': { codigo: 'ISR', categoria: 'ley' },
  'deduccion|003': { codigo: 'IMSS_RCV', categoria: 'ley' },
  'deduccion|010': { codigo: 'INFONAVIT', categoria: 'ley' },
  'deduccion|011': { codigo: 'FONACOT', categoria: 'ley' },

  'otro_pago|002': { codigo: 'SUBSIDIO_EMPLEO', categoria: 'ley' },
  'otro_pago|007': { codigo: 'ISR_AJUSTADO_SUBSIDIO', categoria: 'ley' }
};

/**
 * Claves ambiguas: se desambiguan con el Concepto/nombre del XML.
 * `default: true` = fallback si ningún match de nombre aplica.
 */
const SAT_MOTOR_AMBIGUO = {
  // Misma clave SAT 001: sueldo ordinario vs séptimo día (Clave CFDI distinta).
  'percepcion|001': [
    {
      codigo: 'SEPTIMO_DIA',
      categoria: 'ley',
      match: /s[eé]ptimo|7\s*mo|7mo|7[oº°]|descanso\s*pagad/i
    },
    {
      codigo: 'SUELDO',
      categoria: 'ley',
      match: /sueldo|salario|ordinario|percepcion\s*ordin/i,
      default: true
    }
  ],
  'percepcion|019': [
    { codigo: 'HORAS_EXTRA_TRIPLES', categoria: 'ley', match: /tripl|triple|het|hef/i },
    { codigo: 'HORAS_EXTRA_SENCILLAS', categoria: 'ley', match: /sencill|simple/i },
    { codigo: 'HORAS_EXTRA_DOBLES', categoria: 'ley', match: /dobl|extra|heo|hed|horas?\s*ext/i, default: true }
  ],
  'deduccion|004': [
    { codigo: 'DED_FONDO_AHORRO_EMPRESA', categoria: 'prestacion', match: /empresa|patr[oó]n/i },
    { codigo: 'DED_SEGURO_VIDA', categoria: 'prestacion', match: /seguro.*vida|vida/i },
    { codigo: 'DED_SGMM', categoria: 'prestacion', match: /sgmm|gastos\s*m[eé]dic/i },
    { codigo: 'DED_FONDO_AHORRO', categoria: 'prestacion', match: /fondo|ahorro/i, default: true }
  ],
  'deduccion|019': [
    { codigo: 'CUOTA_SINDICAL', categoria: 'prestacion', match: /sindic/i, default: true }
  ]
};

/** Códigos motor conocidos (no re-mapear si el CFDI ya trae el código canónico). */
const CODIGOS_MOTOR_CONOCIDOS = new Set([
  ...Object.values(SAT_MOTOR_UNICO).map((x) => x.codigo),
  ...Object.values(SAT_MOTOR_AMBIGUO).flatMap((arr) => arr.map((x) => x.codigo)),
  'SEGURO_VIDA',
  'SGMM',
  'FONDO_AHORRO',
  'VALES_DESPENSA',
  'NETO_PAGAR',
  'DEDUCCIONES_TOTALES',
  'PERCEPCIONES_GRAVADAS'
]);

function padClaveSat(clave) {
  const s = String(clave || '').replace(/\D/g, '');
  if (!s) return '';
  return s.padStart(3, '0').slice(-3);
}

function mapKey(tipo, claveSat) {
  const t = String(tipo || '').toLowerCase().trim();
  const k = padClaveSat(claveSat);
  if (!t || !k) return '';
  return `${t}|${k}`;
}

module.exports = {
  SAT_MOTOR_UNICO,
  SAT_MOTOR_AMBIGUO,
  CODIGOS_MOTOR_CONOCIDOS,
  padClaveSat,
  mapKey
};

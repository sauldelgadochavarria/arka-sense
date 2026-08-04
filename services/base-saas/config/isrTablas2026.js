'use strict';

/**
 * Tarifas ISR 2026 (Anexo 8 RMF / Art. 96 y 152 LISR).
 * Fuente de referencia: DOF 28/12/2025. Verificar siempre contra SAT/DOF.
 *
 * Catorcenal: el Anexo 8 no publica tarifa de 14 días; se deriva de diaria × 14
 * (práctica habitual en sistemas de nómina).
 */

const PCT = [0.0192, 0.064, 0.1088, 0.16, 0.1792, 0.2136, 0.2352, 0.3, 0.32, 0.34, 0.35];

function rows(limites, cuotas) {
  const out = [];
  for (let i = 0; i < limites.length; i++) {
    const [li, ls] = limites[i];
    out.push({
      limiteInferior: li,
      limiteSuperior: ls == null ? 999999999 : ls,
      cuotaFija: cuotas[i],
      porcentajeExcedente: PCT[i]
    });
  }
  return out;
}

const ISR_DIARIA = rows(
  [
    [0.01, 27.78],
    [27.79, 235.81],
    [235.82, 414.41],
    [414.42, 481.73],
    [481.74, 576.76],
    [576.77, 1163.25],
    [1163.26, 1833.44],
    [1833.45, 3500.35],
    [3500.36, 4667.13],
    [4667.14, 14001.38],
    [14001.39, null]
  ],
  [0, 0.53, 13.85, 33.28, 44.05, 61.08, 186.35, 343.98, 844.05, 1217.42, 4391.07]
);

const ISR_SEMANAL = rows(
  [
    [0.01, 194.46],
    [194.47, 1650.67],
    [1650.68, 2900.87],
    [2900.88, 3372.11],
    [3372.12, 4037.32],
    [4037.33, 8142.75],
    [8142.76, 12834.08],
    [12834.09, 24502.45],
    [24502.46, 32669.91],
    [32669.92, 98009.66],
    [98009.67, null]
  ],
  [0, 3.71, 96.95, 232.96, 308.35, 427.56, 1304.45, 2407.86, 5908.35, 8521.94, 30737.49]
);

const ISR_DECENAL = rows(
  [
    [0.01, 277.8],
    [277.81, 2358.1],
    [2358.11, 4144.1],
    [4144.11, 4817.3],
    [4817.31, 5767.6],
    [5767.61, 11632.5],
    [11632.51, 18334.4],
    [18334.41, 35003.5],
    [35003.51, 46671.3],
    [46671.31, 140013.8],
    [140013.81, null]
  ],
  [0, 5.3, 138.5, 332.8, 440.5, 610.8, 1863.5, 3439.8, 8440.5, 12174.2, 43910.7]
);

const ISR_QUINCENAL = rows(
  [
    [0.01, 416.7],
    [416.71, 3537.15],
    [3537.16, 6216.15],
    [6216.16, 7225.95],
    [7225.96, 8651.4],
    [8651.41, 17448.75],
    [17448.76, 27501.6],
    [27501.61, 52505.25],
    [52505.26, 70006.95],
    [70006.96, 210020.7],
    [210020.71, null]
  ],
  [0, 7.95, 207.75, 499.2, 660.75, 916.2, 2795.25, 5159.7, 12660.75, 18261.3, 65866.05]
);

const ISR_MENSUAL = rows(
  [
    [0.01, 844.59],
    [844.6, 7168.51],
    [7168.52, 12598.02],
    [12598.03, 14644.64],
    [14644.65, 17533.63],
    [17533.64, 35362.83],
    [35362.84, 55736.68],
    [55736.69, 106410.5],
    [106410.51, 141880.66],
    [141880.67, 425641.99],
    [425642.0, null]
  ],
  [0, 16.22, 420.95, 1011.68, 1339.14, 1856.84, 5665.16, 10457.09, 25659.23, 37009.69, 133488.54]
);

const ISR_ANUAL = rows(
  [
    [0.01, 10135.11],
    [10135.12, 86022.11],
    [86022.12, 151176.19],
    [151176.2, 175735.66],
    [175735.67, 210403.69],
    [210403.7, 424353.97],
    [424353.98, 668840.14],
    [668840.15, 1276925.98],
    [1276925.99, 1702567.97],
    [1702567.98, 5107703.92],
    [5107703.93, null]
  ],
  [0, 194.59, 5051.37, 12140.13, 16069.64, 22282.14, 67981.92, 125485.07, 307910.81, 444116.23, 1601862.46]
);

/** Catorcenal (14 días) = diaria × 14 */
const ISR_CATORCENAL = ISR_DIARIA.map((r) => ({
  limiteInferior: Math.round(r.limiteInferior * 14 * 100) / 100,
  limiteSuperior:
    r.limiteSuperior >= 999999999 ? 999999999 : Math.round(r.limiteSuperior * 14 * 100) / 100,
  cuotaFija: Math.round(r.cuotaFija * 14 * 100) / 100,
  porcentajeExcedente: r.porcentajeExcedente
}));
if (ISR_CATORCENAL[0]) ISR_CATORCENAL[0].limiteInferior = 0.01;

const TABLAS_ISR_2026 = [
  {
    codigo: 'ISR_DIARIA',
    nombre: 'Tabla ISR diaria Art. 96 LISR 2026',
    periodicidad: 'diario',
    rangos: ISR_DIARIA
  },
  {
    codigo: 'ISR_SEMANAL',
    nombre: 'Tabla ISR semanal Art. 96 LISR 2026',
    periodicidad: 'semanal',
    rangos: ISR_SEMANAL
  },
  {
    codigo: 'ISR_DECENAL',
    nombre: 'Tabla ISR decenal (10 días) Art. 96 LISR 2026',
    periodicidad: 'decenal',
    rangos: ISR_DECENAL
  },
  {
    codigo: 'ISR_CATORCENAL',
    nombre: 'Tabla ISR catorcenal (14 días) derivada de diaria × 14 — 2026',
    periodicidad: 'catorcenal',
    rangos: ISR_CATORCENAL
  },
  {
    codigo: 'ISR_QUINCENAL',
    nombre: 'Tabla ISR quincenal Art. 96 LISR 2026',
    periodicidad: 'quincenal',
    rangos: ISR_QUINCENAL
  },
  {
    codigo: 'ISR_MENSUAL',
    nombre: 'Tabla ISR mensual Art. 96 LISR 2026',
    periodicidad: 'mensual',
    rangos: ISR_MENSUAL
  },
  {
    codigo: 'ISR_ANUAL',
    nombre: 'Tabla ISR anual Art. 152 LISR 2026 (ajuste / proyección)',
    periodicidad: 'anual',
    rangos: ISR_ANUAL
  }
];

const CODIGO_ISR_POR_TIPO_PERIODO = {
  diario: 'ISR_DIARIA',
  semanal: 'ISR_SEMANAL',
  decena: 'ISR_DECENAL',
  decenal: 'ISR_DECENAL',
  catorcenal: 'ISR_CATORCENAL',
  quincenal: 'ISR_QUINCENAL',
  mensual: 'ISR_MENSUAL',
  anual: 'ISR_ANUAL'
};

function codigoTablaIsrParaPeriodo(tipoPeriodo) {
  const key = String(tipoPeriodo || 'quincenal').toLowerCase();
  return CODIGO_ISR_POR_TIPO_PERIODO[key] || 'ISR_MENSUAL';
}

module.exports = {
  TABLAS_ISR_2026,
  CODIGO_ISR_POR_TIPO_PERIODO,
  codigoTablaIsrParaPeriodo,
  VIGENCIA_ISR_2026: new Date('2026-01-01')
};

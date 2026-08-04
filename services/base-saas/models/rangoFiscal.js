const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_RANGOS_FISCALES } = require('../config/constants');

/**
 * Filas de tabla fiscal.
 * - ISR: límites absolutos + cuota fija + % excedente.
 * - IMSS_CUOTAS: ramo con tasa obrero/patrón y baseCalculo.
 * - IMSS_CEAV_PATRONAL: tramos con límites en SM/UMA y tasa patronal.
 */
const rangoFiscalSchema = new mongoose.Schema(
  {
    tablaId: { type: mongoose.Schema.Types.ObjectId, ref: 'TablaFiscal', required: true, index: true },
    clave: { type: String, trim: true, uppercase: true, default: '' },
    nombre: { type: String, trim: true, default: '' },
    limiteInferior: { type: Number, required: true, default: 0 },
    limiteSuperior: { type: Number, required: true, default: 999999999 },
    cuotaFija: { type: Number, default: 0 },
    /** ISR: % excedente. Legacy IMSS: tasa única. */
    porcentajeExcedente: { type: Number, default: 0 },
    /** IMSS: tasa trabajador (decimal). */
    tasaObrero: { type: Number, default: null },
    /** IMSS: tasa patrón (decimal). */
    tasaPatronal: { type: Number, default: null },
    /**
     * sbc | uma | sbc_menos_3_uma | prima_rt | '' (ISR)
     */
    baseCalculo: {
      type: String,
      enum: ['', 'sbc', 'uma', 'sbc_menos_3_uma', 'prima_rt', 'ceav_tramo'],
      default: ''
    },
    /** Para tramos CEAV: sm | uma | abs */
    limiteInfUnidad: { type: String, enum: ['', 'sm', 'uma', 'abs'], default: '' },
    limiteSupUnidad: { type: String, enum: ['', 'sm', 'uma', 'abs'], default: '' }
  },
  { timestamps: true, collection: COLLECTION_RANGOS_FISCALES }
);

rangoFiscalSchema.index({ tablaId: 1, limiteInferior: 1 });
rangoFiscalSchema.index({ tablaId: 1, clave: 1 });

async function getRangoFiscalModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.RangoFiscal ||
    conn.model('RangoFiscal', rangoFiscalSchema, COLLECTION_RANGOS_FISCALES)
  );
}

module.exports = getRangoFiscalModel;

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');

const empresaSchema = new mongoose.Schema(
  {
    razonSocial: { type: String, required: true, trim: true },
    nombreComercial: { type: String, trim: true },
    rfc: { type: String, trim: true, uppercase: true, default: '' },
    domicilioFiscal: { type: String, trim: true, default: '' },
    ciudad: { type: String, trim: true, default: '' },
    estado: { type: String, trim: true, default: '' },
    codigoPostal: { type: String, trim: true, default: '' },
    /** Registro patronal IMSS de la empresa (empleados pueden sobreescribir). */
    registroPatronal: { type: String, trim: true, uppercase: true, default: '' },
    giro: { type: String, trim: true, default: '' },
    telefono: { type: String, trim: true, default: '' },
    tenantId: { type: String, trim: true },
    activo: { type: Boolean, default: true },
    /** Prima de riesgos de trabajo IMSS (decimal, ej. 0.54355 = clase II típica). Rango legal ~0.5%–15%. */
    primaRiesgoTrabajo: { type: Number, default: 0.00543 },
    /**
     * ISR dual:
     * - sat: solo motor oficial
     * - inteligente_alerta: SAT en CFDI + proyección/alertas (recomendado)
     * - inteligente_retencion: reservado; v1 igual no altera CFDI
     */
    nominaIsr: {
      modo: {
        type: String,
        enum: ['sat', 'inteligente_alerta', 'inteligente_retencion'],
        default: 'inteligente_alerta'
      },
      activo: { type: Boolean, default: true }
    },
    /**
     * Política de días pagados / descanso semanal (configurable por empresa).
     * Ver config/politicaDescansoDefaults.js
     */
    nominaDias: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
  },
  { timestamps: true, collection: 'empresas' }
);

empresaSchema.index({ tenantId: 1 }, { unique: true, sparse: true });

async function getEmpresaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.Empresa || conn.model('Empresa', empresaSchema, 'empresas');
}

module.exports = getEmpresaModel;

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_NOMINA_CONCEPTOS } = require('../config/constants');
const { fiscalSubSchema, satSubSchema } = require('./fiscalConceptoShared');

/**
 * Colección única de conceptos por tenant (nómina + pre-nómina).
 * Se separan solo con aplicaEn: nomina | prenomina | ambos.
 */
const conceptoNominaSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    codigo: { type: String, required: true, trim: true, uppercase: true },
    codigoExterno: { type: String, trim: true, default: '' },
    nombre: { type: String, required: true, trim: true },
    tipo: { type: String, enum: ['percepcion', 'deduccion', 'otro_pago'], required: true },
    naturaleza: {
      type: String,
      enum: ['fiscal', 'gravado', 'exento', 'mixto', 'informativo'],
      default: 'gravado'
    },
    /**
     * Clasificación de negocio (enum sistema categoria_concepto).
     * p.ej. prevision_social → despensa, fondo, seguros de previsión.
     */
    categoria: {
      type: String,
      trim: true,
      default: 'ordinario',
      index: true
    },
    aplicaEn: {
      type: String,
      enum: ['nomina', 'prenomina', 'ambos'],
      default: 'nomina',
      index: true
    },
    clavePrenomina: { type: String, trim: true, uppercase: true, default: '' },
    formulaPrenomina: {
      type: String,
      enum: ['salario_periodo', 'horas_extra', 'retardos', 'faltas', 'salida_anticipada', 'manual'],
      required: false
    },
    tiposIncidencia: { type: [String], default: [] },
    insumosContexto: { type: [String], default: [] },
    fase: { type: Number, min: 1, max: 4, default: 1 },
    claveSAT: { type: String, trim: true, default: '' },
    gravado: { type: Boolean, default: true },
    sat: { type: satSubSchema, default: () => ({}) },
    fiscal: { type: fiscalSubSchema, default: () => ({}) },
    aplicaTipoNomina: {
      type: [String],
      default: []
    },
    /** Vacío = todos. Valores del enum sistema tipo_empleado. */
    aplicaTiposEmpleado: { type: [String], default: [] },
    /** Vacío = todos. Valores del enum sistema tipo_periodo (semanal, quincenal…). */
    aplicaTiposPeriodo: { type: [String], default: [] },
    ordenCalculo: { type: Number, default: 100 },
    /** Orden en el pre-recibo impreso (percepciones/deducciones). Menor = primero. */
    ordenImpresion: { type: Number, default: 100 },
    dependientes: { type: [String], default: [] },
    cuentaContable: { type: String, trim: true, default: '' },
    activo: { type: Boolean, default: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, collection: COLLECTION_NOMINA_CONCEPTOS }
);

conceptoNominaSchema.index({ tenantId: 1, codigo: 1 }, { unique: true });
conceptoNominaSchema.index({ tenantId: 1, activo: 1, ordenCalculo: 1 });
conceptoNominaSchema.index({ tenantId: 1, activo: 1, ordenImpresion: 1 });
conceptoNominaSchema.index({ tenantId: 1, aplicaEn: 1, activo: 1 });

async function getConceptoNominaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.ConceptoNomina ||
    conn.model('ConceptoNomina', conceptoNominaSchema, COLLECTION_NOMINA_CONCEPTOS)
  );
}

module.exports = getConceptoNominaModel;

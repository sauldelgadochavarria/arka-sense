const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_PAYROLL_CONCEPTS } = require('../config/constants');

const payrollConceptSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    clave: { type: String, required: true, trim: true, uppercase: true },
    nombre: { type: String, required: true, trim: true },
    tipo: { type: String, enum: ['percepcion', 'deduccion'], required: true },
    formula: {
      type: String,
      enum: ['salario_periodo', 'horas_extra', 'retardos', 'faltas', 'salida_anticipada', 'manual'],
      default: 'manual'
    },
    valorDefault: { type: Number, default: 0 },
    codigoExterno: { type: String, trim: true, default: '' },
    codigoCatalogo: { type: String, trim: true, uppercase: true, default: '' },
    tiposIncidencia: { type: [String], default: [] },
    cuentaContable: { type: String, trim: true, default: '' },
    activo: { type: Boolean, default: true },
    orden: { type: Number, default: 0 }
  },
  { timestamps: true, collection: COLLECTION_PAYROLL_CONCEPTS }
);

payrollConceptSchema.index({ tenantId: 1, clave: 1 }, { unique: true });

async function getPayrollConceptModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.PayrollConcept ||
    conn.model('PayrollConcept', payrollConceptSchema, COLLECTION_PAYROLL_CONCEPTS)
  );
}

module.exports = getPayrollConceptModel;

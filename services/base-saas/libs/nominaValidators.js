'use strict';

const { z } = require('zod');

const TIPOS_PERIODO = ['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'];
const TIPOS_NOMINA = [
  'ordinaria',
  'extraordinaria',
  'finiquito',
  'aguinaldo',
  'ptu',
  'primas',
  'comisiones',
  'indemnizacion',
  'otro'
];
const TIPOS_CONCEPTO = ['percepcion', 'deduccion', 'otro_pago'];
const NATURALEZAS = ['fiscal', 'gravado', 'exento', 'mixto', 'informativo'];

const codigoConcepto = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Código en MAYÚSCULAS: letras, números y guión bajo');

const formulaPayloadSchema = z.object({
  conceptoCodigo: codigoConcepto,
  tipoPeriodo: z.enum(TIPOS_PERIODO),
  tipoNomina: z.enum(TIPOS_NOMINA).default('ordinaria'),
  condicion: z.string().trim().max(500).optional().default(''),
  formula: z.string().trim().min(1).max(2000),
  dependencias: z.array(codigoConcepto).default([]),
  redondeo: z.number().int().min(0).max(6).default(2)
});

const conceptoPayloadSchema = z.object({
  codigo: codigoConcepto,
  nombre: z.string().trim().min(1).max(120),
  tipo: z.enum(TIPOS_CONCEPTO),
  naturaleza: z.enum(NATURALEZAS).default('gravado'),
  ordenCalculo: z.coerce.number().int().min(1).max(9999).default(100),
  claveSAT: z.string().trim().max(10).optional().default('')
});

function formatZodError(err) {
  if (!err?.issues?.length) return err.message || 'Validación fallida';
  return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

function validateFormulaPayload(data) {
  const parsed = formulaPayloadSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }
  return parsed.data;
}

function validateConceptoPayload(data) {
  const parsed = conceptoPayloadSchema.safeParse({
    ...data,
    codigo: String(data.codigo || '').trim().toUpperCase()
  });
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }
  return parsed.data;
}

module.exports = {
  formulaPayloadSchema,
  conceptoPayloadSchema,
  validateFormulaPayload,
  validateConceptoPayload
};

'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_LAYOUTS_BANCARIOS } = require('../config/constants');

const campoLayoutSchema = new mongoose.Schema(
  {
    path: { type: String, trim: true, default: '' },
    longitud: { type: Number, default: 0, min: 0 },
    formato: { type: String, trim: true, default: 'align.izq' },
    literal: { type: String, default: '' },
    /**
     * Para path fecha.hoyMas: días a sumar a hoy (puede ser negativo).
     * También aplica a atajos fecha.hoy_mas_N en el path.
     */
    diasOffset: { type: Number, default: 0 },
    orden: { type: Number, default: 0 }
  },
  { _id: false }
);

const layoutBancarioSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    subsidiariaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subsidiaria',
      default: null,
      index: true
    },
    codigo: { type: String, required: true, trim: true, uppercase: true },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '' },
    bancoNombre: { type: String, trim: true, default: '' },
    modo: {
      type: String,
      enum: ['ancho_fijo', 'delimitado', 'xml'],
      default: 'ancho_fijo'
    },
    /** Separador para modo delimitado */
    delimitador: { type: String, default: ',' },
    finLinea: { type: String, default: '\n' },
    encoding: { type: String, default: 'utf8' },
    /** Plantilla XML por pago (placeholders {{path}}) */
    xmlPlantillaDetalle: { type: String, default: '' },
    /**
     * Plantilla envolvente: {{header}} {{detalle}} {{footer}}
     * Si vacío, se concatena header + líneas detalle + footer.
     */
    xmlPlantillaDocumento: { type: String, default: '' },
    header: { type: [campoLayoutSchema], default: [] },
    detalle: { type: [campoLayoutSchema], default: [] },
    footer: { type: [campoLayoutSchema], default: [] },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_LAYOUTS_BANCARIOS }
);

layoutBancarioSchema.index(
  { tenantId: 1, empresaId: 1, codigo: 1 },
  { unique: true }
);
layoutBancarioSchema.index({ tenantId: 1, empresaId: 1, subsidiariaId: 1, activo: 1 });

async function getLayoutBancarioModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.LayoutBancario ||
    conn.model('LayoutBancario', layoutBancarioSchema, COLLECTION_LAYOUTS_BANCARIOS)
  );
}

module.exports = getLayoutBancarioModel;

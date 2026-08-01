'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_SYSTEM_ENUMS } = require('../config/constants');

const enumItemSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '' },
    orden: { type: Number, default: 0 },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    activo: { type: Boolean, default: true }
  },
  { _id: false }
);

const systemEnumSchema = new mongoose.Schema(
  {
    grupo: { type: String, required: true, trim: true, unique: true, index: true },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '' },
    items: { type: [enumItemSchema], default: [] },
    editable: { type: Boolean, default: true },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_SYSTEM_ENUMS }
);

async function getSystemEnumModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.SystemEnum || conn.model('SystemEnum', systemEnumSchema, COLLECTION_SYSTEM_ENUMS);
}

module.exports = getSystemEnumModel;

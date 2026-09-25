const mongoose = require('mongoose');

const menuSchema = new mongoose.Schema(
  {
    menuPrincipal: { type: String, required: true },
    rutaApp: { type: String },
    rutaMenu: { type: String },
    icono: { type: String },
    roles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Rol' }],
    activo: { type: Boolean, default: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Menu', default: null },
    orden: { type: Number, default: 0 },
    esCategoria: { type: Boolean, default: false },
    traduccion: { es: String, en: String },
    requiredFeatureKeys: [{ type: String }],
    /** Si tiene valores, basta con que el tenant tenga al menos uno (OR). */
    requiredFeatureKeysAny: [{ type: String }],
    /**
     * Paquete de navegación (raíces): nucleo | asistencia_prenomina | nomina.
     * Usado por el selector de módulo del sidebar.
     */
    modulePackage: {
      type: String,
      enum: ['nucleo', 'asistencia_prenomina', 'nomina'],
      required: false
    }
  },
  { collection: 'mainmenu' }
);

module.exports = menuSchema;

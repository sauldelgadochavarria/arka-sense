const mongoose = require('mongoose');

const menuSchema = new mongoose.Schema(
  {
    rutaMenu: { type: String },
    menuPrincipal: { type: String, required: true },
    rutaApp: { type: String },
    icono: { type: String },
    roles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Rol' }],
    activo: { type: Boolean, default: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Menu', default: null },
    orden: { type: Number, default: 0 },
    esCategoria: { type: Boolean, default: false },
    traduccion: {
      es: { type: String },
      en: { type: String }
    },
    requiredFeatureKeys: [{ type: String }]
  },
  { timestamps: true, collection: 'mainmenu' }
);

module.exports = mongoose.model('Menu', menuSchema, 'mainmenu');

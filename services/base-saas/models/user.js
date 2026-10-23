const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_USERS } = require('../config/constants');

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    userName: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    roles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Rol' }],
    subsidiariaAccess: [
      {
        subsidiaria: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria', required: true },
        rol: { type: mongoose.Schema.Types.ObjectId, ref: 'Rol', required: true }
      }
    ],
    tenantId: { type: String, trim: true, default: '' },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', default: null },
    /** true hasta que la persona define su contraseña con el enlace del correo. */
    credencialesPendientes: { type: Boolean, default: false },
    inviteTokenHash: { type: String, default: '' },
    inviteExpiresAt: { type: Date, default: null },
    inviteSentAt: { type: Date, default: null },
    activo: { type: Boolean, default: true },
    activeSessionToken: { type: String, default: '' },
    /** Incrementar para invalidar JWT de la app móvil (baja / desactivar). */
    mobileTokenVersion: { type: Number, default: 0 }
  },
  { timestamps: true, collection: COLLECTION_USERS }
);

userSchema.index({ tenantId: 1 }, { sparse: true });
userSchema.index({ inviteTokenHash: 1 }, { sparse: true });

async function getUserModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.SaasUser || conn.model('SaasUser', userSchema, COLLECTION_USERS);
}

module.exports = { getUserModel, userSchema };

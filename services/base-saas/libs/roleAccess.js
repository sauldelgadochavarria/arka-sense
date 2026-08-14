'use strict';

/**
 * Usuario restringido al portal: solo tiene rol(es) de empleado sin permisos de administración.
 */
function isSoloPortalUser(session) {
  const roles = session?.roles || [];
  if (!roles.length) return false;

  const tieneAccesoAdmin = roles.some(
    (r) => r.esAdmin || r.esAdminSistema || r.adminAccesoConfig
  );
  if (tieneAccesoAdmin) return false;

  return roles.every((r) => r.nombre === 'Empleado' || r.esPortalEmpleado === true);
}

function sessionRoles(session) {
  return session?.roles || [];
}

/**
 * Operar nómina formal: abrir período, calcular, cerrar, editar conceptos/config.
 * Rol «Nómina» (consulta/prenómina) NO incluye esto; sí el rol «Nómina operativa».
 * Sin roles en sesión → permisivo (bootstrap / mismo criterio que reportes).
 */
function userCanEditNomina(session) {
  const roles = sessionRoles(session);
  if (!roles.length) return true;
  return roles.some((r) => r.puedeGestionarNomina || r.esAdmin || r.esAdminSistema);
}

function userCanViewNomina(session) {
  const roles = sessionRoles(session);
  if (!roles.length) return true;
  if (userCanEditNomina(session)) return true;
  return roles.some((r) => r.puedeVerNomina === true);
}

/**
 * Resuelve modo de UI: vista | edicion
 * - ?modo=vista fuerza lectura aunque pueda editar
 * - sin permiso de edición siempre es vista
 */
function resolveNominaConceptoModo(session, query = {}) {
  const canEdit = userCanEditNomina(session);
  const canView = userCanViewNomina(session);
  const raw = String(query.modo || query.mode || '')
    .trim()
    .toLowerCase();
  const pideVista = raw === 'vista' || raw === 'ver' || raw === 'view' || raw === 'readonly';
  const pideEdicion = raw === 'edicion' || raw === 'edit' || raw === 'editar';

  if (!canEdit) {
    return { canEdit: false, canView, modoVista: true, modo: 'vista' };
  }
  if (pideVista) {
    return { canEdit: true, canView: true, modoVista: true, modo: 'vista' };
  }
  // Default y ?modo=edicion → edición
  if (pideEdicion || raw === '') {
    return { canEdit: true, canView: true, modoVista: false, modo: 'edicion' };
  }
  return { canEdit: true, canView: true, modoVista: false, modo: 'edicion' };
}

module.exports = {
  isSoloPortalUser,
  sessionRoles,
  userCanEditNomina,
  userCanViewNomina,
  resolveNominaConceptoModo
};

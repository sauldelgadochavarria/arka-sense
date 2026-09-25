'use strict';

/**
 * Paquetes de navegación SaaS (alineados con FEATURE_PACKAGES del admin).
 * Los menús raíz llevan `modulePackage`; el selector filtra el sidebar.
 */
const MENU_PACKAGES = [
  {
    id: 'nucleo',
    label: 'Núcleo',
    description: 'Personal, configuración e integraciones',
    /** Siempre visible en el selector cuando hay sesión. */
    alwaysAvailable: true,
    featureKeysAny: ['core', 'personal', 'config_admin', 'integraciones']
  },
  {
    id: 'asistencia_prenomina',
    label: 'Asistencia-Prenómina',
    description: 'Tiempo, incidencias y pre-nómina',
    alwaysAvailable: false,
    featureKeysAny: ['asistencia', 'incidencias', 'prenomina', 'reportes']
  },
  {
    id: 'nomina',
    label: 'Nómina',
    description: 'Cálculo, timbrado y cumplimiento',
    alwaysAvailable: false,
    featureKeysAny: ['nomina', 'gestion_documental']
  }
];

const MENU_MODULE_VIEWS = ['ambos', 'nucleo', 'asistencia_prenomina', 'nomina'];

function packageAvailable(pkg, featureFlags) {
  if (!pkg) return false;
  if (pkg.alwaysAvailable) return true;
  const flags = featureFlags || {};
  return (pkg.featureKeysAny || []).some((k) => flags[k] === true);
}

function availableMenuPackages(featureFlags) {
  return MENU_PACKAGES.filter((p) => packageAvailable(p, featureFlags));
}

/**
 * Normaliza preferencia de sesión.
 * Si solo hay un módulo de producto (+ núcleo), fuerza 'ambos'.
 */
function resolveMenuModuleView(raw, featureFlags) {
  const available = availableMenuPackages(featureFlags);
  const productMods = available.filter((p) => p.id !== 'nucleo');
  const requested = MENU_MODULE_VIEWS.includes(raw) ? raw : 'ambos';

  if (productMods.length <= 1) return 'ambos';
  if (requested === 'ambos') return 'ambos';
  if (requested === 'nucleo') return 'nucleo';
  if (available.some((p) => p.id === requested)) return requested;
  return 'ambos';
}

/** ¿El nodo raíz debe mostrarse con la vista activa? */
function rootVisibleForModuleView(root, moduleView) {
  const pkg = root.modulePackage || 'nucleo';
  if (moduleView === 'ambos') return true;
  if (moduleView === 'nucleo') return pkg === 'nucleo' || !root.modulePackage;
  // Vista de un módulo de producto: ese módulo + núcleo compartido
  return pkg === moduleView || pkg === 'nucleo';
}

module.exports = {
  MENU_PACKAGES,
  MENU_MODULE_VIEWS,
  availableMenuPackages,
  resolveMenuModuleView,
  rootVisibleForModuleView,
  packageAvailable
};

const getMenuModel = require('../models/menu');
const { tenantHasFeature, tenantHasAnyFeature } = require('../libs/tenantFeatureFlags');
const {
  availableMenuPackages,
  resolveMenuModuleView,
  rootVisibleForModuleView
} = require('../libs/menuPackages');

class MenuService {
  static async getMenuTree(userRoleIds = [], options = {}) {
    const Menu = await getMenuModel();
    const featureFlags = options.featureFlags || {};
    const moduleView = resolveMenuModuleView(options.moduleView, featureFlags);
    const roleSet = new Set((userRoleIds || []).map(String));

    const allMenus = await Menu.find({ activo: true }).sort({ orden: 1, menuPrincipal: 1 }).lean();

    function menuAllowed(menu) {
      const keysAll = menu.requiredFeatureKeys || [];
      const keysAny = menu.requiredFeatureKeysAny || [];

      if (keysAll.length > 0 && !keysAll.every((k) => tenantHasFeature(featureFlags, k))) {
        return false;
      }
      if (keysAny.length > 0 && !tenantHasAnyFeature(featureFlags, keysAny)) {
        return false;
      }
      if (!menu.roles || menu.roles.length === 0) return true;
      return menu.roles.some((r) => roleSet.has(String(r)));
    }

    const filtered = allMenus.filter(menuAllowed);
    const byId = new Map(filtered.map((m) => [String(m._id), { ...m, children: [] }]));
    const roots = [];

    for (const m of byId.values()) {
      if (m.parentId && byId.has(String(m.parentId))) {
        byId.get(String(m.parentId)).children.push(m);
      } else if (!m.parentId) {
        roots.push(m);
      }
    }

    for (const node of byId.values()) {
      node.children.sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.menuPrincipal.localeCompare(b.menuPrincipal));
    }
    roots.sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.menuPrincipal.localeCompare(b.menuPrincipal));

    const visibleRoots = roots.filter((r) => rootVisibleForModuleView(r, moduleView));

    return {
      tree: visibleRoots,
      moduleView,
      availablePackages: availableMenuPackages(featureFlags)
    };
  }
}

module.exports = MenuService;

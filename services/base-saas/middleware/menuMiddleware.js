const MenuService = require('../services/menuService');
const { resolveMenuModuleView } = require('../libs/menuPackages');

async function loadMenus(req, res, next) {
  try {
    const roleIds = (req.session?.roles || []).map((r) => r._id || r);
    const featureFlags =
      req.tenant?.featureFlags || req.session?.featureFlags || {};
    const moduleView = resolveMenuModuleView(req.session?.menuModuleView, featureFlags);

    const result = await MenuService.getMenuTree(roleIds, { featureFlags, moduleView });
    res.locals.menuTree = result.tree;
    res.locals.menuModuleView = result.moduleView;
    res.locals.menuPackages = result.availablePackages;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = loadMenus;

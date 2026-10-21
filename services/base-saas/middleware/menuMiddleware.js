const MenuService = require('../services/menuService');
const { resolveMenuModuleView } = require('../libs/menuPackages');
const { effectiveFeatureFlagsFromReq } = require('../libs/tenantFeatureFlags');

async function loadMenus(req, res, next) {
  try {
    const roleIds = (req.session?.roles || []).map((r) => r._id || r);
    const featureFlags = effectiveFeatureFlagsFromReq(req);
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

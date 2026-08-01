const MenuService = require('../services/menuService');

async function loadMenus(req, res, next) {
  try {
    const roleIds = (req.session?.roles || []).map((r) => r._id || r);
    const featureFlags =
      req.tenant?.featureFlags || req.session?.featureFlags || {};
    res.locals.menuTree = await MenuService.getMenuTree(roleIds, { featureFlags });
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = loadMenus;

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');

const { Tenant, TenantDomain, Menu, Plan } = require('./models');
const FormulaFunction = require('./models/formulaFunction');
const {
  validateJavascriptCuerpo,
  evaluateJavascriptCuerpo
} = require('./lib/formulaJsRunner');
const { loadFormulaHelperCatalog } = require('./lib/formulaHelperCatalog');
const { adminAccessControl } = require('./middleware/adminAccessControl');
const { internalApiAuth } = require('./middleware/internalApiAuth');
const { apiLimiter } = require('./middleware/apiLimiter');
const { provisionEmpresaYSubsidiaria } = require('./lib/provisionTenantOrg');
const { provisionTenantOwnerUser } = require('./lib/provisionTenantOwnerUser');
const {
  FEATURE_FLAG_KEYS,
  normalizeIncomingFeatureFlags,
  parseFeatureFlagsFromForm,
  mergeFeatureFlagsForDisplay
} = require('./lib/featureFlagsCatalog');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = Number(process.env.PORT || 3000);
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27020/config';
const TENANT_BASE_DOMAIN = process.env.TENANT_BASE_DOMAIN || 'localhost:4003';
const TENANT_APP_PROTOCOL = process.env.TENANT_APP_PROTOCOL || 'http';

function normalizeSlug(slug) {
  return String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function tenantLoginUrl(slug) {
  return `${TENANT_APP_PROTOCOL}://${TENANT_BASE_DOMAIN}/auth-login?account=${encodeURIComponent(slug)}`;
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'arka-presence-admin' }));

// --- UI Admin ---
app.get('/admin', adminAccessControl, async (_req, res) => {
  res.redirect('/admin/tenants');
});

app.get('/admin/tenants', adminAccessControl, async (_req, res) => {
  const tenants = await Tenant.find().sort({ createdAt: -1 }).lean();
  res.render('tenants/index', { tenants, tenantLoginUrl, featureLabels: FEATURE_FLAG_KEYS });
});

app.get('/admin/tenants/new', adminAccessControl, (_req, res) => {
  res.render('tenants/new', { featureFlags: FEATURE_FLAG_KEYS });
});

app.post('/admin/tenants', adminAccessControl, async (req, res) => {
  const displayName = String(req.body.displayName || '').trim();
  let slug = normalizeSlug(req.body.slug);
  if (!slug) slug = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const tenantId = crypto.randomUUID();

  const featureFlags = normalizeIncomingFeatureFlags(req.body.featureFlags || req.body);

  await Tenant.create({
    tenantId,
    slug,
    displayName: displayName || slug,
    status: 'pending',
    featureFlags: {
      core: true,
      config_admin: true,
      personal: true,
      asistencia: true,
      incidencias: true,
      prenomina: true,
      nomina: false,
      gestion_documental: false,
      integraciones: true,
      reportes: true,
      ...featureFlags
    }
  });

  res.redirect('/admin/tenants');
});

app.get('/admin/tenants/:tenantId', adminAccessControl, async (req, res) => {
  const tenant = await Tenant.findOne({ tenantId: req.params.tenantId }).lean();
  if (!tenant) return res.status(404).send('Tenant no encontrado');
  const flags = mergeFeatureFlagsForDisplay(tenant.featureFlags);
  res.render('tenants/show', { tenant, flags, featureFlags: FEATURE_FLAG_KEYS, tenantLoginUrl, message: req.query.msg });
});

app.post('/admin/tenants/:tenantId/activate', adminAccessControl, async (req, res) => {
  const tenant = await Tenant.findOne({ tenantId: req.params.tenantId });
  if (!tenant) return res.status(404).send('Tenant no encontrado');

  tenant.status = 'active';
  tenant.billingStatus = 'active';
  await tenant.save();

  await provisionEmpresaYSubsidiaria(tenant.toObject(), {
    codigo: String(req.body.codigo || 'MAIN').trim() || 'MAIN'
  });

  const owner = await provisionTenantOwnerUser(tenant.toObject(), {
    ownerEmail: req.body.ownerEmail
  });

  const msg = owner.ok
    ? `Activado. Usuario: ${owner.email} / ${owner.temporaryPassword}`
    : `Activado. Owner: ${owner.reason || owner.skipped}`;

  res.redirect(`/admin/tenants/${tenant.tenantId}?msg=${encodeURIComponent(msg)}`);
});

app.post('/admin/tenants/:tenantId/provision-owner', adminAccessControl, async (req, res) => {
  const tenant = await Tenant.findOne({ tenantId: req.params.tenantId }).lean();
  if (!tenant) return res.status(404).send('Tenant no encontrado');

  const owner = await provisionTenantOwnerUser(tenant, {
    ownerEmail: req.body.ownerEmail
  });

  const msg = owner.ok
    ? `Usuario creado: ${owner.email} / ${owner.temporaryPassword}`
    : owner.reason === 'ALREADY_HAS_USERS'
      ? 'Este tenant ya tiene usuarios. Créalos desde Configuración en la app SaaS.'
      : owner.reason === 'ROLE_NOT_FOUND'
        ? `Rol no encontrado. Ejecuta: cd services/base-saas && npm run seed`
        : `No se pudo crear usuario: ${owner.reason || owner.skipped}`;

  res.redirect(`/admin/tenants/${tenant.tenantId}?msg=${encodeURIComponent(msg)}`);
});

app.post('/admin/tenants/:tenantId/suspend', adminAccessControl, async (req, res) => {
  await Tenant.updateOne({ tenantId: req.params.tenantId }, { $set: { status: 'suspended' } });
  res.redirect(`/admin/tenants/${req.params.tenantId}`);
});

app.post('/admin/tenants/:tenantId/feature-flags', adminAccessControl, async (req, res) => {
  const flags = parseFeatureFlagsFromForm(req.body);
  await Tenant.updateOne({ tenantId: req.params.tenantId }, { $set: { featureFlags: flags } });
  res.redirect(`/admin/tenants/${req.params.tenantId}?msg=${encodeURIComponent('Módulos guardados correctamente')}`);
});

app.get('/admin/menus', adminAccessControl, async (_req, res) => {
  const menus = await Menu.find().sort({ orden: 1, menuPrincipal: 1 }).lean();
  res.render('menus/index', { menus });
});

app.get('/admin/menus/new', adminAccessControl, (_req, res) => {
  res.render('menus/new', { featureFlags: FEATURE_FLAG_KEYS });
});

app.post('/admin/menus', adminAccessControl, async (req, res) => {
  await Menu.create({
    menuPrincipal: req.body.menuPrincipal,
    rutaApp: req.body.rutaApp || req.body.rutaMenu,
    rutaMenu: req.body.rutaMenu,
    icono: req.body.icono,
    orden: Number(req.body.orden || 0),
    esCategoria: req.body.esCategoria === 'on',
    activo: req.body.activo !== 'off',
    requiredFeatureKeys: String(req.body.requiredFeatureKeys || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  });
  res.redirect('/admin/menus');
});

// --- Scripts JS de fórmula (plataforma) ---
const NAME_RE = /^[a-z][a-zA-Z0-9_]*$/;

function parseArgsList(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);
}

function assertJsArgs(args) {
  for (const a of args) {
    if (!NAME_RE.test(a)) throw new Error(`Argumento inválido: ${a}`);
  }
}

async function formulaHelperForViews() {
  try {
    return await loadFormulaHelperCatalog(mongoose.connection);
  } catch (err) {
    console.warn('[formula-helper]', err.message);
    return {
      argsComunes: [],
      helpersSandbox: [],
      contextVars: [],
      parametros: [],
      funciones: [],
      notaJs: 'No se pudo cargar el catálogo de ayuda.'
    };
  }
}

app.get('/admin/formula-scripts', adminAccessControl, async (_req, res) => {
  const scripts = await FormulaFunction.find({ tipo: 'javascript', esSistema: { $ne: true } })
    .sort({ name: 1 })
    .lean();
  res.render('formula-scripts/index', { scripts });
});

app.get('/admin/formula-scripts/new', adminAccessControl, async (_req, res) => {
  res.render('formula-scripts/edit', {
    fn: null,
    values: {},
    message: '',
    helper: await formulaHelperForViews()
  });
});

app.post('/admin/formula-scripts', adminAccessControl, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!NAME_RE.test(name)) throw new Error('Nombre inválido (camelCase, empieza en minúscula)');
    const nameKey = name.toLowerCase();
    const args = parseArgsList(req.body.args);
    assertJsArgs(args);
    const cuerpo = String(req.body.cuerpo || '').trim();
    validateJavascriptCuerpo(cuerpo, args);
    const exists = await FormulaFunction.findOne({ nameKey, tenantId: null }).lean();
    if (exists) throw new Error(`Ya existe la función "${exists.name}"`);
    const publicar = req.body.accion === 'publicar';
    const signature =
      String(req.body.signature || '').trim() || `${name}(${args.join(', ')})`;
    const doc = await FormulaFunction.create({
      name,
      nameKey,
      signature,
      descripcion: String(req.body.descripcion || '').trim(),
      ejemplo: String(req.body.ejemplo || '').trim(),
      tipo: 'javascript',
      args,
      cuerpo,
      cuerpoPublicado: publicar ? cuerpo : '',
      estado: publicar ? 'publicado' : 'borrador',
      esSistema: false,
      activo: true,
      version: 1,
      tenantId: null
    });
    res.redirect(`/admin/formula-scripts/${doc._id}?msg=${encodeURIComponent(publicar ? 'Publicado' : 'Borrador creado')}`);
  } catch (err) {
    res.status(400).render('formula-scripts/edit', {
      fn: null,
      values: req.body,
      message: err.message || 'Error al crear',
      helper: await formulaHelperForViews()
    });
  }
});

app.post('/admin/formula-scripts/validate', adminAccessControl, async (req, res) => {
  try {
    const args = parseArgsList(req.body.args);
    assertJsArgs(args);
    validateJavascriptCuerpo(String(req.body.cuerpo || ''), args);
    res.json({ ok: true, args });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Inválido' });
  }
});

app.post('/admin/formula-scripts/test', adminAccessControl, async (req, res) => {
  try {
    const args = parseArgsList(req.body.args);
    assertJsArgs(args);
    const cuerpo = String(req.body.cuerpo || '');
    validateJavascriptCuerpo(cuerpo, args);
    const valsRaw = Array.isArray(req.body.valores) ? req.body.valores : parseArgsList(req.body.valores);
    const argValues = args.map((_, i) => {
      const n = Number(valsRaw[i]);
      return Number.isFinite(n) ? n : 0;
    });
    const resultado = evaluateJavascriptCuerpo(cuerpo, args, argValues);
    if (req.body.id) {
      await FormulaFunction.updateOne(
        { _id: req.body.id },
        {
          $set: {
            ultimaPrueba: { ok: true, resultado, mensaje: 'OK', at: new Date() }
          }
        }
      );
    }
    res.json({ ok: true, resultado, args, valores: argValues });
  } catch (err) {
    if (req.body?.id) {
      await FormulaFunction.updateOne(
        { _id: req.body.id },
        {
          $set: {
            ultimaPrueba: {
              ok: false,
              resultado: null,
              mensaje: err.message || 'Error',
              at: new Date()
            }
          }
        }
      ).catch(() => {});
    }
    res.status(400).json({ error: err.message || 'Error al probar' });
  }
});

app.get('/admin/formula-scripts/:id', adminAccessControl, async (req, res) => {
  const fn = await FormulaFunction.findById(req.params.id).lean();
  if (!fn || fn.tipo !== 'javascript') return res.status(404).send('Script no encontrado');
  res.render('formula-scripts/edit', {
    fn,
    values: {},
    message: req.query.msg ? String(req.query.msg) : '',
    helper: await formulaHelperForViews()
  });
});

app.post('/admin/formula-scripts/:id', adminAccessControl, async (req, res) => {
  try {
    const doc = await FormulaFunction.findById(req.params.id);
    if (!doc || doc.tipo !== 'javascript') return res.status(404).send('Script no encontrado');
    const args = parseArgsList(req.body.args);
    assertJsArgs(args);
    const cuerpo = String(req.body.cuerpo || '').trim();
    validateJavascriptCuerpo(cuerpo, args);
    const publicadoAnterior = doc.cuerpoPublicado || '';
    doc.args = args;
    doc.cuerpo = cuerpo;
    doc.descripcion = String(req.body.descripcion || '').trim();
    doc.ejemplo = String(req.body.ejemplo || '').trim();
    doc.signature =
      String(req.body.signature || '').trim() || `${doc.name}(${args.join(', ')})`;

    if (req.body.accion === 'publicar') {
      doc.cuerpoPublicado = cuerpo;
      doc.estado = 'publicado';
      doc.activo = true;
      doc.version = (Number(doc.version) || 1) + 1;
      await doc.save();
      return res.redirect(
        `/admin/formula-scripts/${doc._id}?msg=${encodeURIComponent('Publicado v' + doc.version)}`
      );
    }

    if (doc.estado === 'publicado' && cuerpo !== publicadoAnterior) {
      doc.estado = 'borrador';
    }
    await doc.save();
    res.redirect(`/admin/formula-scripts/${doc._id}?msg=${encodeURIComponent('Borrador guardado')}`);
  } catch (err) {
    const fn = await FormulaFunction.findById(req.params.id).lean();
    res.status(400).render('formula-scripts/edit', {
      fn,
      values: req.body,
      message: err.message || 'Error al guardar',
      helper: await formulaHelperForViews()
    });
  }
});

app.post('/admin/formula-scripts/:id/toggle', adminAccessControl, async (req, res) => {
  const doc = await FormulaFunction.findById(req.params.id);
  if (!doc || doc.tipo !== 'javascript') return res.status(404).send('No encontrado');
  doc.activo = !doc.activo;
  await doc.save();
  res.redirect('/admin/formula-scripts');
});

// --- API interna ---
app.use('/api/admin', internalApiAuth, apiLimiter);

app.get('/api/admin/tenants', async (_req, res) => {
  const tenants = await Tenant.find().lean();
  res.json({ success: true, tenants });
});

app.post('/api/admin/tenants', async (req, res) => {
  const displayName = String(req.body.displayName || '').trim();
  let slug = normalizeSlug(req.body.slug);
  if (!slug) slug = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const tenantId = crypto.randomUUID();
  const tenant = await Tenant.create({
    tenantId,
    slug,
    displayName: displayName || slug,
    status: 'pending',
    featureFlags: { core: true, config_admin: true, ...normalizeIncomingFeatureFlags(req.body.featureFlags || {}) }
  });
  res.status(201).json({ success: true, tenant });
});

app.get('/api/admin/tenants/:tenantId', async (req, res) => {
  const tenant = await Tenant.findOne({ tenantId: req.params.tenantId }).lean();
  if (!tenant) return res.status(404).json({ success: false });
  res.json({ success: true, tenant });
});

app.post('/api/admin/tenants/:tenantId/activate', async (req, res) => {
  const tenant = await Tenant.findOne({ tenantId: req.params.tenantId });
  if (!tenant) return res.status(404).json({ success: false });

  tenant.status = 'active';
  tenant.billingStatus = 'active';
  await tenant.save();

  const org = await provisionEmpresaYSubsidiaria(tenant.toObject(), req.body || {});
  const owner = await provisionTenantOwnerUser(tenant.toObject(), req.body || {});

  res.json({ success: true, tenant, org, owner });
});

app.get('/api/admin/menus', async (_req, res) => {
  const menus = await Menu.find({ activo: true }).sort({ orden: 1 }).lean();
  res.json({ success: true, menus });
});

app.get('/api/admin/plans', async (_req, res) => {
  const plans = await Plan.find({ activo: true }).lean();
  res.json({ success: true, plans });
});

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log(`[arka-presence-admin] Mongo conectado: ${MONGO_URI}`);
    app.listen(PORT, () => console.log(`[arka-presence-admin] http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('[arka-presence-admin] Error Mongo:', err);
    process.exit(1);
  });

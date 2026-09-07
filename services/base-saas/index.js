const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const bodyParser = require('body-parser');

const resolveTenant = require('./middleware/resolveTenant');
const { isSoloPortalUser } = require('./libs/roleAccess');
const authRoutes = require('./controllers/AuthController');
const appRoutes = require('./routers/route');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

function getSessionSecret() {
  const s = String(process.env.BASE_SESSION_SECRET || process.env.ARKA_SESSION_SECRET || '').trim();
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('BASE_SESSION_SECRET requerido en producción');
  return 'dev-only-session-secret';
}

app.use(
  session({
    key: 'user_sid',
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30,
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);
app.use(flash());
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.isSoloPortalUser = isSoloPortalUser(req.session);
  next();
});
app.use(resolveTenant);

app.get('/health', (_req, res) => res.json({ ok: true, service: 'arka-presence-saas' }));

app.use('/api/v1', require('./routers/mobileApi'));

app.use(authRoutes);
app.use(appRoutes);

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`[arka-presence-saas] http://localhost:${PORT}`);
  const { iniciarWorkerNomina } = require('./services/nomina/nominaCalculoJobService');
  iniciarWorkerNomina();
});

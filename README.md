# Arka-Presence

Plataforma multi-tenant para control de presencia y asistencia. Construida sobre el esqueleto SaaS de **arka-platform**.

Patrón heredado de arka-platform
Concepto	Colección	Notas
Tenant		tenants        slug, status, featureFlags
Empresa		empresas	1 por tenant
Subsidiaria	subsidiarias	sucursales con codigo único (genérico, sin RFC)
Usuarios	saas_users	tenantId, roles, sesión única
Roles		saas_roles	permisos genéricos
Menús		mainmenu	jerárquico, filtrado por rol y módulos


## Qué incluye

| Capa | Servicio (carpeta) | Puerto dev | Rol |
|------|-------------------|------------|-----|
| Control plane | `base-admin` (`arka-presence-admin`) | 4004 | Tenants, planes, menús globales, API interna |
| App tenant | `base-saas` (`arka-presence-saas`) | 4003 | Login, sesión, usuarios, roles, subsidiarias, menú dinámico |

### Modelo de datos (BD `config`)

- **tenants** — organización cliente (slug, status, featureFlags)
- **tenantDomains** — dominios personalizados por tenant
- **empresas** — 1 empresa padre por tenant
- **subsidiarias** — sucursales / ubicaciones (código único)
- **saas_users** — usuarios con `tenantId`, roles y acceso por subsidiaria
- **saas_roles** — permisos genéricos (admin, config, reportes…)
- **mainmenu** — menú jerárquico filtrado por rol y feature flags

## Inicio rápido

```bash
# 1. Copiar variables de entorno
cp .env.example .env
cp services/base-admin/.env.example services/base-admin/.env
cp services/base-saas/.env.example services/base-saas/.env

# 2. Levantar con Docker
docker compose -f docker-compose.dev.yml up --build

# 3. Sembrar roles y menús (en otra terminal)
cd services/base-saas && npm install && npm run seed

# 4. (Opcional) Arquitectura nómina: enums + catálogo SUELDO/HE
npm run seed:nomina-arquitectura -- --tenant=empresa-demo
```

- Admin UI: http://localhost:4004/admin (Basic Auth — ver `.env`)
- App Arka-Presence: http://localhost:4003/auth-login?account=demo
- Enums sistema: `/config-sistema/enums` · Conceptos: `/nomina/conceptos` · Doc: `docs/arquitectura-motor-nomina.md`

## Flujo típico

1. Crear tenant en **Arka-Presence Admin** (`/admin/tenants/new`)
2. Activar tenant → provisiona empresa, subsidiaria demo y usuario owner
3. Usuario entra a la app con `?account=<slug>`
4. Gestiona usuarios, roles y subsidiarias desde Configuración

## Extender módulos de negocio

1. Añade feature flags en `services/base-admin/lib/featureFlagsCatalog.js` (ej. `presencia`, `reportes_rrhh`)
2. Registra ítems de menú en `services/base-saas/scripts/seed.js` apuntando a tus rutas
3. Crea modelos de negocio en una BD aparte o en la misma `config` según escala
4. Mantén **admin** para operaciones de plataforma y **saas** para la app del cliente

## Relación con arka-platform

Este proyecto usa el **esqueleto multi-tenant** de arka-platform (tenants, subsidiarias, usuarios, roles, menús, admin/saas) como base para Arka-Presence. Cuando arka-platform evolucione el núcleo, puedes portar mejoras puntuales desde allí.

## Variables clave

| Variable | Servicio | Descripción |
|----------|----------|-------------|
| `MONGO_URI` | ambos | `mongodb://host:27020/config` |
| `BASE_INTERNAL_API_KEY` | ambos | Clave compartida API interna |
| `BASE_SESSION_SECRET` | saas | Secreto de sesión |
| `BASE_ADMIN_AUTH_USER/PASSWORD` | admin | Basic Auth UI |
| `BASE_ADMIN_ALLOWED_IPS` | admin | Whitelist IP |

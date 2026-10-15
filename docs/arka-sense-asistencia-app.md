# ArkaSense Asistencia — funcionalidades y mejoras

Documento de producto/técnico de la app móvil Flutter (`apps/arka_sense_asistencia`) y de la API móvil en `base-saas` (`/api/v1`).

Última actualización relevante: commit `feat(arka-sense): home UX, recordatorios, revocación por baja y sync offline`.

---

## 1. Resumen

App de checado para empleados (Android / iOS / desktop) contra PayPilot / ArkaSense SaaS:

| Área | Estado |
|------|--------|
| Login JWT por tenant + usuario vinculado a empleado | ✅ |
| Marcación Entrada → Salida con biometría + GPS | ✅ |
| Home UX (header, hero CTA, accesos, avisos, bottom nav) | ✅ |
| Recordatorios locales según turno (online + caché offline) | ✅ |
| Bandeja de notificaciones (2 meses, auto-purga) | ✅ |
| Historial con check sincronizado / pendiente | ✅ |
| Cola offline de marcaciones | ✅ |
| Revocación inmediata al dar de baja al empleado | ✅ |
| Recibos PDF/XML en app | ⏳ placeholder |
| Avisos HR 1→N desde servidor / FCM | ⏳ local + placeholders |

Docs relacionadas:

- [Biometría facial](./biometria-facial.md)
- [Geocercas / puntos de acceso](./geocercas-puntos-acceso.md)
- [Evidencia de checado](./evidencia-checado-asistencia.md)

---

## 2. UX del home (jerarquía)

Diseño operativo: **arriba lo personal/urgente → centro la acción → abajo comunicación**.

### 2.1 Encabezado

- Avatar / saludo / #empleado / turno / fecha.
- **Icono de correo** (`mail_outline`) con badge de no leídas.
- Abre el historial completo de notificaciones (2 meses).

### 2.2 Hero card de asistencia

- Semáforo **En ventana de turno** / **Fuera de ventana** (±30 min respecto a entrada/salida programada).
- CTA grande:
  - Sin entrada → **Registrar Entrada**
  - Con entrada y sin salida → **Registrar Salida**
  - Ambos → jornada completa (CTA deshabilitado)
- No obliga comida ni dropdown de tipos.
- Banner amarillo si la app detecta modo sin conexión.
- Texto de última actividad del día.

### 2.3 Accesos rápidos

- **Historial** → pestaña de marcaciones.
- **Recibos** → placeholder (bóveda PDF/XML pendiente).

### 2.4 Últimas notificaciones

- Carrusel con **solo las 2 más recientes**.
- Enlace “Ver todas” → bandeja completa.

### 2.5 Bottom nav

1. Inicio  
2. Historial  
3. Recibos  
4. Perfil  

### 2.6 Perfil (separado de “Acerca de”)

**Mi perfil**

- Nombre, #empleado, correo, empresa.

**Acerca de la app**

- Versión (`ApiConfig.appVersion` / pubspec).
- Cuenta (displayName · slug).
- URL del servidor (`API_BASE_URL`).

**Cerrar sesión** — cierra JWT de inmediato; limpia recordatorios en segundo plano (no bloquea la UI).

---

## 3. Marcación (check-in / check-out)

### Flujo online

1. Prueba de vida (cámara + reto dinámico).
2. GPS (rechaza Fake GPS / mock).
3. `POST /api/v1/asistencia/marcar` con biometría + geo + metadatos de dispositivo.
4. Validación de geocerca en servidor.
5. Notificación en bandeja: “Entrada/Salida registrada”.
6. Refresh de `/asistencia/hoy`.

### Flujo offline (cola local)

Si falla la API por red (no errores de negocio 400/409):

1. Se guarda en `PunchLocalStore` (`SharedPreferences`).
2. Aparece en historial como **Pendiente de sync**.
3. Bandeja: “guardada offline… se enviará cuando haya señal”.
4. Al refrescar inicio o historial online → `flushPending` reintenta el POST.

### Historial

- Consulta `GET /asistencia/historial?dias=60` + merge con pendientes locales.
- **✓ Sincronizado** (verde) = viene del servidor / caché sync.
- **☁ Pendiente** (naranja) = solo en el teléfono.
- Offline: muestra caché local + pendientes.

---

## 4. Notificaciones (bandeja local)

| Concepto | Detalle |
|----------|---------|
| Icono | Correo en el header |
| Retención | **60 días**; al cargar/agregar se purgan las más viejas |
| Home | Solo **últimas 2** |
| Pantalla | Lista completa, marcar leída / marcar todas |
| Persistencia | `SharedPreferences` (`aska_notif_inbox_v1`) |

Eventos que escribe la app hoy:

- Seed inicial (bienvenida / recordatorios).
- Marcación sincronizada.
- Marcación guardada offline.

Pendiente: push FCM, avisos HR 1→N desde API, alertas transaccionales (recibo listo, falta de salida, vacaciones).

---

## 5. Recordatorios de checada por turno

Servicio SaaS: `horarioRecordatorioService.js`  
App: `reminder_scheduler.dart`

### Online

Al login / abrir / pull-to-refresh:

1. `GET /api/v1/asistencia/horario?dias=7`
2. Programa notificaciones locales (entrada/salida con anticipación).
3. Guarda payload en caché.

### Offline

- Reusa caché local.
- Las alarmas ya programadas en el SO siguen disparando.

### Resolución de turno (misma lógica SaaS)

override del día → rotación → turno fijo del empleado.

### Variables de entorno (SaaS)

| Variable | Default | Uso |
|----------|---------|-----|
| `RECORDATORIO_MINUTOS_ANTES_ENTRADA` | 15 | Aviso antes de entrada |
| `RECORDATORIO_MINUTOS_ANTES_SALIDA` | 10 | Aviso antes de salida |
| `RECORDATORIO_DIAS_ADELANTE` | 7 | Horizonte a programar |

Permisos Android: notificaciones + boot (reprogramación).

---

## 6. Seguridad de sesión (baja de empleado)

Problema: el JWT móvil es de larga vida (~30d). Dar de baja al empleado bloqueaba login nuevo, pero **no** invalidaba la sesión ya abierta.

### Solución

1. Campo `User.mobileTokenVersion` (entero).
2. El JWT incluye claim `mtv`.
3. En **baja** (botón o edición a `estatus=baja`) y al **desactivar usuario**:
   - `$inc: mobileTokenVersion`
   - limpia `activeSessionToken` (sesión web)
4. `requireMobileAuth` revalida en cada request:
   - usuario activo
   - `mtv` == versión en DB
   - empleado `estatus === 'activo'`
5. Códigos: `SESSION_REVOKED`, `EMPLEADO_BAJA`, `USER_INACTIVE`, …
6. App: cualquier **401** en API autenticada → logout + mensaje en login.

Archivos clave:

- `services/base-saas/services/mobileAccessService.js`
- `services/base-saas/middleware/mobileAuth.js`
- `controllers/empleadosController.js` / `usersController.js`
- `apps/.../lib/services/auth_state.dart` + `api_client.dart`

**Nota:** no se desactiva automáticamente el `User` en la baja del empleado (permite reingreso). Solo se revoca acceso móvil/web de sesión.

---

## 7. API móvil (`/api/v1`)

Prefijo: `{API_BASE_URL}/api/v1`  
Auth: `Authorization: Bearer <jwt>`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Healthcheck |
| POST | `/auth/login` | Login (account/tenantSlug, email, password) → JWT con `mtv` |
| GET | `/me` | Perfil de sesión (revalida acceso) |
| GET | `/asistencia/hoy` | Marcaciones del día + horario/turno |
| GET | `/asistencia/horario` | Recordatorios programables (N días) |
| POST | `/asistencia/marcar` | Checado (geo + bio) |
| GET | `/asistencia/historial?dias=` | Historial (máx. 90) |
| GET/POST | `/biometrics/*` | Challenge / verify / status |

Login exige empleado `estatus: 'activo'` y usuario `activo: true` con `empleadoId`.

---

## 8. Biometría (resumen)

Ver [biometria-facial.md](./biometria-facial.md).

- Enroll en web RRHH.
- App: liveness + verify antes de marcar.
- Mejoras recientes en servicio de plantillas / auto-mejora (SaaS `biometricsService`).

---

## 9. Build y despliegue de la app

```bash
cd apps/arka_sense_asistencia
flutter pub get

# Teléfono físico (IP LAN del PC donde corre SaaS :4003)
flutter build apk --release --dart-define=API_BASE_URL=http://10.x.x.x:4003
```

Salida: `build/app/outputs/flutter-apk/app-release.apk`

| Entorno | `API_BASE_URL` |
|---------|----------------|
| Emulador Android | `http://10.0.2.2:4003` |
| Desktop / iOS sim | `http://127.0.0.1:4003` |
| Dispositivo físico | `http://<IP-LAN>:4003` (**no** `127.0.0.1`) |

Versión app: `pubspec.yaml` → `1.1.0+2` (alineada con `ApiConfig.appVersion`).

Tras cambios de middleware de revocación: **reiniciar / redeploy `base-saas`**.

---

## 10. Roadmap corto (app)

| Prioridad | Ítem |
|-----------|------|
| Alta | Bóveda de recibos (listar/descargar PDF/XML CFDI) |
| Alta | Avisos HR desde API + FCM (campanita/correo 1:1 vs carrusel 1:N) |
| Media | Reprogramar recordatorios al boot de forma más robusta |
| Media | Confirmación visual al flush de pendientes offline |
| Baja | Foto de perfil real del empleado en header |

---

## 11. Mapa de archivos

### App Flutter

| Archivo | Rol |
|---------|-----|
| `lib/screens/home_screen.dart` | Home UX + CTA + tabs |
| `lib/screens/history_screen.dart` | Historial + sync UI |
| `lib/screens/notifications_screen.dart` | Bandeja 2 meses |
| `lib/screens/login_screen.dart` | Login + mensaje de sesión revocada |
| `lib/screens/liveness_screen.dart` | Prueba de vida |
| `lib/services/auth_state.dart` | JWT / logout / revoke |
| `lib/services/api_client.dart` | HTTP + 401 → logout |
| `lib/services/reminder_scheduler.dart` | Notificaciones locales por turno |
| `lib/services/notification_inbox.dart` | Inbox persistente |
| `lib/services/punch_local_store.dart` | Cola offline + caché historial |
| `lib/config/api_config.dart` | Base URL + versión |

### SaaS

| Archivo | Rol |
|---------|-----|
| `routers/mobileApi.js` | Endpoints móvil |
| `middleware/mobileAuth.js` | JWT + revalidación |
| `services/mobileAccessService.js` | Revocación `mtv` |
| `services/horarioRecordatorioService.js` | Ventanas de recordatorio |
| `controllers/empleadosController.js` | Baja → revoke |
| `models/user.js` | `mobileTokenVersion` |

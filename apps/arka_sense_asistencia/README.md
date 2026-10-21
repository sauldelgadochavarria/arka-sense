# ArkaSense Asistencia (Flutter)

App multiplataforma de checado para empleados: **Android, iOS, Windows, macOS y Linux**.

Documentación completa de funcionalidades y mejoras:  
[`docs/arka-sense-asistencia-app.md`](../../docs/arka-sense-asistencia-app.md)

---

## Funcionalidades actuales

| Módulo | Qué hace |
|--------|----------|
| **Login** | Tenant (cuenta) + email/contraseña; JWT con versión de sesión |
| **Home** | Saludo, correo con badge, hero Entrada/Salida, accesos, últimas 2 notificaciones, bottom nav |
| **Marcación** | Liveness facial → GPS → `POST /asistencia/marcar` (geocerca en servidor) |
| **Offline** | Si no hay red, guarda la marcación local y la sincroniza después |
| **Historial** | Hasta 60 días; check **Sincronizado** / **Pendiente de sync** |
| **Notificaciones** | Bandeja local 2 meses (auto-borra lo más viejo); home solo muestra 2 |
| **Recordatorios** | Avisos locales según turno asignado (online + caché offline) |
| **Perfil** | Datos del empleado separados de versión / empresa / URL del servidor |
| **Baja RRHH** | Al dar de baja al empleado se revoca el JWT; la app cierra sesión |
| **Dispositivo** | UUID estable en cada marcación; registro SMS opcional por subsidiaria |

Pendiente en app: recibos PDF/XML, avisos HR desde API / FCM.

---

## Requisitos

- [Flutter SDK](https://docs.flutter.dev/get-started/install) 3.3+
- Backend `base-saas` corriendo (API en `/api/v1`, puerto host **4003**)
- Usuario SaaS con **`empleadoId`** vinculado
- Plantilla facial enrollada (web → Biometría facial)

---

## Configurar API

Por defecto: `lib/config/api_config.dart` o al compilar:

```bash
flutter build apk --release --dart-define=API_BASE_URL=http://TU_IP_LAN:4003
```

| Entorno | URL |
|---------|-----|
| Emulador Android | `http://10.0.2.2:4003` |
| Desktop / iOS sim | `http://127.0.0.1:4003` |
| Teléfono físico | `http://<IP-LAN-del-PC>:4003` (no uses `127.0.0.1`) |

IP LAN actual de desarrollo (Wi‑Fi): **`192.168.1.11`** — si cambia la red, actualiza `ApiConfig` o el `--dart-define`.

### Probar en iPhone

En este PC (Windows) **no se puede generar IPA**; hace falta un Mac con Xcode:

```bash
cd apps/arka_sense_asistencia
flutter pub get
flutter run -d <udid-iphone> --dart-define=API_BASE_URL=http://192.168.1.11:4003
# o
flutter build ipa --dart-define=API_BASE_URL=http://192.168.1.11:4003
```

El iPhone y el PC deben estar en la **misma Wi‑Fi**. En Safari del iPhone puedes verificar: `http://192.168.1.11:4003/api/v1/health` → `{"ok":true,...}`.

---

## Login

1. **Cuenta** = slug del tenant (ej. `empresa-demo`)
2. **Email / contraseña** del usuario vinculado a un empleado activo

Si RRHH da de baja al empleado (o desactiva el usuario), el siguiente request autenticado cierra la sesión en el teléfono.

---

## Flujo de marcación

1. CTA **Registrar Entrada** o **Registrar Salida** (según el día)
2. Prueba de vida (reto dinámico + cámara, máx. 3 intentos)
3. GPS (sin Fake GPS)
4. `POST /asistencia/marcar` — o cola local si no hay red

---

## Recordatorios de checada (turno asignado)

- **Online:** al login / refrescar, `GET /api/v1/asistencia/horario` programa notificaciones locales.
- **Offline:** reusa caché; las alarmas del SO siguen disparando.
- Turno: override → rotación → turno fijo (misma lógica SaaS).

Variables SaaS: `RECORDATORIO_MINUTOS_ANTES_ENTRADA` (15), `RECORDATORIO_MINUTOS_ANTES_SALIDA` (10), `RECORDATORIO_DIAS_ADELANTE` (7).

---

## API biométrica

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/biometrics/challenge` | Reto temporal (~45s) |
| POST | `/api/v1/biometrics/verify` | multipart `frame_neutral` + `frame_action` |
| GET | `/api/v1/biometrics/status` | ¿Tiene plantilla facial? |

Detalle: [`docs/biometria-facial.md`](../../docs/biometria-facial.md).  
Enroll RRHH: `/personal-empleados/:id/biometria-facial`

---

## Ejecutar / APK

```bash
cd apps/arka_sense_asistencia
flutter pub get
flutter run -d windows

flutter build apk --release --dart-define=API_BASE_URL=http://10.x.x.x:4003
# → build/app/outputs/flutter-apk/app-release.apk
```

Versión actual: **1.1.0** (`pubspec.yaml`).

---

## Permisos

- Cámara (prueba de vida)
- Ubicación (marcación GPS)
- Notificaciones (recordatorios de turno)

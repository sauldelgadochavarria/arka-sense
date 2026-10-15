# ArkaSense Asistencia (Flutter)

App multiplataforma de checado para empleados: **Android, iOS, Windows, macOS y Linux**.

## Requisitos

- [Flutter SDK](https://docs.flutter.dev/get-started/install) 3.3+
- Backend `base-saas` corriendo (API en `/api/v1`, puerto host **4003**)
- Usuario SaaS con **`empleadoId`** vinculado
- Plantilla facial enrollada en la ficha del empleado (web → Biometría facial)

## Configurar API

Edita `lib/config/api_config.dart` (Windows/desktop: `http://127.0.0.1:4003`).

## Login

1. **Cuenta** = slug del tenant (ej. `empresa-demo`)
2. **Email / contraseña** del usuario vinculado a un empleado

## Flujo de marcación

1. Prueba de vida (reto dinámico + cámara frontal, máx. 3 intentos)
2. GPS
3. `POST /asistencia/marcar`

## Recordatorios de checada (turno asignado)

- **Online:** al login / al abrir o refrescar inicio, la app llama `GET /api/v1/asistencia/horario` y programa notificaciones locales de entrada/salida (minutos antes configurables en servidor).
- **Offline:** si no hay red, reusa la última descarga en caché (`SharedPreferences`) y las alarmas ya programadas en el SO siguen disparando.
- Resuelve turno con la misma lógica del SaaS: override → rotación → turno fijo del empleado.
- Variables de entorno SaaS: `RECORDATORIO_MINUTOS_ANTES_ENTRADA` (15), `RECORDATORIO_MINUTOS_ANTES_SALIDA` (10), `RECORDATORIO_DIAS_ADELANTE` (7).

## API biométrica

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/biometrics/challenge` | Reto temporal (~45s) |
| POST | `/api/v1/biometrics/verify` | multipart `frame_neutral` + `frame_action` |
| GET | `/api/v1/biometrics/status` | ¿Tiene plantilla facial? |

Alias sin `v1`: `/api/biometrics/*`.

Enroll (RRHH, sesión web): `/personal-empleados/:id/biometria-facial`

## Ejecutar

```bash
cd apps/arka_sense_asistencia
flutter pub get
flutter run -d windows
```

## Permisos

- Cámara (prueba de vida)
- Ubicación (marcación GPS)

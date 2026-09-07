# ArkaSense Asistencia (Flutter)

App multiplataforma de checado para empleados: **Android, iOS, Windows, macOS y Linux**.

## Requisitos

- [Flutter SDK](https://docs.flutter.dev/get-started/install) 3.3+
- Backend `base-saas` corriendo (API en `/api/v1`, puerto host **4003**)
- Usuario SaaS con **`empleadoId`** vinculado (cuenta portal empleado)

## Configurar API

Edita `lib/config/api_config.dart`:

```dart
// Emulador Android → host machine
static const String baseUrl = 'http://10.0.2.2:4003';

// iOS simulador / desktop
// static const String baseUrl = 'http://127.0.0.1:4003';

// Dispositivo físico (misma LAN)
// static const String baseUrl = 'http://192.168.x.x:4003';
```

## Ejecutar

```bash
cd apps/arka_sense_asistencia
flutter pub get
flutter run -d windows   # o chrome, linux, macos, android, ios
```

Primera vez en un repo sin carpetas de plataforma:

```bash
flutter create . --project-name arka_sense_asistencia --org com.arkasense
flutter pub get
```

## Login

1. **Cuenta** = slug del tenant (ej. `demo`)
2. **Email / contraseña** del usuario vinculado a un empleado

## API consumida

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | JWT |
| GET | `/api/v1/me` | Perfil |
| GET | `/api/v1/asistencia/hoy` | Estado del día + sugerencia |
| POST | `/api/v1/asistencia/marcar` | Punch + GPS |
| GET | `/api/v1/asistencia/historial` | Últimos N días |

Header: `Authorization: Bearer <token>` y, en login, body `account`.

## Permisos de ubicación

- **Android:** `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` (añadidos al crear el proyecto; revisa `android/app/src/main/AndroidManifest.xml`)
- **iOS:** `NSLocationWhenInUseUsageDescription` en `Info.plist`
- **Desktop:** el plugin `geolocator` usa la API del SO; en Linux puede requerir paquetes del sistema

## Build de release (descargas del sitio)

```bash
flutter build apk --release          # → build/app/outputs/flutter-apk/app-release.apk
flutter build ipa                    # iOS (Mac + Xcode)
flutter build windows --release
flutter build macos --release
flutter build linux --release
```

Copia los artefactos a `website/downloads/` con los nombres del README web.

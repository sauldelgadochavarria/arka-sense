# Descargas ArkaSense — apps de asistencia

Copia los artefactos compilados desde Flutter:

| Archivo destino | Origen típico |
|-----------------|---------------|
| `arka-sense-android.apk` | `apps/arka_sense_asistencia/build/app/outputs/flutter-apk/app-release.apk` |
| `arka-sense-ios.ipa` | build IPA / TestFlight |
| `arka-sense-windows.exe` | `build/windows/x64/runner/Release/` (empaquetar instalador) |
| `arka-sense-macos.dmg` | build macOS Release |
| *(opcional)* Linux | `build/linux/x64/release/bundle/` |

Código fuente de la app: `apps/arka_sense_asistencia/` (Flutter). API: `POST /api/v1/asistencia/marcar` en base-saas.


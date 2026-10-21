# Push FCM (vacaciones)

## Backend

1. Variable de entorno en `base-saas`:

```bash
FCM_SERVER_KEY=AAAA...   # Server key de Firebase Cloud Messaging (API legacy)
# FCM_ENABLED=false      # fuerza solo log en consola
```

2. App registra token:

`POST /api/v1/push/register`  
`{ "token": "<fcmToken>", "plataforma": "android", "deviceUuid": "..." }`

3. Al solicitar / resolver vacaciones se envía push al supervisor o al empleado.

Sin `FCM_SERVER_KEY` el envío queda en log `[push:console]` (útil en desarrollo).

## Flutter (siguiente paso con proyecto Firebase)

1. Crear app Android/iOS en Firebase Console.
2. Descargar `google-services.json` → `apps/arka_sense_asistencia/android/app/`.
3. Añadir `firebase_core` + `firebase_messaging` y tras login:

```dart
await auth.api.post('/push/register', {
  'token': await FirebaseMessaging.instance.getToken(),
  'plataforma': Platform.isIOS ? 'ios' : 'android',
  'deviceUuid': uuid,
});
```

Hasta entonces la app ya consulta/aprueba vacaciones por API; el push llega cuando configures Firebase.

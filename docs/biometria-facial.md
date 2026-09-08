# Biometría facial (liveness + 1:1)

## Flujo

1. **RRHH** enrolla el rostro en `GET /personal-empleados/:id/biometria-facial` (cámara web → embedding FaceNet 128-d).
2. **App** pide `GET /api/v1/biometrics/challenge` (reto ~45s).
3. Captura `frame_neutral` + `frame_action` y envía `POST /api/v1/biometrics/verify` (multipart).
4. Backend: anti-replay del reto → liveness (expresión + landmarks) → distancia euclidiana ≤ 0.45.

## Stack

- `@vladmandic/face-api` + `@tensorflow/tfjs-node` (Docker bookworm)
- Modelos: `npm run biometrics:models` → `vendor/face-api-models/`
- Retos en memoria (TTL); en multi-instancia usar Redis

## Variables

| Variable | Default | Uso |
|----------|---------|-----|
| `BIOMETRICS_CHALLENGE_TTL_MS` | 45000 | Vigencia del reto |
| `BIOMETRICS_MATCH_THRESHOLD` | 0.45 | Distancia máx. 1:1 |
| `BIOMETRICS_NEUTRAL_MIN` | 0.55 | Score expresión neutra |
| `BIOMETRICS_HAPPY_MIN` | 0.55 | Score sonrisa |

## Alias

`/api/biometrics/*` ≡ `/api/v1/biometrics/*`

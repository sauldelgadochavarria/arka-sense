# Evidencia de checado (FT / REJL)

## Principio

Cada intento de la app (biometría, geocerca, marcación) se guarda en **`attendance_attempts`** de forma **append-only**.  
La marcación efectiva vive en **`attendance_records`** y puede anularse/ajustarse con motivo; **no se borra**.

## Dónde verlo (web)

| Pantalla | Ruta |
|----------|------|
| Marcaciones del día | `/asistencia-marcaciones?fecha=YYYY-MM-DD` |
| Detalle (geo, bio, timeline) | `/asistencia-marcaciones/:id` |
| Intentos / rechazos | `/asistencia-intentos?fecha=…&empleadoId=…` |

## Resultados de intento

| Resultado | Significado |
|-----------|-------------|
| `aceptado` | OK (bio o punch dentro de zona) |
| `aceptado_con_observacion` | Punch permitido con bandera (p. ej. fuera de zona + `open_with_flag`) |
| `rechazado` | No genera marcación (bio fail, geo block, fake GPS, duplicado) |
| `error` | Falla técnica |

## Qué se persiste en la marcación móvil

Además de GPS/geocerca/dispositivo:

```json
"biometria": {
  "ok": true,
  "score": 0.41,
  "challengeId": "…",
  "verifiedAt": "…"
},
"attemptId": "…"
```

## Nota legal (orientación)

Para la reforma de jornada / control de asistencia (horizonte 2027): conservar **historial de intentos y de modificaciones** (quién, cuándo, motivo, antes/después).  
Esta fase cubre evidencia operativa; export STPS / sellado criptográfico quedan para REJL fase 2.

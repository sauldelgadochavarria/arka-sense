# Vacaciones, recibos y módulos por subsidiaria

## Licencia (Admin → Tenant)

Flags nuevos/ajustados:

- `vacaciones` — solicitudes LFT, portal y aprobación. Flag propio: no se enciende solo con Incidencias.
- `recibos` — consulta de recibos en portal y app. Flag propio: no se enciende solo con Nómina.
- `asistencia`, `incidencias`, `nomina` — existentes

Si el flag está ausente o en false, el módulo queda apagado en todas las subsidiarias y en la app.

## Subsidiaria (Arka Sense → Config → Editar)

Checkboxes **Módulos en esta subsidiaria**:

- Asistencia
- Recibos
- Vacaciones

Regla: `efectivo = tenant ON ∧ subsidiaria ON`. Si el tenant apaga Vacaciones o Recibos, el checkbox de cada subsidiaria queda desmarcado y bloqueado, y la app no muestra esas pestañas.

## Portal empleado

| Ruta | Uso |
|------|-----|
| `/portal/vacaciones` | Saldo, solicitar, historial, cancelar |
| `/portal/aprobaciones-vacaciones` | Supervisor: aprobar / rechazar |
| `/portal/recibos` | Histórico de nómina |
| `/portal/vacaciones/preview-dias` | JSON días laborables del rango |

## RRHH

- `/incidencias/vacaciones` — saldos (incluye días reservados)
- `/incidencias/dias-inhabiles` — calendario para no descontar festivos

## Estados `VacacionSolicitud`

`PENDING` (congela saldo) → `APPROVED` | `REJECTED` | `CANCELLED`

Al aprobar: crea incidencia `VAC` y el motor de asistencia marca el día como `vacaciones` (no falta).

## Notificaciones

Stub en consola (`vacacionNotificacionService`). Cablear correo/FCM después.

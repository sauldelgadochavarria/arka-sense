# Calendario flexible: asistencia y nómina

## Tres relojes (no confundir)

| Reloj | Qué define | Dónde vive |
|---|---|---|
| **Ventana del período** | Días que entran a pre-nómina / nómina / asistencia del período | `fechaInicio` – `fechaFin` en `payroll_periods` / `nomina_periodos` |
| **Semana laboral LFT** | Tope 46 h ordinarias y cupo HE dobles/semana | `diaInicioSemana` del **tipo de período** del empleado → `weekKey(..., { weekStartsOn })` |
| **Día / fecha de pago** | Cuándo dispersan / muestran en CFDI | `diaPago` + `offsetPagoDias` en el tipo → `fechaPago` en el período |

El **tipo de motor** (semanal, quincenal…) sigue siendo la **familia fiscal** (tablas ISR). No implica “siempre lun–dom” ni “siempre 1–15”.

## Configuración en el tipo de período

Ruta: `/prenomina/tipos-periodo/:id/edit` → sección **Calendario y pago**.

- **Modo calendario**
  - `calendario_fijo`: rangos clásicos (quincena 1–15 / 16–fin; semana según día de inicio).
  - `por_dias`: N días consecutivos desde la ancla (`diasPeriodo` + fecha inicial al generar el año).
- **Día de inicio de semana / período** (`diaInicioSemana`, 0=dom … 6=sáb, default lunes).
- **Día de pago preferido** + **offset tras el cierre** → sugieren `fechaPago` al generar/crear períodos. **No** cambian días pagados ni ISR.

## Ejemplo: semana mar → lun, pagan viernes

1. Tipo motor: `semanal`.
2. Días del período: `7`.
3. Modo: `por_dias` (o semanal con día inicio = martes).
4. Día de inicio: **Martes**.
5. Día de pago: **Viernes**, offset `0` (o el que use la empresa).
6. Al **generar períodos del año**, la fecha inicial debe ser un martes (o el sistema alinea al martes de esa semana).

Resultado:

- Cada período cubre martes–lunes.
- Registro de jornada / HE acumulan la semana mar–lun (no lun–dom).
- `fechaPago` cae en el viernes siguiente al cierre (según offset).

## Código clave

- Política: [`services/base-saas/libs/calendarioPeriodo.js`](../services/base-saas/libs/calendarioPeriodo.js)
- Rangos: [`services/base-saas/libs/payrollPeriodDates.js`](../services/base-saas/libs/payrollPeriodDates.js)
- Generación anual: [`services/base-saas/libs/generarPeriodosAnio.js`](../services/base-saas/libs/generarPeriodosAnio.js)
- Semana LFT: [`services/base-saas/libs/horasExtraClasificacion.js`](../services/base-saas/libs/horasExtraClasificacion.js) (`weekKey`)
- Uso asistencia: [`services/base-saas/services/registroJornadaService.js`](../services/base-saas/services/registroJornadaService.js)

## Fuera de alcance (por ahora)

- Quincenas arbitrarias por día del mes (ej. 3–17).
- Calendario distinto por subsidiaria sin un tipo de período propio (usar un tipo por política).

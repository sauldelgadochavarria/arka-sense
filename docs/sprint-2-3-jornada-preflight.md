# Sprint 2 y 3 — Topes de jornada, preflight y reclasificación HE

Complementa `docs/esquema-jornada-valor-hora.md` (Sprint 1).

## Sprint 2 — Visibilidad y preflight

### Registro de jornada
Ruta: `/asistencia-registro-jornada`

- Semáforo **ordinarias vs tope del turno** (default 46 h/semana): OK / Cerca (≥95%) / Excede.
- Bandera **día > 12 h** (Art. 68) por fila y en acumulado.
- Cards resumen: semanas >46, días >12, empleados sin turno.

### Diario
`daily_attendance.excedeLimiteDiario` se calcula al reprocesar asistencia  
`(horasJornada + HE) > maxHorasTotalesDia`.

### Preflight cierre pre-nómina
`validatePeriodClose` (= código externo + jornada):

| Código | Tipo | Efecto |
|--------|------|--------|
| `MISSING_CODIGO_EXTERNO` | bloqueo | No cierra (422) |
| `TURNO_SUPERA_12H` | bloqueo | Turnos legacy con jornada >12 |
| `HE_DOBLES_INCONSISTENTES` | bloqueo | Cubetas HE absurdas |
| `EXCEDE_12H_DIA` / `EMPLEADOS_SIN_TURNO` | advertencia | Informa, no bloquea solo |

UI: `/prenomina-periodos/:id` muestra bloqueos y advertencias.

Nómina formal reutiliza las mismas reglas si hay `payrollPeriodId` vinculado.

## Sprint 3 — Evidencia y disclaimer

### Marcación manual
- Por defecto **hora del servidor**.
- Hora distinta exige **motivo**.
- Siempre se guarda `servidorRegisteredAt`.
- Móvil también graba `servidorRegisteredAt`.

### Reclasificar HE → bono / otro concepto
En el ajuste de pre-nómina:

1. Marca «Reclasificar HE (quita P002)».
2. Acepta el **disclaimer legal** (obligatorio → si no, error `DISCLAIMER_HE_REQUERIDO` / 422).
3. Quita percepción P002 y minutos HE; agrega el concepto nuevo.
4. Bitácora `RECLASIFICAR_HE_BONO` en `asistencia_auditoria`.

Texto del disclaimer (resumen): discrepancias CFDI 4.0, impacto SBC, riesgo de simulación; responsabilidad del administrador.

## Cómo probar

1. Reprocesar asistencia de una semana → ver semáforos en registro de jornada.
2. Intentar cerrar pre-nómina con turno `horasJornada=13` → bloqueo.
3. Alta marcación manual con hora servidor vs override + motivo.
4. Ajuste «Bono» con reclasificar HE sin disclaimer → rechazado; con disclaimer → OK + bitácora.

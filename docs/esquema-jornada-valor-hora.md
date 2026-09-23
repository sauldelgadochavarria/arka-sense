# Esquema de jornada y valor hora (Sprint 1 — Reforma 2027)

## Objetivo

Unificar topes de jornada, valor hora y clasificación de HE entre asistencia → pre-nómina → nómina formal. **Sin divisor fijo ÷8** en el cálculo de HE.

## Esquema por turno

Campos en `Turno` (defaults 2027):

| Campo | Default | Uso |
|-------|---------|-----|
| `esquemaId` | `JORNADA_DIURNA_2027` | Identificador |
| `maxHorasOrdinariasSemana` | 46 | Divisor del valor hora |
| `maxHorasExtraDoblesSemana` | 9 | Tope LFT dobles/semana |
| `maxHorasTotalesDia` | 12 | Hard-stop al guardar turno si `horasJornada` > 12 |
| `maxHorasExtraDoblesDia` | 3 | Tope LFT dobles/día |
| `baseSalarioSemanal` | `siete` | `SD×7` o `SD×días laborables` |
| `tipoJornadaCfdi` | `01` | Catálogo SAT `c_TipoJornada` |

UI: **Asistencia → Turnos** → sección «Esquema de jornada».

Código: `libs/esquemaJornada.js`.

## Valor hora

```
valorHora = (salarioDiario × 7) / maxHorasOrdinariasSemana
```

(si `baseSalarioSemanal = dias_laborables`, usa días del turno).

- Pre-nómina (`payrollCalculationService`): paga P002 con este valor.
- Snapshot en `payroll_details`: `horasJornada`, `valorHora`, `maxHorasOrdinariasSemana`, `tipoJornadaCfdi`, `excedeLimiteDiario`.
- Nómina formal: `EMPLEADO.valorHora` + `EMPLEADO.horasJornada` desde el bridge (`prenominaBridge`).

Fórmulas seed HE:

```
si(…, si(EMPLEADO.valorHora > 0, EMPLEADO.valorHora, EMPLEADO.salarioDiario / EMPLEADO.horasJornada) * …)
```

**Nota:** tenants ya sembrados deben **re-sembrar o editar** las fórmulas HE en catálogo para tomar `valorHora`. El motor de pre-nómina ya usa el valor nuevo sin re-sembrar.

## Pipeline única de HE

1. Diario (`attendanceProcessingService`): minutos crudos → dobles/triples del **día** (tope esquema).
2. Período (`payrollCalculationService`): re-clasifica desde `minutosHorasExtra` crudos + tope **semanal** del esquema (no re-suma cubetas).
3. Bridge → nómina: `tiempoClasificado` + `banderasExcepcion` (`excede_limite_diario`).

Lib: `libs/horasExtraClasificacion.js`.

## Qué queda para Sprint 2+

- Semáforo/reporte ordinarias semanales vs 46 h en registro de jornada.
- Hard-stop al checar (no solo al guardar turno).
- HTTP 422 formal en preflight nómina.
- Nodos CFDI `HorasExtra` / `TipoHoras`.

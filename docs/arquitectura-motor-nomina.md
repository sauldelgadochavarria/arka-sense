# Arquitectura del motor de nómina configurable

**Stack:** Node.js + EJS + MongoDB  
**Objetivo:** agregar una empresa nueva = configuración, no código.

---

## 1. Principios

1. Separar **catálogo global**, **fórmulas (plantilla/override)** y **config por empresa**.
2. Las fórmulas son **datos** (texto) evaluados con parser restringido (`mathjs`), nunca `eval()`/`vm`.
3. El orden se deriva de **fase + dependencias** (orden topológico).
4. Todo es reproducible: `vigenciaDesde` / `vigenciaHasta`.
5. Error en fórmula → `requiereRevision`, nunca cero silencioso.

---

## 2. Capas de datos

| Colección | Rol |
|-----------|-----|
| `concept_catalog` | **Catálogo único** (código, nombre, tipo, naturaleza, fase, **`aplicaEn`**, vínculo a incidencias) |
| `formula_rules` (`nomina_formulas`) | Expresión, condición, dependencias, fase, vigencia; `empresaId: null` = default |
| `company_concept_config` | Diffs por empresa: activo, **tipoAplicacion** FIJO \| EVENTUAL |
| `system_enums` | Catálogos de valores (tipo, naturaleza, fase, aplicación, **ámbito**, variables…) |
| `tablas_fiscales` / `parametros_generales` | ISR/IMSS/UMA versionados por vigencia |

### Ámbito del concepto (`aplicaEn`)

| Valor | Uso |
|-------|-----|
| `nomina` | Solo motor formal (fórmulas / recibo / CFDI) |
| `prenomina` | Solo borrador de asistencia |
| `ambos` | Disponible en ambos módulos |

**Una sola colección de tenant:** `nomina_conceptos` guarda toda la ficha compartida
(`codigo`, `nombre`, `tipo`, `naturaleza`, `aplicaEn`, `tiposIncidencia`, `insumosContexto`,
`formulaPrenomina`, `clavePrenomina`, `sat`, `fiscal`, …).  
No se duplica en `payroll_concepts`: la pre-nómina lee/filtra la misma colección.

### Bloque fiscal (`fiscal` + `sat`)

```js
sat: { tipo: 'percepcion', clave: '019', descripcion: 'Horas extra' },
fiscal: {
  naturaleza: 'mixto',       // gravado | exento | mixto | informativo | fiscal
  integraISR: true,
  integraIMSS: true,
  integraINFONAVIT: false,
  desglose: {
    modo: 'regla_ley',       // todo_gravado | todo_exento | tope_uma | tope_monto | formula | regla_ley
    topeExentoUMA: 0,
    topeExentoMonto: 0,
    formulaExento: '',
    formulaGravado: '',
    codigoRegla: 'horas_extra' // horas_extra | aguinaldo | prima_dominical
  }
}
```

Flujo: fórmula → `importe` → `desglosarImporte()` → `gravado` / `exento` en `concepto_aplicado`  
→ acumuladores `PERCEPCIONES_GRAVADAS`, `BASE_ISR`, `BASE_IMSS` en el recibo.

Campos de vínculo con asistencia:

- `tiposIncidencia`: códigos (`RET`, `FI`, `HE`…)  
- `insumosContexto`: variables (`INCIDENCIAS.minutosRetardo`…)  
- `formulaPrenomina` / `clavePrenomina`: motor embebido de pre-nómina (`D001`…)

```
concept_catalog (maestro global + fiscal/SAT)
        ↓ sync
nomina_conceptos (colección única por tenant)
        ├─ aplicaEn ∈ {nomina, ambos}  → motor formal + formula_rules + desglose fiscal
        └─ aplicaEn ∈ {prenomina, ambos} → motor pre-nómina (formulaPrenomina)
```

---

## 3. Ejemplo: SUELDO (FIJO) vs HORAS_EXTRA_DOBLES (EVENTUAL)

### Catálogo

- `SUELDO` — fase 1, percepción, gravado  
- `HORAS_EXTRA_DOBLES` — fase 1, percepción, mixto (ISR 50% exento tope N×UMA; **no** integra SBC)  
- `HORAS_EXTRA_TRIPLES` — fase 1, percepción, gravado (100% ISR + integra SBC)  

Clasificación LFT: ≤3 h/día y ≤9 h/semana → dobles; excedente → triples. ISR e IMSS se clasifican por separado en cada línea del recibo (`isr` / `imss`).

### Fórmulas

```
SUELDO:
  expresion: EMPLEADO.salarioDiario * (PERIODO.diasTrabajados - INCIDENCIAS.faltas)
  condicion: (vacía = siempre)
  tipoAplicacion (config): FIJO

HORAS_EXTRA_DOBLES:
  expresion: (EMPLEADO.salarioDiario / EMPLEADO.horasJornada) * INCIDENCIAS.horasExtraDobles * 2
  condicion: INCIDENCIAS.horasExtraDobles > 0
  tipoAplicacion (config): EVENTUAL

HORAS_EXTRA_TRIPLES:
  expresion: (EMPLEADO.salarioDiario / EMPLEADO.horasJornada) * INCIDENCIAS.horasExtraTriples * 3
  condicion: INCIDENCIAS.horasExtraTriples > 0
  tipoAplicacion (config): EVENTUAL
```

### Flujo del motor

1. Precargar contexto de corrida (período, parámetros).  
2. Filtrar conceptos activos en `company_concept_config`.  
3. EVENTUAL: evaluar condición; si false → omitir o 0 explícito.  
4. FIJO: evaluar siempre.  
5. Orden por fase + dependencias.  
6. Evaluar expresión en parser seguro.

---

## 4. Fases obligatorias

| Fase | Contenido | Puede depender de |
|------|-----------|-------------------|
| 1 | Percepciones básicas | Fase 1 |
| 2 | Acumuladores | Fase 1–2 |
| 3 | Deducciones fiscales | Fase 1–3 |
| 4 | Neto / totales | Fase 1–4 |

Al guardar fórmula se valida que las dependencias apunten a fase ≤ propia.

---

## 5. Contexto namespaced (+ alias planos)

Para compatibilidad con fórmulas existentes se exponen ambos:

| Namespace | Ejemplos |
|-----------|----------|
| `EMPLEADO` | salarioDiario, horasJornada, antiguedadAnios, sbc |
| `PERIODO` | diasPeriodo, diasTrabajados / diasLaborados |
| `INCIDENCIAS` | faltas, horasExtraDobles, minutosRetardo |
| `PARAMETROS` | uma, salarioMinimo |

Alias planos: `sueldoDiario`, `diasLaborados`, `faltas`, …

---

## 6. Enums en BD (`system_enums`)

Mínimo de enums en código; los valores viven en Mongo y se editan en  
**Configuración → Enums del sistema** (`/config-sistema/enums`).

Grupos iniciales: `tipo_concepto`, `naturaleza_concepto`, `fase_calculo`, `tipo_aplicacion`, `ambito_concepto`, `tipo_periodo`, `tipo_nomina`, `formula_context_vars`.

---

## 7. Checklist

- [x] Documento de arquitectura  
- [x] `concept_catalog` + `company_concept_config`  
- [x] Catálogo único con `aplicaEn` (nómina / pre-nómina / ambos) + vínculo incidencias  
- [x] `formula_rules` con fase / tipoAplicacion / empresaId opcional  
- [x] Enums en BD + UI config  
- [x] Contexto namespaced + alias  
- [x] Editor UI: fase + FIJO/EVENTUAL  
- [ ] Plantillas por industria  
- [ ] Acumuladores 100% en código (fase 2)  
- [ ] Timbrado CFDI  

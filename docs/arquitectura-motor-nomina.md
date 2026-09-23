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

## 6. Cierre de período (mover)

Al cerrar un período `calculado`:

1. **Copiar** cada recibo + conceptos a `nomina_historico_recibos` (1 doc/empleado, conceptos embebidos).
2. **Actualizar** `nomina_acumulados` (anual / `porMes`).
3. **Borrar** recibos y conceptos aplicados del temporal.

El temporal solo guarda períodos vivos (`abierto` / `calculado`). Consultas de cerrados leen histórico.

**Llaves de alcance:** `tenantId` + `empresaId` + `subsidiariaId` (denormalizada del empleado).  
Unique de cierre: `(tenantId, empresaId, periodoId, empleadoId)`.

---

## 7. Reportes de nómina

UI: **Nómina → Reportes** (`/nomina/reportes`).

| Vista | Contenido |
|-------|-----------|
| Totales | Por empleado: percepciones, deducciones, gravado, exento, IMSS, otros descuentos, neto |
| Detalle | Conceptos en columnas (sueldo, fondo, HE, ISR, IMSS…) + neto |
| Resumen | Agrupa por departamento, centro de costo o ambos |

Filtros: período (obligatorio), departamento, centro de costo.  
Fuente automática: temporal si el período no está cerrado; histórico si `estatus = cerrado`.  
Export CSV. Empleado lleva `centroCostoId`; al cerrar se guarda depto/CC en el snapshot del histórico.

Servicio: `nominaReportesService`.

---

## 8. Timbrado CFDI / PAC / recibo PDF

Menú **Nómina → Timbrado**:

| Pieza | Ruta | Colección |
|-------|------|-----------|
| Config PAC | `/nomina/pac` | `pac_configs` |
| Recibos PDF | `/nomina/recibos-pdf` | `recibo_pdf_plantillas` |
| Proceso timbrado | `/nomina/timbrado` | `timbrado_lotes` |
| Archivos CFDI (XML/PDF) | `/nomina/timbrado/archivos/:id/descargar` | `nomina_cfdi_archivos` |
| Envío de correo | `/nomina/envio-correo` | `correo` en período + histórico |
| Config. correo | `/nomina/correo` | `correo_configs` (varios perfiles; uno default) |

**PAC:** campos legado (`pac_activo`, URLs SW, formato JSON/XML, `pac_layout`, templates, RFC test, etc.). `modoReal=false` simula UUID sin llamar al proveedor.

**PDF:** plantillas HTML con `{{variables}}` y bloque `{{#conceptos}}`. Resolución: tipo período + RFC → tipo → RFC → default. Preview imprimible (Guardar como PDF del navegador).

**Almacenamiento CFDI:** el XML y el PDF/HTML **no** van embebidos en `nomina_historico_recibos`. Viven en `nomina_cfdi_archivos` (BinData + sha256/tamaño). El recibo/histórico solo guarda metadatos (`uuid`, `archivoXmlId`, `archivoPdfId`, nombres). Así los listados del histórico no cargan blobs; la descarga es puntual. Al cerrar el período se enlaza `historicoId` en esos archivos.

**Proceso:** período calculado/cerrado → lote → marca `timbrado` en recibo/histórico + upsert de archivos. Payload CFDI completo hacia SW = siguiente fase (`pacClientService` ya autentica/timbra en modo real).

**Envío de correo:** solo período **cerrado** + recibo **timbrado**. Adjunta XML/PDF desde `nomina_cfdi_archivos` al `email` o `emailPersonal` del empleado. Marca `correo.estatus=enviado` en cada histórico y el resumen en el período. Reenvío de un período ya enviado pregunta **solo pendientes** vs **todos** (confirmación).

**Perfiles de correo** (`/nomina/correo`): varios por empresa (simulación, SMTP genérico, Gmail, Microsoft 365, SendGrid, Mailgun, Amazon SES). Uno es **predeterminado** (From, SMTP, seguridad). El envío puede elegir otro perfil. Fallback: `SMTP_HOST` en el entorno; si no hay nada, simulación.

---

## 9. Créditos FONACOT / INFONAVIT

Configuración en el empleado (`nominaConfig`):

| Campo | Uso |
|-------|-----|
| `tipoCreditoFonacot` | `monto_fijo` \| `porcentaje` |
| `fonacotMonto` | Importe del período (cédula) |
| `fonacotPorcentaje` | 10 / 15 / 20 sobre bruto |
| `fonacotDescuento` | Override fijo (anula cálculo) |

Motor (`nominaEmpleadoInsumos`):
- Base = `sueldoIntegrado` o `sueldoDiario × días`
- Tope legal FONACOT: **10%** si SM; hasta **20%** si superior
- Prelación: INFONAVIT primero; FONACOT con remanente del **30%** del salario nominal
- Conceptos capa D: `INFONAVIT` (SAT 010), `FONACOT` (SAT 011); fórmulas `infonavitDescuento` / `fonacotDescuento`

### Desglose IMSS CFDI (capa F)

El catálogo SAT `c_TipoDeduccion` separa la cuota obrera:

| Concepto | SAT | Contenido |
|----------|-----|-----------|
| `IMSS_OBRERO` | **001** Seguridad social | EM, IV y demás ramos **sin** CEAV |
| `IMSS_RCV` | **003** Retiro / cesantía / vejez | Solo CEAV (RCV) obrero |

Funciones de fórmula: `imssObreroSs(...)` y `imssObreroRcv(...)` (la antigua `imssObrero` sigue siendo el total SS+RCV).  
`DEDUCCIONES_TOTALES` suma ambos; la cuota sindical sobre neto fiscal resta ambos.

### Cuota sindical (capa E) y políticas por concepto

Concepto `CUOTA_SINDICAL` (SAT **019** Cuotas sindicales), `ordenCalculo: 70`.

**Lista CCT** en empresa (`nominaDescuentos.items[]`):

| Campo | Significado |
|-------|-------------|
| `conceptoCodigo` | Deducción (ej. `CUOTA_SINDICAL`, otra voluntaria) |
| `enTope30` | Si consume el 30% con INF/FON |
| `base` | `bruto` \| `neto_fiscal` |
| `ordenPrelacion` | Prioridad dentro del tope (menor = primero) |
| `activo` | Incluir en política |

UI: **Nómina → Configuraciones → Configuración fiscal** (tabla editable).  
Override empleado (sindical): `si` / `no` / según empresa.

### Registro electrónico de jornada (corto plazo / Art. 132 XXXIV)

Preparación operativa (no sustituye aún las reglas STPS 2027):

| Pieza | Qué hace |
|-------|----------|
| `asistencia_auditoria` | Bitácora append-only (crear / ajustar / anular / consultar) |
| Marcaciones | `timestampOriginal`, `estado` activa\|anulada; **sin borrado físico** |
| Ajuste / anular | Requiere motivo; recalcula `daily_attendance` |
| `/asistencia-registro-jornada` | Inicio/fin, comida, efectivo, HE y acumulado semanal |

Menú: **Asistencia → Registro de jornada**.

### Exportación SUA (IMSS / INFONAVIT)

Pantalla **Nómina → Exportación SUA** (`/nomina/sua`). Layouts **oficiales de ancho fijo** (no CSV ni pipes):

| Archivo | Longitud | Uso |
|---------|----------|-----|
| `ASEG.TXT` | 164 | Alta / directorio de trabajadores |
| `MOVT.TXT` | 49 | 02 Baja · 07 Mod. salario · 08 Reingreso · 11 Ausentismo · 12 Incapacidad |
| `CRED.TXT` | 52 | Créditos INFONAVIT (15–20) |

El **alta** va solo en `ASEG.TXT` (opción directorio o altas del período desde historial `ALTA`).  
`MOVT` mapea historial: `BAJA`→02, `REAJUSTE`→07, `REINGRESO`→08.  
`CRED` requiere `nominaConfig.infonavitNumeroCredito` en el empleado.

**Validaciones:** registro patronal obligatorio (empleado o empresa en `/config-empresa`); entidad federativa del domicilio obligatoria (ISN estatal).

Descarga ANSI (`latin1`) + CRLF. Reglas: MAYÚSCULAS, Ñ→/, SDI sin punto, nombre `AP$AM$NOMBRES`.

### Confronta Nómina–SUA–IDSE

Pantalla **Nómina → Confronta Nómina–SUA–IDSE** (`/nomina/confronta`):

1. Toma SBC teórico de nómina (SDI topado del empleado, o `BASE_IMSS ÷ días`).
2. Importa CSV de IDSE (EMA/EBA) y de SUA (`nss,sbc`).
3. Calcula diferencias vs tolerancia (default $5), semáforo, prioridad y “movimiento pendiente”.
4. Incluye checklist operativo y calendario de obligaciones LSS.
5. Exporta CSV tipo plantilla de confronta.

Es **control interno** (sin plazo legal); se recomienda por periodo, antes de pagar SUA y anual (Dictamen).

### Ajuste anual de sueldos

Pantalla **Personal → Ajuste anual de sueldos** (`/personal/ajuste-anual`). Colección `ajuste_anual_lotes`.

1. **Población:** departamento, tipo de período de pago, tipo de empleado, puesto, centro de costo, subsidiaria.
2. **Modos:** % uniforme · presupuesto mensual a distribuir · matriz desempeño (1–5) · CSV por empleado (`desempeno`, `compaRatio`, % o SD nuevo).
3. **Reglas MX:** piso CONASAMI (`SALARIO_MINIMO`); SBC = min(SDI, 25×UMA); proyección de cargas IMSS + INFONAVIT 5% + ISN (tasa capturada).
4. **Prestaciones:** fondo/despensa en % siguen el sueldo; opción de escalar vales fijos y `sueldoIntegrado`.
5. **Retroactivo:** no reabre períodos cerrados; hay que recalcular ISR de períodos **abiertos** afectados.
6. **Autorización:** Líder de equipo → RRHH → Finanzas (**sin Director TI**). Admin puede autorizar todas.
7. **Aplicar:** actualiza `salarioDiario` + `sdi`, movimiento `REAJUSTE` en historial laboral.

---

## 10. Layouts bancarios (configuración)

Colección `layouts_bancarios`. Definición declarativa sin tocar el core:

| Sección | Contexto | Uso |
|---------|----------|-----|
| `header` | `lote.*`, `periodo.*`, `empresa.*`, `fecha.*` | Totales / conteo (1 vez) |
| `detalle` | `empleado.*`, `recibo.*`, `periodo.*`, `fecha.*` | 1 línea por recibo |
| `footer` | `lote.*`, `fecha.*`… | Control / totales (1 vez) |

**Fechas dinámicas**

| Path | Significado |
|------|-------------|
| `fecha.hoy` | Día del sistema al generar |
| `fecha.hoyMas` | Hoy + N (`diasOffset` en el campo; también `fecha.hoy_mas_3`) |
| `lote.fechaPago` | Fecha capturada en el asistente de generación |
| `lote.fechaGeneracion` | Momento de generación del archivo |

Modos: `ancho_fijo` | `delimitado` | `xml`.  
UI: **Nómina → Configuraciones → Layouts bancarios**.  
Generación: **Nómina → Cálculo → Pago-dispersión** (`/nomina/dispersion-bancaria`).  
Al generar: descarga el archivo y marca `layoutBancario.estatus = generado` en el **período** y en cada **recibo/histórico**.  
Motor: `layoutBancarioService` + `dispersionBancariaService`.

---

## 11. Enums en BD (`system_enums`)

Mínimo de enums en código; los valores viven en Mongo y se editan en  
**Configuración → Enums del sistema** (`/config-sistema/enums`).

Grupos iniciales: `tipo_concepto`, `naturaleza_concepto`, `fase_calculo`, `tipo_aplicacion`, `ambito_concepto`, `tipo_periodo`, `tipo_nomina`, `formula_context_vars`.

---

## 12. Gestión documental

Feature flag admin: `gestion_documental`.

Árbol lógico: `{empresa}/{año}/{mes}/{período|SUA|Impuestos|INFONAVIT}/…` y `{empresa}/Trabajadores/{num nombre}/…`.

Storage (config por empresa):

- **local** — carpeta (`/data/documentos` en Docker, volumen `base_saas_documentos`)
- **s3** — bucket S3-compatible (Linode Object Storage recomendado por costo)

Índice en Mongo (`documentos_archivo`); binarios fuera de la BD.  
UI: **tablero de cumplimiento** (semaforo nómina/SUA/ISR/ISN/INFONAVIT + expedientes), expediente, subir, reporte de cobertura, reindexar.  
Versiones al reemplazar; vigencia en docs de trabajador (INE, contrato, domicilio).

---

## 13. Finiquitos y liquidaciones

Motor laboral **independiente** del motor de fórmulas ordinaria, reutiliza expediente + `tablas_prestaciones`.

Principios:

1. **Componentes** (sueldo, aguinaldo, vacaciones, prima, indemnizaciones…) — no un `if causa → liquidación`.
2. **Legal ≠ negociado**: `importeLegal` + `ajuste` = `importeFinal` (auditoría).
3. Período `tipoNomina: finiquito | indemnizacion` + `empleadoIds[]` (se crea/vincula al emitir desde el cálculo).
4. UI: `/nomina/finiquitos` — preview, guardado, **emitir a período** (inyecta recibo `FIN_*`).
5. **Sin período no se puede timbrar.** Dispersión bancaria es opcional (`omitirDispersionBancaria`; pago cheque/firma).
6. Cierre del período = mismo flujo que nómina ordinaria.
7. **Exención separación (Art. 93 fr. XIII):** bolsa global `añosLISR × multiplicador(90) × UMA` sobre conceptos con `aplicaExencion90Uma` (SAT 022/023/025). Años LISR = `floor(días/365) + 1` si residuo ≥ 183 (params `ISR_SEPARACION_*`).
8. **Bono/gratificación extraordinaria** (`FIN_GRATIFICACION`): 100% gravado; no entra a la bolsa. Opción UI para marcarla como separación (023).
9. **Deducciones en dos bloques:**
   - **A) Nómina** (`FIN_SALARIO_PENDIENTE` / días pendientes): ISR período, IMSS SS+RCV, INFONAVIT, FONACOT, fondo trabajador, descuento empresa — proporcionales a esos días.
   - **B) Finiquito:** ISR (tabla mensual) sobre gravado de aguinaldo/vacaciones/prima/fondo/bono.
   - **C) Separación:** ISR estimado Art. 95 (tasa del sueldo mensual × gravado de separación).
10. **CFDI `nomina12:SeparacionIndemnizacion`:** `services/cfdi/separacionIndemnizacionBuilder.js` arma `TotalPagado`, `NumAñosServicio`, `UltimoSueldoMensOrd`, `IngresoAcumulable`, `IngresoNoAcumulable` desde `finiquito_calculos` / recibo; se snapshot en `recibo.cfdiSeparacionIndemnizacion` al emitir; `timbradoService` lo inyecta en payload PAC y en XML simulado.

Pendiente: mapping CFDI 4.0 completo (todas las percepciones/deducciones ordinarias) hacia el PAC; el nodo de separación ya está cableado.

---

## 14. Checklist

- [x] Documento de arquitectura  
- [x] `concept_catalog` + `company_concept_config`  
- [x] Catálogo único con `aplicaEn` (nómina / pre-nómina / ambos) + vínculo incidencias  
- [x] `formula_rules` con fase / tipoAplicacion / empresaId opcional  
- [x] Enums en BD + UI config  
- [x] Contexto namespaced + alias  
- [x] Editor UI: fase + FIJO/EVENTUAL  
- [x] Cierre = mover (histórico + borrar temporal)  
- [x] Layouts bancarios (definición header/detalle/footer)  
- [x] Asistente generación archivo bancario + estatus en período/recibos  
- [x] Reportes de nómina (totales / detalle / resumen)  
- [x] Config PAC + plantillas recibo PDF + proceso timbrado (simulación; payload CFDI real pendiente)  
- [x] FONACOT + INFONAVIT (capa D, tope 30%, prelación)  
- [x] Cuota sindical (capa E, tope 30% parametrizable por CCT)  
- [x] Desglose IMSS CFDI (capa F: SAT 001 + 003; sindical 019)  
- [x] Registro electrónico de jornada (corto plazo: auditoría, anular/ajustar, reporte)  
- [x] Exportación SUA (`ASEG.TXT` / `MOVT.TXT` / `CRED.TXT`, guía oficial)  
- [x] Confronta Nómina–SUA–IDSE (SBC, semáforo, checklist, calendario)  
- [x] Ajuste anual de sueldos (preview, SM/25 UMA, autorización Líder→RRHH→Finanzas)  
- [x] Envío de recibos por correo (período/recibo marcados, reenvío con confirmación)
- [x] Gestión documental (feature `gestion_documental`: expediente año/mes/período + trabajadores; storage local o Linode/S3; reporte cobertura; reindex)
- [x] Finiquitos/liquidaciones (motor laboral + legal/negociación; período especial; ISR Art. 95 pendiente)
- [ ] Plantillas por industria
- [ ] Timbrado CFDI payload completo + cancelación  
- [x] Evidencia móvil: intentos bio/geo + detalle marcación (`docs/evidencia-checado-asistencia.md`)
- [x] Sprint 1 jornada 2027: esquema en turno, valor hora semanal/46, HE pipeline única (ver `docs/esquema-jornada-valor-hora.md`)
- [x] Sprint 2–3: semáforo 46h/12h, preflight cierre 422, hora servidor manual, disclaimer HE→bono (ver `docs/sprint-2-3-jornada-preflight.md`)
- [ ] REJL fase 2 (export STPS, calendario 40 h, sellado/inmutabilidad fuerte)

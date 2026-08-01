# Arka-Presence — Lista TODO por fases

Documento de seguimiento del avance contra la especificación de Pre-Nómina y Control de Asistencia.

**Leyenda:** `[x]` hecho · `[~]` parcial · `[ ]` pendiente

---

## Fase 0 — Plataforma base (esqueleto SaaS)

- [x] Multi-tenant: tenants, slug, dominios, feature flags
- [x] Control plane (`arka-presence-admin`) — alta y activación de tenants
- [x] App tenant (`arka-presence-saas`) — login, sesión, menú dinámico
- [x] Usuarios del sistema (`saas_users`) y roles (`saas_roles`)
- [x] Empresa y subsidiarias por tenant
- [x] Docker Compose dev + seed de roles/menús
- [x] Branding Arka-Presence

---

## Fase 1 — Personal y estructura organizacional

### Catálogos
- [x] Departamentos — alta, edición, activar/desactivar, jerarquía (`parentId`), `codigoLegado` Fortia
- [x] Puestos — alta, edición, activar/desactivar, `codigoLegado` Fortia
- [x] Subsidiarias — alta, edición, activar/desactivar, geocerca básica (lat/lng/radio)
- [x] Datos de empresa — RFC, domicilio fiscal, giro, teléfono (`/config-empresa`)

### Empleados (ABC básico)
- [x] Alta y listado con filtro por estatus
- [x] Expediente detalle y edición completa
- [x] Baja con motivo y reactivación
- [x] Datos personales: CURP, RFC, NSS, fecha nacimiento, sexo
- [x] Contacto: email corporativo/personal, teléfonos
- [x] Asignación: sucursal, departamento, puesto, supervisor, turno
- [x] Asignación de plantilla de horario desde expediente (fija / secuencia / matriz + fecha ancla)
- [x] Laboral: tipo contrato, salario diario, fecha ingreso
- [x] Rol RRHH en seed
- [x] Feature flag `personal`

### V2 Fase 1 — Catálogos (jun 2026)
- [x] Empleado: `codigoExterno`, `tipoRegistro`, flags export FI/RET/HE
- [x] Empleado: vinculación a grupo de dispositivos
- [x] Catálogo grupos de dispositivos (`/integraciones/grupos-dispositivos`)
- [x] Tipos incidencia: CRUD admin + seed RP, FR, HED, HEF
- [x] Conceptos pre-nómina: CRUD editable (`/prenomina-conceptos`)

### Pendiente Fase 1
- [ ] Expediente: documentos adjuntos (INE, contrato, etc.)
- [ ] Datos bancarios (CLABE, banco)
- [ ] Seguridad social: IMSS, INFONAVIT, FONACOT
- [ ] Importación masiva Excel/CSV de empleados
- [ ] Sincronización ABC con sistema de nómina externo
- [ ] Catálogo de áreas (separado de departamentos)
- [ ] Edición/eliminación avanzada en usuarios y roles del sistema
- [ ] Permisos granulares por módulo

### Historial laboral (jun 2026)
- [x] Modelo `historial_laboral` con snapshot actual + `anterior` (estilo Fortia)
- [x] Catálogo `tipos_movimiento_laboral` por tenant (ALTA, CAMBIO_PLAZA, BAJA, REAJUSTE, REINGRESO)
- [x] Catálogo `tipos_salario` (fijo, mixto, variable) con mapeo legado
- [x] Servicio: detección automática de tipo al editar empleado (baja/reingreso/plaza/salario)
- [x] Registro automático en alta, edición, baja y reactivación
- [x] Timeline por empleado (`/personal-empleados/:id/historial-laboral`)
- [x] Alta manual de movimientos + CRUD tipos (`/personal/tipos-movimiento-laboral`)
- [x] Resumen en expediente (últimos 5 movimientos)
- [x] Import TSV Fortia (`npm run import:historial-legado`)
- [x] Seed tipos (`npm run seed:tipos-movimiento-laboral`)
- [x] Mapeo deptos/puestos/ubicación legado → ObjectId vía `codigoLegado` en catálogos
- [x] Seed demo org legado (`npm run seed:org-legado-demo`) + TSV muestra (`data/historial-legado-sample.tsv`)
- [ ] Vincular movimiento a período de nómina al calcular
- [ ] Export historial CSV / PDF

---

## Fase 2 — Turnos y asistencia (core)

### Turnos
- [x] Catálogo de turnos fijos (`turnos`)
- [x] Horario entrada/salida, días laborables, tolerancias
- [x] Tiempo de comida, comida checada (flag)
- [x] Descanso sábado/domingo
- [x] Alta, edición, activar/desactivar

### V2 Fase 2 — Configuración de turnos (jun 2026)
- [x] Tipos de turno: fijo, flexible, nocturno, remoto, por_horas
- [x] Ventana de holgura (`holguraAntesMin` / `holguraDespuesMin`, default 3 h)
- [x] Modo tolerancia Normal / Concorte
- [x] Umbrales HE ordinaria / doble / triple (config, motor en Fase 3)
- [x] Flag explícito comida checada vs no registrar comida
- [x] Vista previa de ventana de holgura en edición

### V2 Fase 3 — Motor operativo (jun 2026)
- [x] Calificación según `tipoRegistro` (ninguno = solo bitácora)
- [x] Ventana de holgura en clasificación de marcajes
- [x] Modo tolerancia Normal vs Concorte en retardos
- [x] Registro parcial (RP) con comida checada obligatoria
- [x] Fuera de rango (FR) + estatus `fuera_de_rango` / `registro_parcial`
- [x] HE por umbrales (ordinaria / doble / triple) en resumen diario
- [x] Pre-nómina: VAC/PCG/PSG en días trabajados, RP/FR bloquean día
- [x] Pre-flight `codigoExterno` al cerrar período
- [x] Export CSV usa `codigoExterno` + flags export por empleado
- [x] Portal: justificar FR desde mi asistencia
- [x] Dashboard diario: stats RP y fuera de rango
- [ ] Validación marcaje vs grupo de dispositivos (requiere `dispositivoId` en marcación)
- [ ] Motor lee fórmulas dinámicas de `payroll_concepts`

### V2 Fase 4 — Rotaciones cíclicas (jun 2026)
- [x] Catálogo plantillas: **fijo**, **secuencia** (`T1→T2→T3`) y **matriz** multi-semana
- [x] Matriz semana × día con turno o descanso (`/asistencia-rotaciones/:id/edit`)
- [x] Asignación individual y masiva por departamento (`asignaciones_rotacion`)
- [x] Asignación de plantilla desde expediente del empleado (`/personal-empleados/:id/edit`)
- [x] Fecha ancla por empleado para ciclo
- [x] `turnoResolverService` — turno vigente por fecha
- [x] Motor de asistencia usa rotación al reprocesar
- [x] Vista matriz empleados × días (`/asistencia-rotaciones/matriz`)
- [x] Portal muestra rotación asignada
- [ ] Validación visual de superposición de horarios
- [x] Cambios de turno puntuales por fecha (`/asistencia-rotaciones/cambios`)

### Marcaciones y procesamiento
- [x] Registro manual web (`attendance_records`)
- [x] Resumen diario (`daily_attendance`)
- [x] Cálculo automático: retardo, salida anticipada, horas extra
- [x] Incidencias automáticas en resumen: RET, SA, HEO, FI
- [x] Vista asistencia del día + reprocesar día completo
- [x] Feature flag `asistencia`
- [x] Menús y rol Supervisor en seed

### Pendiente Fase 2
- [x] Turnos rotativos cíclicos — ver V2 Fase 4 (`/asistencia-rotaciones`)
- [x] Plantillas fijo / secuencia / matriz + cambios puntuales
- [ ] Registro biométrico (ZKTeco, Anviz, etc.)
- [ ] App móvil con GPS y selfie
- [ ] RFID / QR / PIN
- [ ] WebSockets / tiempo real en dashboard
- [ ] Particionamiento mensual de `attendance_records`
- [ ] Archivado de marcaciones > 2 años
- [ ] Notificación al supervisor por retardo (email/push)

---

## Fase 3 — Incidencias, vacaciones y portal empleado

### Incidencias
- [x] Catálogo de tipos por tenant (`tipo_incidencias`) — seed automático
- [x] Registro manual de incidencias por RRHH (`/incidencias`)
- [x] Flujo solicitud → aprobación → rechazo
- [x] Aprobación masiva (selección múltiple)
- [~] Adjuntar documentos — solo campo referencia (folio/URL), sin upload
- [x] Vincular incidencias automáticas (RET, FI, SA, HEO) al procesar asistencia
- [x] Bandeja de pendientes (`/incidencias/pendientes`)
- [x] Feature flag `incidencias`

### Vacaciones
- [x] Cálculo de saldo por antigüedad (LFT México simplificada)
- [x] Solicitud de vacaciones desde portal
- [x] Validación de saldo disponible al solicitar
- [x] Vista RRHH de saldos + recalcular (`/incidencias/vacaciones`)
- [ ] Validación de cobertura mínima por área
- [ ] Calendario de equipo
- [ ] Prima vacacional (cálculo monetario)

### Portal empleado
- [x] Vista de asistencia propia por mes
- [x] Consulta de turno asignado
- [x] Solicitud de permisos/incidencias
- [x] Consulta de saldo de vacaciones
- [x] Historial de solicitudes con estatus
- [x] Usuario vinculado a empleado (`empleadoId` en `saas_users`)
- [x] Rol Empleado + redirección a `/portal` al login
- [ ] Notificaciones push/email al aprobar/rechazar

### Pendiente Fase 3
- [x] Edición de catálogo de tipos de incidencia (CRUD admin)
- [ ] Segundo nivel de aprobación (gerente/RRHH)
- [ ] Upload real de documentos (S3/MinIO)
- [ ] 2FA / recuperación de contraseña
- [ ] Restricción estricta: rol Empleado sin acceso a administración

---

## Fase 4 — Pre-nómina

- [x] Períodos de nómina (semanal, quincenal, mensual, decena)
- [x] Apertura y cierre de período
- [x] Motor de cálculo: días trabajados, retardos, faltas, HE, salidas anticipadas
- [x] Conceptos configurables por empresa (seed automático)
- [x] Vista previa (borrador) de pre-nómina
- [x] Ajustes manuales autorizados con bitácora
- [x] Cierre de período (bloqueo de ediciones)
- [x] Comprobante de pre-nómina por empleado
- [x] Feature flag `prenomina` activo por defecto en nuevos tenants
- [x] Menús y rol Nómina en seed
- [x] Reorganización de menús Pre-nómina (Reportes, Catálogos, Configuraciones, Interfaces, Asistencia, Portal)
- [x] Período pre-nómina con checks: `aplicaAsistenciaPrenomina` y `compartirConNomina`

### Pendiente Fase 4
- [x] Bonos y conceptos personalizados editables (CRUD)
- [ ] ISR, IMSS, INFONAVIT y deducciones fiscales
- [x] Exportación a layout de nómina externa (Fase 5 — adaptadores CSV)
- [x] Cálculo asíncrono en cola (jobs MongoDB + progreso en UI, siempre activo)
- [ ] Prima vacacional y aguinaldo proporcional

---

## Fase 4b — Nómina formal (motor parametrizable)

- [x] Feature flag `nomina` en arka-admin (desactivado por defecto en nuevos tenants)
- [x] Menús: Inicio, Períodos, Conceptos, Configuración (`/nomina/*`)
- [x] Rol «Nómina operativa» en seed
- [x] Modelos: `nomina_conceptos`, `nomina_formulas`, `nomina_periods`, `nomina_recibos`, `nomina_conceptos_aplicados`, `tablas_fiscales`, `rangos_fiscales`, `parametros_generales`
- [x] Motor: `dependencyResolver`, `formulaEvaluator` (mathjs), `calculoNominaService`, `tablasFiscalesService`, `prenominaBridge`
- [x] Catálogo y editor de conceptos con fórmulas por período/nómina + probar fórmula
- [x] Períodos de nómina: abrir, calcular, cerrar, recibos con trazabilidad
- [x] Seed fiscal ISR/UMA (`npm run seed:nomina-fiscal`)
- [x] Integración insumos desde pre-nómina (vincular `payrollPeriodId`)
- [x] Validación Zod en conceptos y fórmulas (`libs/nominaValidators.js`)
- [x] Preflight antes de calcular (`nominaPreflightService`)
- [x] Catálogo SAT de referencia + seed (`seed:catalogo-sat`)
- [x] Script smoke test (`npm run test:nomina`)
- [x] Fórmulas base ampliadas (semanal, quincenal, mensual, catorcenal)
- [x] ISR prorrateado (`isrPeriodo`) e IMSS obrero (`imssObrero`) por período
- [x] Pre-nómina: HE dobles/triples, retardos, totales importados
- [x] Sync fórmulas fiscales v2 en tenants existentes
- [ ] CodeMirror/Monaco en editor de fórmulas
- [ ] Timbrado CFDI y dispersión
- [x] Cálculo asíncrono en cola (jobs MongoDB + progreso en UI, siempre activo)
- [x] Importación catálogo legado Capa A (`npm run import:conceptos-legado`) — metadatos Fortia → `L####`
- [x] Capa B: ~30 conceptos prioritarios + fórmulas mathjs (prima dominical, PTU, aguinaldo, neto)
- [x] Catálogos en colección: SAT (`catalogos_sat`), mapeo legado (`nomina_catalogo_mapeo_legado`)
- [x] CRUD UI: `/nomina/catalogos` (SAT, mapeo Fortia, parámetros UMA/salario mínimo)
- [x] CRUD tablas ISR / rangos fiscales en UI (`/nomina/catalogos/tablas-fiscales`)
- [x] Oleada 2 conceptos: INFONAVIT, fondo de ahorro, prima vacacional, finiquito (Capa C)
- [x] Arquitectura en capas documentada (`docs/arquitectura-motor-nomina.md`)
- [x] `concept_catalog` global + `company_concept_config` (FIJO / EVENTUAL)
- [x] `formula_rules` con fase, tipoAplicacion, empresaId (null = plantilla)
- [x] Contexto namespaced `EMPLEADO` / `PERIODO` / `INCIDENCIAS` / `PARAMETROS` (+ alias planos)
- [x] Enums en BD (`system_enums`) + UI `/config-sistema/enums`
- [x] Catálogo único con `aplicaEn` (nómina / pre-nómina / ambos) + vínculo `tiposIncidencia`
- [x] Sync a `nomina_conceptos` (única colección tenant) según ámbito
- [x] Bloque `fiscal` + `sat` (ISR/IMSS flags, desglose gravado/exento)
- [x] Editor de concepto: fase, FIJO/EVENTUAL, hint SUELDO/HE
- [x] Seed `npm run seed:nomina-arquitectura`
- [ ] Plantillas por industria
- [ ] Acumuladores 100% en código (fase 2)
- [ ] Timbrado CFDI y dispersión
- [x] `nominaConfig` en empleado para INFONAVIT / fondo de ahorro / finiquito
- [x] Formulario expediente empleado: sección Nómina formal (si flag `nomina` activo)
- [x] Reorganización de menús Nómina (Configuraciones, Cálculo, Timbrado, Catálogos, APIs)
- [x] Vinculación en nómina solo a períodos pre-nómina marcados para compartir
- [x] Modelo base `movimientos_asistencia_nomina` para recibir movimientos externos de asistencia
- [x] Catálogo `tipos_periodo_nomina` (Fortia CLA_PERIODO) + CRUD `/prenomina/tipos-periodo`
- [x] Catálogo `centros_costo` + CRUD `/prenomina/centros-costo`
- [x] Pantalla movimientos `/prenomina/movimientos` + import TSV
- [x] Menú: sección única **Catálogos organizacionales** (`requiredFeatureKeysAny`) sin triplicar en cada módulo
- [x] Sidebar máx. 3 niveles: catálogos enlazan a lista; **Nuevo** solo en pantalla
- [x] Administración de períodos en Catálogos org. (generar año, pendiente/abierto/cerrado, tipos nómina especiales)
- [x] Patrón Lista / Nuevo en catálogos (departamentos, centros, tipos período, conceptos)
- [x] Campos `codigoExterno`, `cuentaContableExterna` en deptos/CC/tipos período; `cuentaContable` en conceptos
- [x] Edición de centros de costo y tipos de período
- [x] Motor pre-nómina consume `movimientos_asistencia_nomina` al calcular período
- [x] Empleados demo 1259/2137/2138 para import movimientos
- [ ] Traducción oleada 3: zafra, indemnizaciones detalladas, subsidio empleo mathjs

### Configuración y pruebas (checklist)
- [ ] Activar flag `nomina` en tenant (arka-admin)
- [ ] `docker compose -f docker-compose.dev.yml exec base-saas npm run seed:nomina-fiscal`
- [ ] `docker compose -f docker-compose.dev.yml exec base-saas npm run seed:catalogo-sat`
- [ ] `docker compose -f docker-compose.dev.yml exec base-saas npm run seed:catalogo-mapeo-legado`
- [ ] `docker compose -f docker-compose.dev.yml exec base-saas npm run import:conceptos-legado -- --slug=<tenant>`
- [ ] Empleados con `salarioDiario` > 0
- [ ] Abrir período nómina quincenal (opcional: vincular pre-nómina cerrada)
- [ ] Calcular y revisar recibo → trazabilidad de fórmulas
- [ ] `npm run test:nomina -- --slug=<tenant>` (cálculo directo; en UI es async)
- [ ] Probar escenario semanal vs quincenal con pre-nómina vinculada cerrada

---

## Fase 5 — Integraciones

### Nómina externa
- [x] Adaptador CONTPAQi Nóminas (CSV)
- [x] Adaptador ASPEL NOI (CSV)
- [x] Adaptador SAP HCM (CSV)
- [x] CSV genérico con campos mapeables
- [x] Exportación de pre-nómina por período
- [x] Sincronización ABC — exportación empleados
- [~] Sincronización ABC bidireccional — importación CSV con detección de conflictos
- [x] Log de sincronizaciones y resolución de conflictos (local vs remoto)

### Dispositivos y móvil
- [x] Administración de dispositivos biométricos (alta, edición)
- [x] Monitoreo online/offline (ping HTTP)
- [x] Sincronización de catálogo hacia dispositivo (payload JSON + log)
- [ ] App React Native (iOS/Android)
- [ ] Geocercas operativas en checado móvil
- [ ] Protocolo nativo ZKTeco/Anviz (SDK real)

### Pendiente Fase 5
- [ ] Conexión API real CONTPAQi / ASPEL / SAP (hoy export CSV)
- [ ] Sincronización ABC automática programada
- [ ] Webhook de recepción de marcaciones desde dispositivo
- [ ] Cola de reintentos para sync fallidos

---

## Fase 6 — Reportes y analítica

- [x] Reportes operativos (asistencia período, retardos, faltas, HE, incidencias, etc.)
- [x] Reporte de vacaciones y rotación de personal
- [x] Registros parciales, fuera de rango, sin código externo
- [x] Pre-nómina borrador / cerrada
- [x] Conciliación exportación ERP (sync logs)
- [x] Dispositivos biométricos
- [x] Dashboard gerencial con KPIs (`/reportes/kpis` + resumen en inicio)
- [x] Exportación CSV (Excel)
- [x] Menú seed categoría Reportes (`reportes` feature flag)
- [x] Gráfica tendencia 12 meses
- [ ] Exportación PDF
- [ ] Reporte auditoría de cambios (requiere `audit_log` Fase 7)

---

## Fase 7 — Estabilización y seguridad avanzada

- [ ] Pruebas automatizadas (unitarias e integración)
- [ ] Pruebas de carga (50k empleados objetivo spec)
- [ ] Auditoría completa (`audit_log`)
- [ ] OWASP / sanitización reforzada
- [ ] SSO (SAML, LDAP, Active Directory)
- [ ] Cifrado AES-256 datos sensibles en reposo
- [ ] Cumplimiento LFPDPPP
- [ ] Backups y RTO/RPO según spec

---

## Fase 8 — Producción

- [ ] CI/CD (GitHub Actions)
- [ ] Deploy producción (ECS/K8s según spec)
- [ ] Monitoreo (logs, APM, alertas)
- [ ] Documentación de usuario
- [ ] Capacitación y go-live
- [ ] Migración de datos cliente

---

## Deuda técnica / mejoras transversales

- [ ] Renombrar carpetas `base-admin` / `base-saas` → `arka-presence-*` (opcional)
- [ ] API REST versionada (`/api/v1/`) — hoy solo vistas EJS

- [ ] Redis para caché de sesiones/catálogos
- [ ] Cola de mensajes para motor de pre-nómina asíncrono

---

## Historial de avance

| Fecha | Fase | Notas |
|-------|------|-------|
| 2026-06 | 0 | Esqueleto multi-tenant baseSaasX → Arka-Presence |
| 2026-06 | 1 | Empleados, deptos, puestos, empresa, subsidiarias CRUD |
| 2026-06 | 2 | Turnos, marcaciones manuales, resumen diario, procesamiento |
| 2026-06 | 3 | Incidencias, vacaciones LFT, portal empleado, aprobaciones |
| 2026-06 | 4 | Pre-nómina: períodos, motor cálculo, ajustes, comprobantes, cierre |
| 2026-06 | 5 | Integraciones: adaptadores nómina, ABC sync, logs, dispositivos biométricos |
| 2026-06 | V2-1 | Catálogos V2: empleado ERP, tipos incidencia CRUD, conceptos CRUD, grupos dispositivos |
| 2026-06 | V2-2 | Turnos V2: holgura, tolerancia, tipos, umbrales HE |
| 2026-06 | V2-3 | Motor calificación, pre-nómina enriquecida, pre-flight ERP, portal FR |
| 2026-06 | V2-4 | Rotaciones cíclicas: plantillas, asignaciones, matriz, turno vigente por día |
| 2026-06 | V2-4b | Plantillas fijo/secuencia/matriz, cambios puntuales, asignación desde expediente |
| 2026-06 | HL-1 | Historial laboral: modelos, catálogo tipos, timeline, auto-registro, import Fortia |

---

*Actualizar este archivo al cerrar cada fase o entrega parcial importante.*

** falta definir como es home office, definir si se genera registros automaticos por empleado de acuerdo con el turno y encender esta parte en el turno
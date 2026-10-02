'use strict';
/**
 * Artículo de ayuda: Importación de históricos CFDI + parámetros + mapeo SAT.
 *   node scripts/seed-ayuda-importacion-historicos-cfdi.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { upsertArticuloPorSlug } = require('../services/ayudaService');

const ARTICULO = {
  slug: 'importacion-historicos-cfdi',
  titulo: 'Importación de históricos CFDI (ZIP masivo)',
  categoria: 'nomina',
  orden: 40,
  tags: [
    'cfdi',
    'historicos',
    'importacion',
    'zip',
    'masiva',
    'mapeo',
    'sat',
    'conceptos',
    'periodos'
  ],
  resumen:
    'Cómo cargar históricos desde ZIP de XML, qué hace cada parámetro de la importación masiva y cómo funciona el mapeo SAT ↔ código motor por subsidiaria.',
  cuerpo: `# Importación de históricos CFDI

PayPilot importa recibos timbrados (CFDI 4.0 + complemento **Nómina 1.2**) desde un **ZIP de XML** para armar el padrón, conceptos, períodos e histórico antes del primer paralelo.

**Canal único:** carga masiva asíncrona  
Ruta: \`/config-empresa/cargas/cfdi_nomina_zip_masivo\`  
Menú típico: **Personal → Cargas / Históricos CFDI**

La antigua «carga rápida» quedó retirada; esa URL redirige a la masiva.

## Flujo recomendado

1. Selecciona la **subsidiaria** correcta en sesión (el import y el mapeo quedan ligados a esa sub).
2. Revisa el **[Mapeo SAT ↔ motor](/nomina/mapeo-sat)** (opcional: overrides de la sub).
3. Sube el ZIP con los XML del año (o del rango que vayas a importar).
4. Marca los **bloques** y el **modo de escritura**.
5. Encola y sigue el **job** (progreso, errores, apply).
6. En **Nómina → Períodos**, usa **Organizar períodos** si hace falta renumerar / alinear.
7. Abre el primer período paralelo y calcula (solo empleados de esa subsidiaria).

## Parámetros de la importación masiva

### Año a importar

Filtra / etiqueta el año fiscal de trabajo. Los XML fuera de año pueden omitirse según validación del job.

### Archivo ZIP

Contenedor con uno o muchos \`.xml\` (anidados en carpetas está bien). Límites orientativos: ~50 000 XML · ~500 MB.

### Bloques a importar

| Parámetro | Qué hace |
| --- | --- |
| **Empresa** | Completa campos vacíos de la empresa (RFC, registro patronal, CP…) sin pisar lo ya capturado. |
| **Empleados** | Alta/actualización de trabajadores (CURP, NSS, RFC, nombre, sueldo, etc.). |
| **Departamentos y puestos** | Crea organización a partir de los nodos del CFDI. |
| **Conceptos de nómina** | Registra conceptos y aplica **mapeo SAT → código motor** por subsidiaria. |
| **Histórico de recibos** | Guarda cada CFDI como recibo histórico (importes, gravado/exento, UUID). |
| **Acumulados del año** | Consolida saldos anuales por concepto (requiere histórico). |
| **Períodos** | Infiere ventanas, clasifica periodicidad, cierra períodos históricos como timbrados. |
| **Historial laboral** | Altas desde \`FechaInicioRelLaboral\`. |
| **Bajas por finiquito** | Marca bajas cuando el CFDI trae separación / indemnización. |

Si **desmarcas Histórico**, Acumulados y Períodos se deshabilitan (dependen del histórico).

### Modo de escritura

| Modo | Comportamiento |
| --- | --- |
| **Upsert** | Crea si no existe; actualiza si ya existe (recomendado en primera carga). |
| **Solo crear** | No modifica empleados/conceptos ya presentes. |
| **Solo vacíos** | Solo llena campos vacíos; no sobrescribe datos capturados a mano. |

### Filtros / cuidado

| Parámetro | Qué hace |
| --- | --- |
| **Excluir extraordinarias (E)** | Omite tiponomina E. **Déjalo sin marcar** si quieres finiquitos, aguinaldo, PTU, etc. |
| **Actualizar datos laborales** | En empleados existentes, refresca sueldo / depto / puesto desde el último XML. |

## Mapeo SAT ↔ código motor

Pantalla: **[Nómina → Configuraciones → Mapeo SAT ↔ motor](/nomina/mapeo-sat)** (\`/nomina/mapeo-sat\`).

Al importar, cada línea del CFDI trae:

- **Tipo** — percepción / deducción / otro pago  
- **Clave SAT** — \`TipoPercepcion\` / \`TipoDeduccion\` / \`TipoOtroPago\` (ej. \`001\`, \`002\`)  
- **Clave interna** — atributo \`Clave\` del emisor (se guarda como referencia)  
- **Concepto / nombre** — texto del XML (sirve para desambiguar)

PayPilot traduce eso a un **código motor** canónico (\`SUELDO\`, \`ISR\`, \`IMSS_OBRERO\`…) para que el cálculo y los históricos hablen el mismo idioma.

### Prioridad de resolución

1. **Override de la subsidiaria** (lo que configures en la pantalla de mapeo).  
2. **Mapa de sistema** (ley y prestaciones predefinidas).  
3. **Catálogo** \`concept_catalog\` si hay coincidencia única.  
4. Si no hay match → se conserva la clave interna del CFDI.

### Campos del listado de mapeo

| Campo | Significado |
| --- | --- |
| **Tipo** | \`percepcion\`, \`deduccion\` u \`otro_pago\`. |
| **Clave SAT** | Código de 3 dígitos del catálogo SAT. |
| **Código motor** | Concepto PayPilot al que se mapea. |
| **Match nombre** | Opcional. Texto contenido en el nombre del XML, o regex \`/patron/i\`, para desambiguar la misma clave SAT. |
| **Default** | Si es el fallback cuando no aplica ningún match de nombre. |
| **Origen** | \`sistema\` (mapa fijo) u \`override\` (configuración de la sub). |
| **Categoría** | \`ley\`, \`prestacion\`, \`override\`, etc. (orientativo). |

### Ejemplos del mapa de sistema

| Tipo | Clave SAT | Código motor |
| --- | --- | --- |
| percepción | 001 | SUELDO |
| percepción | 002 | AGUINALDO |
| percepción | 021 | PRIMA_VACACIONAL |
| percepción | 029 | DESPENSA |
| percepción | 019 | HORAS_EXTRA_* (según nombre: dobles / triples) |
| deducción | 001 | IMSS_OBRERO |
| deducción | 002 | ISR |
| deducción | 003 | IMSS_RCV |
| deducción | 010 | INFONAVIT |
| deducción | 011 | FONACOT |
| otro pago | 002 | SUBSIDIO_EMPLEO |

### Overrides por subsidiaria

Usa **Agregar / reemplazar override** cuando el emisor use la misma clave SAT para algo distinto, o quieras forzar un código motor.

- Ejemplo: SAT \`004\` (Otros) → \`DED_FONDO_AHORRO\` con match \`fondo\`.  
- **Quitar** en una fila override vuelve al mapa de sistema para esa clave.

Los overrides **no reescriben** históricos ya importados; aplican en la **siguiente** carga (o si reimportas).

## Después de importar

- **Conceptos:** \`/nomina/conceptos\` — visibles por subsidiaria.  
- **Períodos:** \`/nomina/periodos\` — históricos cerrados + botón organizar.  
- **Primer paralelo:** crea el siguiente período; el cálculo solo toma empleados de la sub activa.

## Errores frecuentes

- **Muchos empleados en el cálculo** — asegúrate de tener subsidiaria en sesión y que el período tenga \`subsidiariaId\`.  
- **Conceptos “raros”** — faltó mapeo; ajusta override y reimporta conceptos/histórico.  
- **Períodos solapados** — usa Organizar períodos; el siguiente semanal debe empezar en \`fechaFin + 1\`.  
- **ZIP enorme sin progreso** — abre el job; el worker va por lotes en segundo plano.
`
};

async function main() {
  await upsertArticuloPorSlug({ ...ARTICULO, tenantId: null, publicado: true });
  console.log('✓', ARTICULO.slug, '→ /ayuda/' + ARTICULO.slug);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { ARTICULO };

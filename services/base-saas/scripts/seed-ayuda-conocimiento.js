#!/usr/bin/env node
'use strict';

/**
 * Siembra menú Ayuda + artículos iniciales de la base de conocimiento.
 *   npm run seed:ayuda
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const menuSchema = require('../models/menuSchemaDefinition');
const { upsertArticuloPorSlug } = require('../services/ayudaService');

const ARTICULOS = [
  {
    slug: 'bienvenida-ayuda',
    titulo: 'Cómo usar el centro de ayuda',
    categoria: 'general',
    orden: 10,
    tags: ['ayuda', 'inicio'],
    resumen: 'Busca guías por categoría o palabra clave y agrega artículos si eres admin.',
    cuerpo: `# Cómo usar el centro de ayuda

Este espacio concentra guías operativas de Arka-Presence / PayPilot.

## Buscar
- Usa el buscador del índice (\`/ayuda\`) por título, tags o texto.
- Filtra por categoría: Nómina, Asistencia, Personal, etc.

## Administrar (admins)
- Menú **Ayuda → Administrar** o botón en el índice.
- Los artículos admiten Markdown básico: encabezados, **negrita**, \`código\` y listas.
- **Global** = visible a todos los tenants; **Tenant** = solo tu empresa.
`
  },
  {
    slug: 'fondo-de-ahorro',
    titulo: 'Configurar fondo de ahorro',
    categoria: 'nomina',
    orden: 20,
    tags: ['fondo', 'ahorro', 'isr', 'nomina'],
    resumen: 'Check en el empleado, % global o personal, y los tres conceptos del motor.',
    cuerpo: `# Configurar fondo de ahorro

## 1. Empleado
En **Personal → editar empleado → Nómina formal**:
- Marca **Aplica fondo de ahorro**
- \`%\` vacío → usa el parámetro global \`FONDO_AHORRO_PORC\` (por defecto 13)
- O define un % propio por empleado

Sin el check, el motor deja \`fondoAhorroTrabajador\` / \`fondoAhorroEmpresa\` en **0**.

## 2. Parámetros globales
En **Nómina → Catálogos → Parámetros**:
- \`FONDO_AHORRO_PORC\` — % máximo del salario
- \`FONDO_AHORRO_TOPE_UMA\` — factor UMA mensual (1.3 → tope = 1.3 × UMA × 30.4)
- Prorrateo al período: quincena = mitad (ej. \$4,636 / 2 = \$2,318)
- \`UMA\` — valor vigente

Tope exento = menor entre (% del salario) y (factor × UMA prorrateada al período).
El **excedente patronal** es gravable (\`fondoAhorroEmpresaGravado\`).

## 3. Conceptos
| Código | Rol | Condición | Fórmula |
| --- | --- | --- | --- |
| \`FONDO_AHORRO_EMPRESA\` | Percepción patronal | \`fondoAhorroEmpresa > 0\` | \`fondoAhorroEmpresa\` |
| \`FONDO_AHORRO_TRABAJADOR\` | Informativo | \`fondoAhorroTrabajador > 0\` | \`fondoAhorroTrabajador\` |
| \`DED_FONDO_AHORRO\` | Deducción del recibo | \`fondoAhorroTrabajador > 0\` | \`fondoAhorroTrabajador\` |

Dependencias: déjalas **vacías** (son variables de contexto, no otros conceptos).

## 4. Cálculo
Con 13% sobre salario del período → **mitad empresa / mitad trabajador**.

## 6. Vigencia de fórmulas
Las fórmulas de fondo deben estar vigentes en la fecha de inicio del período.
Si el período es anterior a la vigencia, el motor **no** las aplica (síntoma: check en empleado pero sin líneas en el recibo).
`
  },
  {
    slug: 'conceptos-nomina-basicos',
    titulo: 'Conceptos básicos de nómina',
    categoria: 'nomina',
    orden: 30,
    tags: ['conceptos', 'sueldo', 'isr', 'imss'],
    resumen: 'Set limpio: sueldo, premios, fondo, impuestos y acumuladores del motor.',
    cuerpo: `# Conceptos básicos de nómina

El catálogo limpio de arranque incluye:

## Percepciones / operación
- \`SUELDO\`
- \`PREMIO_PUNTUALIDAD\` — si \`INCIDENCIAS.sinRetardo == 1\`
- \`PREMIO_ASISTENCIA\` — si \`INCIDENCIAS.sinFaltas == 1\`
- Fondo de ahorro (empresa / trabajador)

## Impuestos
- \`ISR\`
- \`IMSS_OBRERO\`
- \`IMSS_PATRONAL\` (informativo)

## Acumuladores (no son pagos)
- \`PERCEPCIONES_GRAVADAS\`
- \`DEDUCCIONES_TOTALES\`
- \`NETO_PAGAR\`

## Pre-nómina
Conceptos de asistencia (\`FALTAS\`, \`RETARDOS\`, etc.) siguen activos para el flujo de marcajes.

Para limpiar de nuevo un tenant: \`npm run limpiar:conceptos -- --slug=<tenant>\`.
`
  },
  {
    slug: 'premios-puntualidad-asistencia',
    titulo: 'Premios de puntualidad y asistencia',
    categoria: 'nomina',
    orden: 40,
    tags: ['premios', 'puntualidad', 'asistencia'],
    resumen: 'Fórmulas eventuales basadas en incidencias de retardo y faltas.',
    cuerpo: `# Premios de puntualidad y asistencia

## Premio de puntualidad (\`PREMIO_PUNTUALIDAD\`)
- Tipo de aplicación: **Eventual**
- Condición: \`INCIDENCIAS.sinRetardo == 1\`
- Fórmula ejemplo: \`500\` (ajusta el monto)

\`sinRetardo\` vale 1 cuando no hay minutos ni días con retardo en el período.

## Premio de asistencia (\`PREMIO_ASISTENCIA\`)
- Condición: \`INCIDENCIAS.sinFaltas == 1\`
- Fórmula ejemplo: \`500\`

Ambos suelen ser **exentos** (no suman a \`PERCEPCIONES_GRAVADAS\` para ISR).
`
  }
];

async function upsertMenuNode(Menu, data) {
  const filter = {
    menuPrincipal: data.menuPrincipal,
    parentId: data.parentId || null
  };
  const existing = await Menu.findOne(filter).lean();
  if (existing) {
    await Menu.updateOne({ _id: existing._id }, { $set: data });
    return existing._id;
  }
  const created = await Menu.create(data);
  return created._id;
}

async function seedAyudaMenus(Menu) {
  const catId = await upsertMenuNode(Menu, {
    menuPrincipal: 'Ayuda',
    esCategoria: true,
    orden: 95,
    activo: true,
    requiredFeatureKeys: ['core'],
    roles: []
  });

  const common = { activo: true, requiredFeatureKeys: ['core'], roles: [] };
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Centro de ayuda',
    rutaApp: '/ayuda',
    parentId: catId,
    orden: 96
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Administrar artículos',
    rutaApp: '/ayuda/admin',
    parentId: catId,
    orden: 97
  });
  return catId;
}

async function main() {
  console.log('Conectando a', dbConfig.connectionStringConfig);
  await mongoose.connect(dbConfig.connectionStringConfig);

  for (const a of ARTICULOS) {
    await upsertArticuloPorSlug({ ...a, tenantId: null, publicado: true });
    console.log('✓', a.slug);
  }

  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  const Menu = conn.models.Menu || conn.model('Menu', menuSchema, 'mainmenu');
  await seedAyudaMenus(Menu);
  console.log('✓ Menú Ayuda');

  await mongoose.disconnect();
  console.log('Listo. Abre /ayuda en la UI (recarga sesión si el menú no aparece).');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedAyudaMenus, ARTICULOS };

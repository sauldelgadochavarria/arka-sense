'use strict';
/**
 * Artículo de ayuda: Descuentos programados (con ejemplos).
 *   node scripts/seed-ayuda-descuentos-programados.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { upsertArticuloPorSlug } = require('../services/ayudaService');

const ARTICULO = {
  slug: 'descuentos-programados-nomina',
  titulo: 'Descuentos programados de nómina',
  categoria: 'nomina',
  orden: 45,
  tags: [
    'descuentos',
    'programados',
    'saldo',
    'caja de ahorro',
    'prestamo',
    'cfdi',
    'parcial'
  ],
  resumen:
    'Cómo activar el módulo, registrar descuentos por empleado, entender saldos/parciales y ver cómo llegan al CFDI.',
  cuerpo: `# Descuentos programados de nómina

Permiten descontar de forma controlada conceptos como **ahorro**, **préstamo caja de ahorro** o **mercancía a crédito**, con **saldo**, **historial** y aplicación automática al calcular la nómina.

El **CFDI no decide el negocio**: solo refleja lo que el motor ya calculó (Clave interna + TipoDeducción + Importe).

## Flujo en 4 pasos

1. **Configuración** — activa el módulo y los conceptos por subsidiaria (\`/nomina/descuentos-programados/config\`).
2. **Alta por trabajador** — importe, saldo, modalidad y vigencia.
3. **Cálculo del período** — el motor aplica lo que corresponda y guarda un movimiento.
4. **Timbrado** — las líneas del recibo pasan al complemento nómina 1.2.

## Ejemplo 1 · Monto fijo con saldo (préstamo)

- Concepto interno: \`D450\` Prestamo Caja De Ahorro  
- TipoDeducción SAT: \`004\` (Otros)  
- Monto original / saldo: **\$5,664.00**  
- Importe por quincena: **\$566.40**  
- Modalidad: \`monto_fijo\`

Cada quincena se descuentan \$566.40 y el saldo baja. Cuando el saldo llega a 0, el descuento queda **liquidado**.

## Ejemplo 2 · Aplicación parcial

| Concepto | Valor |
| --- | --- |
| Saldo / programado | \$566.40 |
| Neto disponible tras ISR/IMSS/etc. | \$400.00 |
| Concepto permite parcial | Sí |

**Resultado**

- Aplicado: **\$400.00**
- Saldo pendiente: **\$166.40** (sigue para la siguiente nómina)
- Movimiento: \`APLICACION_PARCIAL\`

Si el concepto **no** permite parcial y no alcanza el neto, **no se aplica** en ese período.

## Ejemplo 3 · Varios descuentos en el mismo recibo

Tras el cálculo, el recibo puede verse así (deducciones):

| Clave | Concepto | TipoDeducción | Importe |
| --- | --- | --- | --- |
| D001 | ISR | 002 | 427.52 |
| D010 | Cuota IMSS | 021 | 123.35 |
| D020 | Credito Infonavit | 009 | 910.09 |
| D340 | Ahorro A La Vista | 004 | 100.00 |
| D450 | Prestamo Caja De Ahorro | 004 | 566.40 |
| D455 | Ahorro A Plazo | 004 | 250.00 |
| D910 | Mercancia a credito | 017 | 235.30 |
| D915 | Mercancia | 017 | 62.50 |

En el CFDI:

- \`TotalImpuestosRetenidos\` = ISR (002)
- \`TotalOtrasDeducciones\` = el resto (IMSS, INFONAVIT, ahorros, préstamos, mercancía…)

La clave **interna** (\`D450\`) puede ser distinta de la **fiscal** (\`004\`).

## Ejemplo 4 · Suspender sin perder historial

1. Empleado con préstamo activo y saldo \$2,000.
2. **Suspender** → no se descuenta en la siguiente nómina; el saldo **no cambia**.
3. **Reactivar** → continúa con los \$2,000 pendientes.
4. **Cancelar** → no habrá más aplicaciones; el historial de quincenas anteriores se conserva.

## Configuración por subsidiaria

- Si el **módulo está apagado**, ningún descuento programado se aplica automáticamente.
- ISR, IMSS y demás conceptos obligatorios **siguen** con sus reglas normales.
- Activar un concepto en config también marca en el catálogo que “permite descuento programado”.

## Dónde administrar

- Menú: **Nómina → Descuentos programados**
- Config: **Descuentos programados → Configuración por subsidiaria**
- Conceptos: en la ficha del concepto, bloque **Descuento programado**
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

module.exports = { ARTICULO, main };

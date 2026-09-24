# Descuentos programados de nómina

## Flujo

```
Config subsidiaria → Descuentos activos del trabajador → Motor (saldo/reglas)
  → Movimientos históricos → Líneas en recibo → CFDI Nómina 1.2
```

El CFDI **no** controla el negocio: solo refleja `conceptoCodigo` + `sat.clave` (TipoDeduccion) e importe aplicado.

## Capas

| Capa | Colección / campo | Rol |
|------|-------------------|-----|
| Catálogo | `nomina_conceptos.descuentoProgramado` | permite / saldo / parcial; `sat.clave` = fiscal |
| Config | `descuento_programado_config` | módulo on/off + conceptos por subsidiaria |
| Programa | `descuentos_programados` | por empleado: importe, saldo, vigencia, estatus |
| Histórico | `descuento_programado_movimientos` | alta, aplica, parcial, suspensión, etc. |

## Uso rápido

1. Seed conceptos ejemplo: `node scripts/seed-descuentos-programados.js <tenantId>`
2. Menú: **Nómina → Cálculo → Descuentos programados** (o `node scripts/add-menu-descuentos-programados.js`)
3. Ayuda con ejemplos: `/ayuda/descuentos-programados-nomina`
4. UI → **Configuración** → activar módulo y conceptos.
5. Registrar descuento por trabajador.
6. Al **calcular período**, si el módulo está activo se inyectan deducciones y se actualiza saldo.
7. Recálculo revierte aplicaciones del período antes de volver a calcular.

## Modalidades

- `monto_fijo` — `importePorPeriodo`
- `porcentaje` — % sobre sueldo / gravadas / neto provisional
- `liquidacion` — todo el saldo pendiente
- `monto_variable` — `importeVariable` (si vacío, no aplica)

## Parcial

Si el neto disponible &lt; importe solicitado y el concepto permite parcial: aplica lo que alcance y deja saldo para periodos siguientes.

# Geocercas y puntos de acceso

## Principio

La app solo envía GPS. **El backend decide** si la marcación está dentro o fuera de zona (Haversine). No se auto-aprenden cercas desde checadas.

## Catálogo

| Recurso | Ruta |
|---------|------|
| Puntos de acceso (POI) | `/config-puntos-acceso` |
| Geocerca de sede | Subsidiaria → `lat`, `lng`, `geocercaRadioMetros` |
| Asignaciones temporales | colección `asignaciones_punto_acceso` (modelo listo; UI de calendario pendiente) |

Cada punto: código, nombre, lat/lng, radio (80–150 m sugerido), `location` GeoJSON Point (índice 2dsphere).

## Políticas por empleado (`marcajePoliticaGeo`)

| Valor | Comportamiento |
|-------|----------------|
| `open_with_flag` (default) | Permite fuera de zona; guarda bandera + auditoría |
| `subsidiaria_default` | Sucursal + puntos fijos + asignaciones vigentes → **bloquea** si fuera |
| `strict_assignment` | Igual, orientado a rotación programada → **bloquea** |
| `any_catalog_site` | Auto-match contra todo el catálogo (itinerantes) |
| `disabled` | Sin validación GPS |

Sin geocercas configuradas: no bloquea (`skipped: true`).

## Marcación API

`POST /api/v1/asistencia/marcar` valida y persiste:

```json
"geocerca": {
  "politica": "open_with_flag",
  "fueraDeZona": false,
  "siteNombre": "Planta Norte",
  "distanceMeters": 42.5,
  "puntoAccesoId": "…"
}
```

Fake GPS: `isMocked: true` → HTTP 403.

## Menú

```bash
docker exec paypilot-base-saas-1 node scripts/add-menu-puntos-acceso.js
```

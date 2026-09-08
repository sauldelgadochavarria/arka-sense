# ArkaSense — sitio web (landing)

Landing de producto (HTML estático). **Va en un contenedor aparte** del SaaS (`base-saas` :4003).

## Con Docker (recomendado)

```bash
# desde la raíz del repo
docker compose -f docker-compose.dev.yml up -d --build website
```

Abre **http://localhost:5173**

- Imagen: `nginx:alpine` (`website/Dockerfile.dev`)
- Volumen: `./website` → lectura en caliente al editar HTML/CSS
- No usa Mongo ni Node

Solo landing (sin levantar todo el stack):

```bash
docker compose -f docker-compose.dev.yml up -d --build website
```

Build tipo producción (archivos copiados en la imagen):

```bash
docker build -t arka-sense-website ./website
docker run --rm -p 5173:80 arka-sense-website
```

## Sin Docker

```bash
cd website
npx --yes serve -l 5173
```

## Puertos del stack

| Servicio | Puerto host | Rol |
|----------|-------------|-----|
| `website` | **5173** | Landing / legales / descargas |
| `base-saas` | 4003 | App + API `/api/v1` |
| `base-admin` | 4004 | Admin tenants |

## Estructura

- `index.html` — landing
- `contacto.html`, `contrato.html`, `aviso-privacidad.html`, `derechos-arco.html`, `seguridad.html`
- `css/`, `js/`, `downloads/`
- `nginx.conf`, `Dockerfile`, `Dockerfile.dev`

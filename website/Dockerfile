# Landing ArkaSense — estático con nginx
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html

# No servir archivos de build/docs internos como listado
RUN rm -f /usr/share/nginx/html/nginx.conf \
    && rm -f /usr/share/nginx/html/Dockerfile \
    && rm -f /usr/share/nginx/html/Dockerfile.dev

EXPOSE 80

# crema's own nginx: TLS from the shared certificates, static files from the web image.
# Build after the web image: docker build --build-arg WEB_IMAGE=crema-web:<tag> -f nginx.Dockerfile .
ARG WEB_IMAGE
FROM ${WEB_IMAGE} AS web

FROM nginx:1.27-alpine
COPY --from=web /app/staticfiles /app/static

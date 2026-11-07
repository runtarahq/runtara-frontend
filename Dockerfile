# syntax=docker/dockerfile:1

# The Runtara console: dist/ served by nginx, with config.js rendered from
# RUNTARA_UI_* env vars at every start (docker/render-config.sh lists them).
# It calls runtara-server across origins: set RUNTARA_UI_API_BASE_URL to the
# server, and list this console's origin in the server's CORS_ALLOWED_ORIGINS
# and as its RUNTARA_UI_PUBLIC_URL.
#
#   docker build -t runtara-frontend --build-arg VERSION=X.Y.Z .
#   docker run -p 8080:8080 -e RUNTARA_UI_AUTH_MODE=local \
#     -e RUNTARA_UI_API_BASE_URL=http://localhost:7001 runtara-frontend

# The bundle is the same on every platform: build it once, natively.
FROM --platform=$BUILDPLATFORM node:22.12.0-alpine AS build
ARG VERSION=dev
ARG COMMIT=
ARG BUILD_NUMBER=
WORKDIR /src
COPY package.json package-lock.json ./
RUN HUSKY=0 npm ci --no-audit --no-fund
COPY . .
RUN VITE_RUNTARA_VERSION="$VERSION" VITE_RUNTARA_COMMIT="$COMMIT" \
        VITE_RUNTARA_BUILD_NUMBER="$BUILD_NUMBER" npm run build \
    && node docker/inline-script-hashes.mjs dist/index.html > inline-script-hashes \
    && rm dist/config.js

FROM nginxinc/nginx-unprivileged:1.27-alpine
# Rendered into /etc/nginx/conf.d/default.conf at start (RUNTARA_UI_LISTEN).
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/render-config.sh /docker-entrypoint.d/40-runtara-config.sh
COPY --from=build /src/inline-script-hashes /etc/runtara/inline-script-hashes
# config.js is not in it: nginx serves the one rendered into /tmp/runtara.
COPY --from=build /src/dist /usr/share/nginx/html

LABEL org.opencontainers.image.source="https://github.com/runtarahq/runtara-frontend" \
      org.opencontainers.image.title="runtara-frontend" \
      org.opencontainers.image.description="Runtara console"

# Where nginx listens: a port, or an address and port (127.0.0.1:17989, say,
# with --network host).
ENV RUNTARA_UI_LISTEN=8080
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${RUNTARA_UI_LISTEN##*:}/healthz" >/dev/null || exit 1

# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# --------------------------------------------------------------------- runtime
FROM node:22-alpine

# ffmpeg does the compositing; font-dejavu gives drawtext a face for cell
# labels; su-exec lets the entrypoint fix volume ownership then drop root.
RUN apk add --no-cache \
      ffmpeg \
      font-dejavu \
      tini \
      su-exec \
      curl \
    && rm -rf /var/cache/apk/*

# VA-API drivers, so passing `--device /dev/dri` actually yields hardware
# encoding rather than an encoder that lists itself and then fails to start.
# ffmpeg does not bundle these; they are separate packages.
#   libva-intel-driver  i965 — Intel up to Ivy Bridge (Gen7)
#   intel-media-driver  iHD  — Intel Broadwell (Gen8) and newer
#   mesa-va-gallium     AMD
# x86 only: none of these exist for arm64, and the image is built for both.
# Failures are tolerated so a missing package never breaks the build — the
# encoder probe runs a real test encode at boot and reports the truth either way.
ARG TARGETARCH
RUN if [ "${TARGETARCH:-amd64}" = "amd64" ]; then \
      apk add --no-cache libva libva-utils libva-intel-driver intel-media-driver mesa-va-gallium \
        || apk add --no-cache libva libva-utils libva-intel-driver \
        || echo "VA-API drivers unavailable; hardware encoding will report itself as unusable"; \
    fi \
    && rm -rf /var/cache/apk/*

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json ./package.json
COPY server/src ./src
COPY server/public ./public

ARG VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${VERSION} \
    DATA_DIR=/data \
    LOG_DIR=/data/logs \
    PORT=3000

RUN mkdir -p /data/logs && chown -R node:node /data /app

COPY server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/healthz || exit 1

LABEL org.opencontainers.image.title="Stream Composer" \
      org.opencontainers.image.description="Dynamic multi-stream grid compositor with a web UI, built on MediaMTX and ffmpeg" \
      org.opencontainers.image.source="https://github.com/Slicit/stream-composer" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]

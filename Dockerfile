# Secure Workspace Hub — cross-platform image
# Works on Windows Server (Docker Desktop / WSL2), Linux, macOS, Raspberry Pi (arm64)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build || echo "no build step"

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    SWH_SCANNER=${SWH_SCANNER:-noop}

# tini for proper PID 1 signal handling (cross-OS via Docker)
RUN apk add --no-cache tini ca-certificates tzdata && \
    addgroup -S swh && adduser -S swh -G swh && \
    mkdir -p /data/files /data/db && chown -R swh:swh /data

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app .
RUN chown -R swh:swh /app

USER swh
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/v1/health || exit 1

ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","index.js"]

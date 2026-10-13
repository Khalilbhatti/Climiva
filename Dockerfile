# syntax=docker/dockerfile:1
#
# Images for the Climvia web app. PostgreSQL and the reverse proxy are separate containers (docker-compose.production.yml); neither is in here.
#
#   docker build -t climvia-web --build-arg APP_VERSION=$(git rev-parse --short HEAD) .      the web app (default target: runner)
#   docker build --target tools -t climvia-tools .                                          migrations and the other one-off database commands
#
# Secrets are NEVER baked into an image: nothing below copies an .env file (see .dockerignore), and the app reads its configuration from the
# environment when it starts. The image holds no uploaded file, no database dump, no test artifact and no business's sample data.
#
# Run it with docker-compose.production.yml (see docs/deployment-runbook.md), not by hand: the compose file is what gives it its database, its
# volumes, its network, its read-only filesystem and the proxy that terminates TLS.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── dependencies (cached until package*.json changes) ────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ── build: `next build` with a self-contained server output ──────────────────────────────────────────────────────
FROM deps AS build
COPY . .
ENV NEXT_OUTPUT=standalone
RUN npm run build

# ── tools: only what the one-off database commands need (migrate, status, roles, fingerprint, config check) ──────
# NODE_ENV=production here as well: the demo seed refuses to run under it, and its data (scripts/db/seed-data) is not copied in anyway.
FROM deps AS tools
ENV NODE_ENV=production
COPY tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
COPY scripts/check-config.ts ./scripts/check-config.ts
COPY scripts/deploy ./scripts/deploy
COPY scripts/db/lib.ts scripts/db/migrate.ts scripts/db/status.ts scripts/db/roles.ts scripts/db/fingerprint.ts ./scripts/db/
USER node
CMD ["npm", "run", "db:migrate"]

# ── runtime: the standalone server only, as an unprivileged user ─────────────────────────────────────────────────
FROM base AS runner
ARG APP_VERSION=development
# CLIMVIA_ENV=production is what makes the application refuse a bad configuration at start (src/lib/deployment.ts); only this image sets it.
ENV NODE_ENV=production \
    CLIMVIA_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=${APP_VERSION} \
    ASSET_LOCAL_DIR=/data/assets
LABEL org.opencontainers.image.title="climvia-web" \
      org.opencontainers.image.revision="${APP_VERSION}"
# A fixed numeric user, so a volume written by one container is owned by the same user in the next one.
RUN addgroup -g 10001 -S climvia && adduser -u 10001 -S climvia -G climvia -H -s /sbin/nologin
# Uploaded files (the business logo) when ASSET_STORAGE_DRIVER=local: a MOUNTED VOLUME, so they outlive the container. With s3 it is unused.
# The driver is deliberately not set here: production must choose (src/storage/index.ts refuses to guess).
# The directory exists, owned by the application's user, so that a NEW named volume mounted over it takes that ownership. There is deliberately no
# VOLUME instruction: it would give a container started without a mount an anonymous volume, which looks fine and is lost when the container is
# removed. Without a mount, and on a read-only filesystem, /health/ready says the storage is not usable instead.
RUN mkdir -p /data/assets && chown 10001:10001 /data/assets
COPY --from=build --chown=10001:10001 /app/.next/standalone ./
COPY --from=build --chown=10001:10001 /app/.next/static ./.next/static
# Makes `docker stop` finish the requests in progress instead of cutting them off (the standalone server does not handle SIGTERM itself).
COPY --chown=10001:10001 scripts/graceful-shutdown.cjs ./graceful-shutdown.cjs
# (There is no public/ directory: the icons are app routes. If one is ever added, copy it here too; a test fails until it is.)
USER 10001:10001
EXPOSE 3000
# "Can it serve" (configuration, database, storage), not only "is it running": see /health/ready.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health/ready || exit 1
CMD ["node", "--require", "./graceful-shutdown.cjs", "server.js"]

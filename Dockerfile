# syntax=docker/dockerfile:1
#
# Production image for the Climvia web app (one container; PostgreSQL runs separately).
#
#   docker build -t climvia-web .                                  # the web app
#   docker build --target tools -t climvia-tools .                 # migrations and other one-off database commands
#
#   docker run --rm --env-file .env.production climvia-tools       # apply database migrations (npm run db:migrate)
#   docker run -d --name climvia --env-file .env.production -p 127.0.0.1:3000:3000 climvia-web
#
# Secrets are NEVER baked into an image: nothing below copies .env files (see .dockerignore), and the app reads its
# configuration from the environment when it starts. See docs/saas-architecture.md, "Deployment".

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── dependencies (cached until package*.json changes) ────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── build: `next build` with a self-contained server output ──────────────────────────────────────────────────────
FROM deps AS build
COPY . .
ENV NEXT_OUTPUT=standalone
RUN npm run build

# ── tools: everything needed to run the db:* scripts (migrate, seed in non-production setups) ───────────────────
FROM deps AS tools
COPY . .
CMD ["npm", "run", "db:migrate"]

# ── runtime: the standalone server only, as an unprivileged user ─────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S climvia && adduser -S climvia -G climvia
COPY --from=build --chown=climvia:climvia /app/.next/standalone ./
COPY --from=build --chown=climvia:climvia /app/.next/static ./.next/static
COPY --from=build --chown=climvia:climvia /app/public ./public
USER climvia
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/login || exit 1
CMD ["node", "server.js"]

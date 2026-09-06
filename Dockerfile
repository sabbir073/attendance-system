# syntax=docker/dockerfile:1

########################
# Base
########################
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl bash curl
ENV NEXT_TELEMETRY_DISABLED=1

########################
# Dependencies
########################
FROM base AS deps
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

########################
# Build
########################
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma Client into src/generated/prisma (no DB connection needed)
RUN npx prisma generate
# Vendor the face-recognition model weights so nothing is fetched from a CDN
# at runtime. Non-fatal: the app falls back to jsDelivr if this cannot run.
RUN node scripts/fetch-face-models.mjs || true
# All DB-touching routes are force-dynamic, so no database is required at build time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV SESSION_SECRET="build-time-placeholder-secret-value-not-used-at-runtime-000000"
RUN npm run build

########################
# Runtime
########################
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app ./
RUN chmod +x ./docker/entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["./docker/entrypoint.sh"]

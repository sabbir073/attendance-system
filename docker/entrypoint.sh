#!/bin/sh
set -e

echo "==> DESCO Attendance :: container starting"

# ---------------------------------------------------------------
# 1. Wait for PostgreSQL
# ---------------------------------------------------------------
echo "==> Waiting for PostgreSQL to accept connections..."
ATTEMPT=0
until node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
" >/dev/null 2>&1; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -ge 60 ]; then
    echo "!! PostgreSQL did not become available in time. Aborting."
    exit 1
  fi
  sleep 2
done
echo "==> PostgreSQL is ready."

# ---------------------------------------------------------------
# 2. Sync schema
# ---------------------------------------------------------------
echo "==> Applying database schema (prisma db push)..."
# Note: --skip-generate was removed in Prisma 7. The client is already
# generated into src/generated/prisma during the image build.
npx prisma db push --accept-data-loss

# ---------------------------------------------------------------
# 3. Seed (idempotent — safe to run on every boot)
# ---------------------------------------------------------------
if [ "${SEED_ON_BOOT:-true}" = "true" ]; then
  echo "==> Seeding baseline data..."
  npx tsx prisma/seed.ts || echo "!! Seed step reported an error (continuing)."
fi

# ---------------------------------------------------------------
# 4. Start Next.js
# ---------------------------------------------------------------
echo "==> Starting Next.js on port ${PORT:-3000}"
exec npm run start

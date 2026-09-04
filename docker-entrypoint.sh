#!/bin/sh
set -e

echo "==> Running database migrations via Prisma..."
npx prisma migrate deploy

echo "==> Starting Real Estate Backend server..."
exec "$@"

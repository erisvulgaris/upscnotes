#!/bin/sh
set -e

# First boot: materialize the SQLite DB from the shipped seed into the
# persistent /app/data volume. Subsequent boots keep the live DB.
if [ ! -f /app/data/upscbooks.db ] && [ -f /app/seed/upscbooks.db ]; then
  echo "First boot: seeding /app/data/upscbooks.db from image seed..."
  mkdir -p /app/data
  cp /app/seed/upscbooks.db /app/data/upscbooks.db
fi

exec "$@"
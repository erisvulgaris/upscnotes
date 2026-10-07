#!/bin/sh
set -e

# First boot: materialize the SQLite DB from the shipped seed into the
# persistent /app/data volume. Subsequent boots keep the live DB.
if [ ! -f /app/data/upscnotes.db ] && [ -f /app/seed/upscnotes.db ]; then
  echo "First boot: seeding /app/data/upscnotes.db from image seed..."
  mkdir -p /app/data
  cp /app/seed/upscnotes.db /app/data/upscnotes.db
fi

exec "$@"
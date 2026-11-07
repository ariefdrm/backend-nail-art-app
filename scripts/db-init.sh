#!/bin/sh
# Runs once on first database start (mounted into /docker-entrypoint-initdb.d).
# POSTGRES_DB is created by the image; this adds the integration-test database.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "CREATE DATABASE \"${POSTGRES_DB}_test\""

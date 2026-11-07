#!/bin/sh
# Dev container entrypoint: generate the Prisma client, apply migrations, start watch mode.
set -eu

bun --bun run prisma generate
bun --bun run prisma migrate dev
exec bun run dev

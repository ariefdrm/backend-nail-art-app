#!/bin/sh
# Dev container entrypoint: generate the Prisma client, apply existing migrations, start watch mode.
#
# `migrate deploy` is used because `migrate dev` needs an interactive terminal and
# hangs/fails in a container. To create a new migration, run it yourself with a TTY:
#   docker compose -f compose.dev.yaml exec backend bun --bun run prisma migrate dev
set -eu

bun --bun run prisma generate
bun --bun run prisma migrate deploy
exec bun run dev

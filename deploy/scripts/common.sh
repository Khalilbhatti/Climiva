#!/usr/bin/env bash
# Shared by the other scripts in this directory (sourced, not run).
#
# Every script works on ONE env file (default .env.production at the repository root; override with ENV_FILE=path) and the production compose file.
# Nothing here prints a setting's value: the scripts report names, counts, sizes and checksums.
set -euo pipefail

# Git Bash on Windows rewrites arguments that look like Unix paths (-v name:/data); this stops it. Harmless elsewhere.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"

die() {
  echo "error: $*" >&2
  exit 1
}

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found (copy .env.production.example and fill it in, or set ENV_FILE=path)."
command -v docker >/dev/null 2>&1 || die "docker is not on the PATH."

# One setting from the env file, without executing the file. The last assignment wins, as in compose.
env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# The commit the images are built from (shown by /health/live): the same one in every script, so a rebuilt image is recognisable.
if [ -z "${APP_VERSION:-}" ]; then
  # (No `git -C "$ROOT"`: the shell is already in the repository, and a native git on Windows does not understand the /c/... form of the path.)
  if command -v git >/dev/null 2>&1 && git rev-parse --short HEAD >/dev/null 2>&1; then
    APP_VERSION="$(git rev-parse --short HEAD)"
  else
    APP_VERSION="local"
  fi
fi
export APP_VERSION

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

POSTGRES_DB="$(env_value POSTGRES_DB)"
POSTGRES_OWNER_USER="$(env_value POSTGRES_OWNER_USER)"
[ -n "$POSTGRES_DB" ] && [ -n "$POSTGRES_OWNER_USER" ] || die "POSTGRES_DB and POSTGRES_OWNER_USER must be set in $ENV_FILE."

# The database server's own client tools, run inside the db container over its local socket: no password is typed, passed or logged anywhere.
db_exec() {
  compose exec -T db "$@"
}

utc_stamp() {
  date -u +%Y%m%dT%H%M%SZ
}

# A name that is safe in a file path and a database name: lower case letters, digits, underscore.
safe_name() {
  case "$1" in
    "" | *[!a-z0-9_]* | [0-9]*) die "'$1' is not a valid name (lower-case letters, digits and underscore; not starting with a digit)." ;;
  esac
}

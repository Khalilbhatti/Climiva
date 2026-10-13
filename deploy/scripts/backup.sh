#!/usr/bin/env bash
# A backup of the PostgreSQL database: one custom-format dump, a checksum and a small description, written to a directory OUTSIDE the containers.
#
#   deploy/scripts/backup.sh [output-directory]        default ./backups
#
# The dump is made by pg_dump inside the database container over its local socket, so no password is typed, passed or logged. It contains every
# business's data, the schema, the Row Level Security policies, the grants to the runtime role and the functions: restoring it recreates the
# database as it was. It does NOT contain roles (they belong to the server): restore.sh provisions `climvia_app` first.
#
# It is not a backup until the dump is non-empty, readable by pg_restore and checksummed, and until it has been restored somewhere
# (deploy/scripts/restore-drill.sh does that). This script checks the first three and fails, leaving no file under the final name, if any fails.
# It NEVER deletes an older backup: retention is a decision for whoever owns the data, made somewhere else.
#
# Uploaded logos are NOT in the dump when ASSET_STORAGE_DRIVER=local; back that volume up with backup-assets.sh. In S3 mode the bucket holds them.
. "$(dirname "$0")/common.sh"

OUT="${1:-$ROOT/backups}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

safe_name "$POSTGRES_DB"
name="climvia-${POSTGRES_DB}-$(utc_stamp)"
partial="$OUT/.${name}.dump.partial"
final="$OUT/${name}.dump"
cleanup() { rm -f "$partial"; }
trap cleanup EXIT

[ -e "$final" ] && die "$final already exists; refusing to overwrite a backup."
[ "$(compose ps --format '{{.Health}}' db 2>/dev/null | head -n 1)" = "healthy" ] || die "the database container is not running and healthy."

echo "== dumping $POSTGRES_DB"
# --no-owner: the restoring role owns what it restores (owner names differ between servers); ACLs ARE kept: the grants to climvia_app are the point.
db_exec pg_dump --username "$POSTGRES_OWNER_USER" --dbname "$POSTGRES_DB" --format=custom --compress=6 --no-owner >"$partial"

[ -s "$partial" ] || die "the dump is empty."
echo "== checking the dump can be read"
db_exec sh -c 'pg_restore --list >/dev/null' <"$partial" || die "pg_restore can not read the dump."

size="$(wc -c <"$partial" | tr -d ' ')"
sum="$(sha256sum "$partial" | cut -d' ' -f1)"
server="$(db_exec psql --username "$POSTGRES_OWNER_USER" --dbname "$POSTGRES_DB" --no-psqlrc --tuples-only --no-align --command 'show server_version' | tr -d '\r')"
migrations="$(db_exec psql --username "$POSTGRES_OWNER_USER" --dbname "$POSTGRES_DB" --no-psqlrc --tuples-only --no-align --command 'select count(*) from drizzle.__drizzle_migrations' | tr -d '\r')"

mv "$partial" "$final"
printf '%s  %s\n' "$sum" "${name}.dump" >"$OUT/${name}.dump.sha256"
{
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "database=$POSTGRES_DB"
  echo "postgres_version=$server"
  echo "migrations_applied=$migrations"
  echo "app_version=$APP_VERSION"
  echo "size_bytes=$size"
  echo "sha256=$sum"
} >"$OUT/${name}.dump.meta"
trap - EXIT

echo "== backup written"
echo "   file     $final"
echo "   size     $size bytes"
echo "   sha256   $sum"

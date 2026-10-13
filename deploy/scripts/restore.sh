#!/usr/bin/env bash
# Restore a dump made by backup.sh into a database that is EMPTY or does not exist yet. It never overwrites data.
#
#   deploy/scripts/restore.sh <dump-file> [--into <database>]
#
#   --into   the database to restore into (default: POSTGRES_DB). It is created if it does not exist. If it exists it must hold no table.
#
# Two situations use it:
#   * A restore drill, or looking at an old backup: restore into a NEW name (--into climvia_check), compare with db:fingerprint, drop it.
#   * Recovery: bring up a fresh stack (`up -d db`), which creates an empty POSTGRES_DB, and restore into it; then `up -d` the rest. To replace a
#     damaged database in place, stop the app, rename or drop the damaged one yourself (the runbook says how) and restore: this script will not.
#
# Steps: verify the checksum -> make sure the runtime role exists (roles are not in a dump) -> create the database -> pg_restore in ONE transaction,
# stopping at the first error -> report. A failed restore leaves the database as it was (empty), not half restored.
. "$(dirname "$0")/common.sh"

dump="${1:-}"
[ -n "$dump" ] || die "usage: restore.sh <dump-file> [--into <database>]"
shift
target="$POSTGRES_DB"
while [ $# -gt 0 ]; do
  case "$1" in
    --into) target="${2:-}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
safe_name "$target"
[ -f "$dump" ] || die "$dump not found."
[ -s "$dump" ] || die "$dump is empty."

echo "== verifying the checksum"
sumfile="$dump.sha256"
[ -f "$sumfile" ] || die "$sumfile not found: a dump without its checksum is not restored."
expected="$(cut -d' ' -f1 "$sumfile")"
actual="$(sha256sum "$dump" | cut -d' ' -f1)"
[ "$expected" = "$actual" ] || die "the checksum does not match: the file is damaged or was changed."

[ "$(compose ps --format '{{.Health}}' db 2>/dev/null | head -n 1)" = "healthy" ] || die "the database container is not running and healthy (docker compose up -d db)."

psql_owner() {
  db_exec psql --username "$POSTGRES_OWNER_USER" --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 "$@"
}

echo "== making sure the runtime role exists"
compose run --rm migrate npm run --silent db:roles

echo "== preparing $target"
exists="$(psql_owner --dbname postgres --command "select 1 from pg_database where datname = '$target'" | tr -d '\r')"
if [ -z "$exists" ]; then
  psql_owner --dbname postgres --command "create database \"$target\"" >/dev/null
else
  tables="$(psql_owner --dbname "$target" --command "select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')" | tr -d '\r')"
  [ "$tables" = "0" ] || die "database '$target' already holds $tables tables; a restore never overwrites."
fi

echo "== restoring into $target"
if ! db_exec pg_restore --username "$POSTGRES_OWNER_USER" --dbname "$target" --single-transaction --exit-on-error --no-owner <"$dump"; then
  die "pg_restore failed; '$target' was not changed by it (single transaction)."
fi

echo "== restored"
echo "   database $target"
echo "   from     $(basename "$dump")"
echo "   next:    compare with the source:  compose run --rm migrate npm run db:fingerprint -- $target"

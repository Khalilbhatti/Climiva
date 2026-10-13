#!/usr/bin/env bash
# The proof that a backup is a backup: take one, restore it into a CLEAN database beside the real one, and show the two hold the same data.
#
#   deploy/scripts/restore-drill.sh [dump-file]       without an argument it makes a fresh backup first
#
# The comparison is db:fingerprint --compare (every table's row count and an md5 of all its rows). The scratch database is named
# <POSTGRES_DB>_drill and is dropped at the end; the real database is only read. Exit 0 only if every table matches. Tables the running application
# keeps changing (sessions, rate limits) can differ if someone signed in during the drill: stop the app first for an exact comparison, or read the
# differences it prints.
. "$(dirname "$0")/common.sh"

drill="${POSTGRES_DB}_drill"
safe_name "$drill"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

dump="${1:-}"
if [ -z "$dump" ]; then
  # The drill's own backup is kept (under ./backups): a backup that was just proven restorable is worth keeping.
  "$(dirname "$0")/backup.sh" | tee "$work/backup.log"
  dump="$(sed -n 's/^   file     //p' "$work/backup.log")"
fi

echo "== restoring into $drill"
db_exec psql --username "$POSTGRES_OWNER_USER" --dbname postgres --no-psqlrc --command "drop database if exists \"$drill\" with (force)" >/dev/null
"$(dirname "$0")/restore.sh" "$dump" --into "$drill"

echo "== comparing $POSTGRES_DB with $drill"
result=0
compose run --rm migrate npm run --silent db:fingerprint -- --compare "$POSTGRES_DB" "$drill" || result=$?

echo "== dropping $drill"
db_exec psql --username "$POSTGRES_OWNER_USER" --dbname postgres --no-psqlrc --command "drop database if exists \"$drill\" with (force)" >/dev/null

if [ "$result" = "0" ]; then echo "== restore drill PASSED"; else echo "== restore drill FAILED"; fi
exit "$result"

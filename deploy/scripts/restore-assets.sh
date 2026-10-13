#!/usr/bin/env bash
# Restore an archive made by backup-assets.sh into a volume that is EMPTY (or does not exist yet). It never overwrites files.
#
#   deploy/scripts/restore-assets.sh <archive.assets.tar.gz> [--volume <name>]       default volume: <compose project>_assets
#
# After restoring into the real volume, the files are owned by the application's user (10001) so the app can read and write them.
. "$(dirname "$0")/common.sh"

archive="${1:-}"
[ -n "$archive" ] || die "usage: restore-assets.sh <archive> [--volume <name>]"
shift
volume=""
while [ $# -gt 0 ]; do
  case "$1" in
    --volume) volume="${2:-}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -s "$archive" ] || die "$archive not found or empty."
[ -f "$archive.sha256" ] || die "$archive.sha256 not found: an archive without its checksum is not restored."
[ "$(cut -d' ' -f1 "$archive.sha256")" = "$(sha256sum "$archive" | cut -d' ' -f1)" ] || die "the checksum does not match."

if [ -z "$volume" ]; then
  project="$(compose config --format json | sed -n 's/^  "name": *"\([^"]*\)".*/\1/p' | head -n 1)"
  volume="${project}_assets"
fi
docker volume create "$volume" >/dev/null
existing="$(docker run --rm -v "$volume:/data" alpine:3 sh -c 'find /data -type f | wc -l' | tr -d ' \r')"
[ "$existing" = "0" ] || die "volume $volume already holds $existing files; a restore never overwrites."

archive_dir="$(cd "$(dirname "$archive")" && pwd)"
docker run --rm -v "$volume:/data" -v "$archive_dir:/backup:ro" alpine:3 sh -c "cd /data && tar xzf /backup/$(basename "$archive") && chown -R 10001:10001 /data"
restored="$(docker run --rm -v "$volume:/data:ro" alpine:3 sh -c 'find /data -type f | wc -l' | tr -d ' \r')"
echo "== restored $restored files into $volume"

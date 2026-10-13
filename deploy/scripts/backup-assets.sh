#!/usr/bin/env bash
# A backup of the uploaded files (logos) kept in the `assets` volume when ASSET_STORAGE_DRIVER=local: one .tar.gz, a checksum and a file count.
#
#   deploy/scripts/backup-assets.sh [output-directory]       default ./backups
#
# The database dump does not hold these files, only their metadata, so a backup of one without the other restores a business whose logo is missing.
# Back both up at the same time. In S3 mode there is nothing to back up here: the files are in the bucket (versioning and a replica or copy are what
# protect them; S3's durability is not a backup). The volume is mounted READ-ONLY by a throwaway container; the application keeps running.
# It never deletes an older backup.
. "$(dirname "$0")/common.sh"

OUT="${1:-$ROOT/backups}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

project="$(compose config --format json | sed -n 's/^  "name": *"\([^"]*\)".*/\1/p' | head -n 1)"
[ -n "$project" ] || die "can not tell the compose project's name."
volume="${project}_assets"
docker volume inspect "$volume" >/dev/null 2>&1 || die "volume $volume does not exist."

name="climvia-assets-$(utc_stamp)"
partial="$OUT/.${name}.assets.tar.gz.partial"
final="$OUT/${name}.assets.tar.gz"
trap 'rm -f "$partial"' EXIT
[ -e "$final" ] && die "$final already exists; refusing to overwrite a backup."

echo "== archiving $volume"
docker run --rm -v "$volume:/data:ro" alpine:3 sh -c 'cd /data && tar czf - .' >"$partial"
[ -s "$partial" ] || die "the archive is empty."
files="$(docker run --rm -v "$volume:/data:ro" alpine:3 sh -c 'find /data -type f | wc -l' | tr -d ' \r')"
tar tzf "$partial" >/dev/null || die "the archive can not be read back."

mv "$partial" "$final"
sum="$(sha256sum "$final" | cut -d' ' -f1)"
printf '%s  %s\n' "$sum" "${name}.assets.tar.gz" >"$final.sha256"
trap - EXIT

echo "== assets backup written"
echo "   file     $final"
echo "   files    $files"
echo "   sha256   $sum"

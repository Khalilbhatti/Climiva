#!/usr/bin/env bash
# Is the running stack in the state a deployment promises? Read-only: it changes nothing.
#
#   deploy/scripts/verify.sh
#
# Checks: every long-running service is healthy; the database's migrations are current; the application says it is ready, through the proxy, over
# https, with the Host the browser would send; the proxy does not pass /internal/* on; nothing but the proxy publishes a port.
. "$(dirname "$0")/common.sh"

fail=0
check() {
  if "${@:2}" >/dev/null 2>&1; then echo "ok    $1"; else echo "FAIL  $1"; fail=1; fi
}

public_host="$(env_value PUBLIC_HOST)"
https_port="$(env_value HTTPS_PORT)"
https_port="${https_port:-443}"

for service in db app proxy; do
  check "$service is healthy" test "$(compose ps --format '{{.Health}}' "$service" 2>/dev/null | head -n 1)" = "healthy"
done
check "migrations are current" compose run --rm migrate npm run --silent db:status

# -k: a local trial's certificates come from Caddy's own CA; a real deployment's are verified by the system store.
curl_args=(--silent --show-error --max-time 10 --resolve "$public_host:$https_port:127.0.0.1")
[ "$(env_value CADDY_MODE_FILE)" = "./deploy/caddy/mode.local.caddy" ] && curl_args+=(--insecure)
check "ready through the proxy" curl "${curl_args[@]}" --fail "https://$public_host:$https_port/health/ready"
check "/internal is not reachable from outside" test "$(curl "${curl_args[@]}" --output /dev/null --write-out '%{http_code}' "https://$public_host:$https_port/internal/tls-allow")" = "404"

published="$(docker ps --filter "label=com.docker.compose.project=$(compose config --format json | sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' | head -n 1)" --format '{{.Names}} {{.Ports}}' | grep -E '0\.0\.0\.0|\[::\]' | grep -vE '^[^ ]*proxy' || true)"
check "only the proxy publishes a port" test -z "$published"

exit "$fail"

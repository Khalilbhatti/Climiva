#!/usr/bin/env bash
# Build the images, check the configuration, migrate the database, start (or update) the stack, and check it came up.
#
#   deploy/scripts/deploy.sh            ENV_FILE=.env.production by default
#
# The order matters and is the same every time:
#   1. build the images from the working tree (the version is the git commit)
#   2. check the env file with the application's own rules and the deployment file's, in the tools image, with the file mounted read-only
#   3. start PostgreSQL and wait until it is healthy (nothing else is touched yet)
#   4. run the migration ON ITS OWN. If it fails the script stops here, and the application that is running is the one that was running: compose
#      would otherwise replace the app container first and start it only after the migration, leaving it down on a failed one
#   5. `up --wait`: replace what changed (the app, if its image did), start the rest, and wait until the services are healthy
#   6. verify.sh: migrations current, the app ready through the proxy, /internal not reachable, only the proxy publishing a port
#
# Because step 4 runs before the old application is replaced, a migration must work for the version that is still running for the next few
# seconds: add columns and tables in one release, remove what nothing uses any more in a later one.
#
# It never seeds data, never deletes a volume and never prints a secret.
. "$(dirname "$0")/common.sh"

echo "== version $APP_VERSION"

echo "== building images"
compose build

echo "== checking $ENV_FILE"
compose run --rm --no-deps -v "$ROOT/$ENV_FILE:/app/.env.deploy-check:ro" migrate npm run --silent config:check -- /app/.env.deploy-check

echo "== database"
compose up -d --wait db

echo "== migrating (the running application is not touched until this succeeds)"
compose run --rm migrate

echo "== starting the stack"
compose up -d --wait --remove-orphans

echo "== migrations"
compose run --rm migrate npm run --silent db:status

"$(dirname "$0")/verify.sh"

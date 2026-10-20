# Deployment runbook

How to run, check, back up, restore and recover the production-shaped stack (reverse proxy + web app + PostgreSQL). It is the operator's page; why the stack is shaped this way, and what was proved, is `docs/saas-architecture.md` §35. Everything here was run against real containers in Phase 18C1 except what is marked **not yet exercised** (public certificates, real DNS, AWS), which is Phase 18C2.

All commands run from the repository root on a host with Docker (Compose v2+). The scripts are bash; on Windows use Git Bash. They read one env file (`ENV_FILE`, default `.env.production`) and never print a setting's value.

## 1. First time

```bash
cp .env.production.example .env.production      # git-ignored; holds secrets
$EDITOR .env.production                          # replace every placeholder (the comments say how to generate each)
npm run config:check -- .env.production          # needs Node; or let deploy.sh run it inside the tools image
deploy/scripts/deploy.sh
```

`config:check` applies the application's own start-up rules to exactly what the app container will receive, plus the rules for the rest of the file. It must pass; the application refuses to start on the same rules anyway, but this finds the problem in seconds with a list instead of in a crash log.

Generate secrets yourself (`openssl rand -hex 24` for the passwords and `TLS_ASK_TOKEN`; `openssl rand -base64 32` for `BETTER_AUTH_SECRET`). Do not paste them anywhere else. On AWS they will come from Secrets Manager / SSM Parameter Store onto the instance; no long-lived AWS access key belongs in this file or in any image.

A new stack has **no business in it**: the first person to sign up creates theirs. Nothing seeds data; `db:seed`, `db:reset` and `db:test:prepare` refuse under the image's `CLIMVIA_ENV=production`, and the sample data is not in the images.

## 2. What `deploy.sh` does, and every later deploy

```
build images → check the env file → start the database → run the migration ON ITS OWN → up --wait → verify
```

The migration runs before the app container is replaced. If it fails the script stops there and the running app is untouched (still the old version, still ready). So a migration has to work for the version that is still running for a few seconds: add columns and tables in one release, remove what nothing uses in a later one.

`deploy/scripts/verify.sh` (also the last step) checks: the three long-running services are healthy, the migrations are current, `/health/ready` answers through the proxy over https, `/internal/...` is not reachable from outside, and nothing but the proxy publishes a port. It changes nothing.

Version: the images are tagged with the git commit (`APP_VERSION`); `curl https://<host>/health/live` shows which build is running.

## 3. Everyday commands

```bash
C="docker compose -f docker-compose.production.yml --env-file .env.production"
$C ps                                   # state and health
$C logs -f app                          # also: proxy, db, migrate
$C restart app                          # restart one service (data and certificates are on volumes)
$C stop app && $C start app             # graceful: in-flight requests finish, exit 0
$C run --rm migrate npm run db:status   # are the database's migrations current? (exit 0 yes, 1 behind/ahead, 2 never migrated)
$C down                                 # stop and remove containers; volumes stay
```

The proxy's access log never records a review link's secret: `/review/<secret>` is written as `/review/REDACTED`, in the request address and in a `Referer` that carries it (`deploy/caddy/Caddyfile`, `(access_log)`). After changing that file, run `$C exec proxy caddy validate --config /etc/caddy/Caddyfile` before restarting the proxy.

**Never** `down -v`, `docker volume rm` or `docker system prune --volumes` on a host that holds real data: they delete the database, the uploaded logos and the certificates. No script here does.

Health: `/health/live` says the process runs; `/health/ready` also needs the configuration, the database (through a public function, so an unmigrated database is not ready) and the file storage. Not ready returns 503 with three words saying which part (`config`, `database`, `storage`) and nothing else; the reason is in `$C logs app` (`[health] not ready: database`). A stopped database makes the app *not ready* but not dead, and it recovers by itself when the database returns.

## 4. Backups

```bash
deploy/scripts/backup.sh [dir]           # the database: one .dump + .sha256 + .meta, default ./backups
deploy/scripts/backup-assets.sh [dir]    # uploaded logos (ASSET_STORAGE_DRIVER=local only): .assets.tar.gz + .sha256
```

Take both at the same time (the dump holds the logos' metadata, not their bytes). Both refuse to overwrite and never delete an older backup; retention is yours. **Copy them off the machine**: a backup on the disk that fails is not a backup. In S3 mode the bucket holds the files: turn on versioning and keep a copy elsewhere (S3's durability is not a backup). An EBS snapshot protects the instance's disk but is not by itself a database backup.

**A backup is proved only by restoring it.** Do this regularly:

```bash
deploy/scripts/restore-drill.sh [dump]   # restore into <db>_drill beside the real one, compare every table, drop the copy
```

It prints `N tables compared, 0 differences` and `restore drill PASSED`, or the tables that differ. The comparison is a row count and an md5 of all rows per table (`npm run db:fingerprint`), so it needs the app quiet for an exact result; sessions and rate limits can differ if people are signing in.

## 5. Restoring (disaster recovery)

```bash
deploy/scripts/restore.sh backups/<name>.dump [--into <database>]
```

It verifies the checksum, makes sure the `climvia_app` role exists (roles are not in a dump), and restores in one transaction that stops at the first error, into a database that is **empty or does not exist**. It never overwrites.

On a fresh host:

```bash
cp <your saved> .env.production && npm run config:check -- .env.production
$C up -d db                                        # creates an empty database
deploy/scripts/restore.sh backups/<name>.dump      # restores into it (into POSTGRES_DB)
deploy/scripts/restore-assets.sh backups/<name>.assets.tar.gz   # an empty assets volume
deploy/scripts/deploy.sh                           # migrations (a no-op if the dump is current), then everything else
```

To replace a damaged database in place: stop the app, rename or drop the damaged one yourself (`$C exec db psql -U <owner> -d postgres -c 'alter database "<db>" rename to "<db>_damaged"'`), restore into the now-absent name, start the app. The script will not do the destructive step for you.

## 6. Customers' domains

A business adds its domain in the Workspace (Website → Domain), publishes the TXT record, verifies and activates. The proxy then obtains a certificate for that name **on demand, and only for it**: before requesting, Caddy asks the application `/internal/tls-allow`, which says yes only for an *active* domain of a *published* site. Pointing any other name at the server gets no certificate and no handshake. The customer's DNS must point at `CUSTOM_DOMAIN_TARGET`, which must reach this host on 80 and 443. **Not yet exercised with public certificates and real DNS** (Phase 18C2); the mechanics are proved with Caddy's own CA.

## 7. A local trial of the whole stack

```bash
# a git-ignored env file with local values: a made-up name, host ports that are free, and Caddy's own certificate authority
#   PUBLIC_HOST=app.climvia-trial.test   BETTER_AUTH_URL=https://app.climvia-trial.test:8443   HTTPS_PORT=8443   HTTP_PORT=8080
#   CADDY_MODE_FILE=./deploy/caddy/mode.local.caddy   COMPOSE_PROJECT_NAME=climvia-trial
ENV_FILE=.env.trial deploy/scripts/deploy.sh
curl -k --resolve app.climvia-trial.test:8443:127.0.0.1 https://app.climvia-trial.test:8443/health/ready
npm run test:docker                      # the Docker-side suite; against a stack whose database is new (down -v on the TRIAL project only)
```

The local mode requests nothing from a public certificate authority. Its certificates are not trusted by a browser (use `-k` or `--cacert`).

## 8. When something is wrong

| Symptom | Look at | Likely cause |
| --- | --- | --- |
| `deploy.sh` stops at "checking" | its output | the env file; every line names a setting and the rule, never the value |
| `deploy.sh` stops at "migrating" | `$C logs migrate` | a failing migration or a wrong owner password; the old app is still running |
| app container exits at once | `$C logs app` | "The production configuration is not fit to start with": the same list as `config:check` |
| `/health/ready` is 503 | `curl .../health/ready`, then `$C logs app` | `database` (is `db` healthy? migrations current?), `storage` (the assets volume mounted?), `config` |
| the site loads on the platform address but a customer's name does not | the Domain Manager; `$C logs proxy` | the domain is not *active*, the Site is not published, DNS does not reach this host, or the permission answered no |
| a browser says the certificate is not trusted | the proxy mode | `mode.local.caddy` (a trial) is in use; a deployment must use `mode.public.caddy` |
| `The destination stream closed early` in the app log | | a browser or the proxy hung up mid-render (React's cancel). Harmless unless it comes with 5xx responses; see §35 |
| sign-in is rate-limited for everyone | `AUTH_TRUSTED_PROXIES` | it must list the proxy network (`EDGE_SUBNET`), or every client looks like the proxy |
| a person who should be a platform administrator sees "not found" at `/platform-admin` | `$C run --rm migrate npm run platform-admin:list` | they were never granted, or were revoked, or signed in with a different account than the one granted (§9) |

## 9. The platform console and its first administrator

Climvia's own console is at `/platform-admin` (saas-architecture §36). **A new deployment has no platform administrator**: public signup never makes one, and nothing seeds one. An operator grants the first, **after that person has signed up like anyone else** (the grant refuses an address that has no account and never creates one):

```bash
C="docker compose -f docker-compose.production.yml --env-file .env.production"
$C run --rm migrate npm run platform-admin:grant  -- --email <the address they signed up with>
$C run --rm migrate npm run platform-admin:list                       # who is an administrator now
$C run --rm migrate npm run platform-admin:revoke -- --email <address>  # takes it away; the account and its businesses stay
```

Then they sign in at `https://<host>/platform-admin/login` with their ordinary account. Notes:

- Granting is the only way, and needs the **database owner's credential** (`DATABASE_ADMIN_URL`, which the `migrate` service holds and the app does not). It is idempotent, safe to repeat, and each grant and revoke is written to the audit trail (shown on the console's System page) with the operator's machine user name.
- Revoking takes effect on the person's next request. Keep at least two administrators when you can; if the last is revoked the tool says so, and an operator can grant again the same way.
- **Platform super administrator is not Organization owner.** Being the owner of a business gives no console access, and an administrator has no access to a business's workspace.
- Do not put a real address in a script, an env file or a note that is committed. The commands take it on the command line each time.
- The console is not linked from any page, is `noindex`, and does not exist on a customer's domain.

## 10. Not covered here (Phase 18C2)

Creating the instance, its IAM role and security group, DNS, public certificates, Secrets Manager/SSM, off-instance backup storage and its schedule, log collection and alarms, and CI/CD. A single instance is not highly available: the host, the Docker daemon, the one database and the one proxy are each a single point of failure.

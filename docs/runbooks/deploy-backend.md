# Deploying the backend to EC2

How the Komtru API and worker run on an EC2 instance, how to release to one, and the things that
bit us the first time. Scripts live in [`scripts/deploy/`](../../scripts/deploy/).

## What is running today

Two hosts, same shape, different databases.

|          | staging                               | production                              |
| -------- | ------------------------------------- | --------------------------------------- |
| Hostname | `staging-api.komtru.com`              | `api.komtru.com`                        |
| Instance | t3.large, Ubuntu 24.04, **us-west-1** | t2.medium, Amazon Linux 2023, us-east-1 |
| Disk     | 8 GB root volume                      | 30 GB root volume                       |
| Database | `komtru_v2_dev`                       | `komtru_v2_prod`                        |
| Login    | `ubuntu`                              | `ec2-user`                              |

Everything else is the same on both: `komtru-api` and `komtru-worker` under PM2 as the `komtru`
service account; Apache in front with a Let's Encrypt certificate and `:80` redirecting to `:443`;
Redis on the box bound to `127.0.0.1`, append-only, `noeviction`; code in `/srv/komtru/app`;
secrets in `/srv/komtru/.env.backend`, mode 0600, owned by `komtru`.

`NODE_ENV` is `development` on **both**, and that is deliberate — see
[Why this host is not NODE_ENV=production](#why-this-host-is-not-node_envproduction). It applies
to the production host too, and is the main thing to fix before real customers arrive.

### Three things about this pair that will surprise you

**They share one Postgres instance, and therefore one `komtru_app` role.** Postgres roles are
cluster-wide. The migrator does `ALTER ROLE komtru_app LOGIN PASSWORD ...` on every run, so the two
hosts must carry the _same_ `POSTGRES_APP_PASSWORD` — give production a different one and the next
deploy on either host locks the other out. Separating them needs a second RDS instance, or making
`RUNTIME_ROLE` configurable.

**That RDS instance is not Komtru's.** It also hosts several unrelated projects, the largest 17 GB.
Treat it as shared infrastructure.

**Staging is in the wrong region.** The database is in us-east-1 and the staging host is in
us-west-1, so every query it makes crosses the country. Production is in us-east-1 with the
database, which is one reason it is the faster of the two despite being the smaller instance.

## One-time: bootstrap

The script runs on Ubuntu and on Amazon Linux 2023. Four differences between them are handled in
the script and are each worth knowing, because every one of them stopped the bootstrap dead the
first time it met Amazon Linux:

- **`curl` conflicts.** Amazon Linux ships `curl-minimal`, which provides a working `/usr/bin/curl`
  but conflicts with the full `curl` package. Naming curl unconditionally makes dnf print several
  hundred lines of conflict and install nothing, so it is only requested when actually missing.
- **Different names for the same things.** `redis-server` vs `redis6`, `apache2` vs `httpd`, and no
  `a2enmod`/`a2ensite` at all — httpd includes every `conf.d/*.conf` instead.
- **`${APACHE_LOG_DIR}`** is set by Debian's `envvars` and does not exist elsewhere; the vhost
  template takes a substituted `__LOG_DIR__` instead.
- **mod_ssl's stub certificate.** Its shipped `ssl.conf` points at `/etc/pki/tls/certs/localhost.crt`,
  which the image does not generate, and Apache refuses to start without it — before certbot has
  ever run, so before there is a real certificate to replace it with. The script generates it.

And one trap that is not a distribution difference at all: **certbot says it scheduled renewal even
when nothing will run it.** Amazon Linux ships `certbot-renew.timer` disabled and has no cron daemon,
so the certificate would quietly expire ninety days later. The script enables the timer and installs
a deploy hook that reloads the web server, because certbot writes the new certificate but leaves the
running server holding the old one.

```bash
sudo bash scripts/deploy/bootstrap-ec2.sh
```

Installs Node 22, pnpm 10.18.2, PM2, Apache with the proxy modules, Redis; creates the `komtru`
account and `/srv/komtru`; downloads the RDS CA bundle; writes the vhost; requests a
certificate; and registers PM2 with systemd. Idempotent, and it installs no secrets.

Then write `/srv/komtru/.env.backend` (0600, owned by `komtru`). Start from
[`apps/backend-api/.env.example`](../../apps/backend-api/.env.example). The values that must
differ from the example:

| Variable                                                       | Value here                                | Why                                                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                                                         | `7813`                                    | Must match `API_PORT` in `deploy.conf` and the vhost.                                                                                      |
| `LOG_FORMAT` / `LOG_COLOR`                                     | `json` / `false`                          | Log aggregators cannot read ANSI escapes.                                                                                                  |
| `TRUST_PROXY_HOPS`                                             | `1`                                       | One Apache in front. Add an ALB and this and the vhost rise together, or the rate limiter buckets every request under the proxy's address. |
| `POSTGRES_URL`, `POSTGRES_DIRECT_URL`                          | the RDS endpoints                         | Runtime uses the restricted `komtru_app` role; migrations use the owner.                                                                   |
| `POSTGRES_SSL`                                                 | `true`                                    | RDS requires it.                                                                                                                           |
| `POSTGRES_CA_CERT`                                             | `/srv/komtru/certs/rds-global-bundle.pem` | A **path to a PEM file**, not PEM content. See below.                                                                                      |
| `REDIS_URL`                                                    | `redis://127.0.0.1:6379`                  | The distribution default port, not the 56379 that `docker-compose.yml` uses locally.                                                       |
| `ALLOWED_ORIGINS`, `SOCKET_CORS_ORIGINS`                       | the real app origins                      | No `localhost` entries.                                                                                                                    |
| `IDENTITY_TOKEN_ISSUER`                                        | `https://staging-api.komtru.com`          | Tokens are validated against it; a stale issuer rejects every session.                                                                     |
| `MAILJET_SANDBOX`, `NOTIFY_SMS_DRY_RUN`, `NOTIFY_PUSH_DRY_RUN` | `true` on staging                         | See [Live-fire defaults](#live-fire-defaults).                                                                                             |

## Every release

While there is no git remote, a release is two commands from a workstation:

```bash
scripts/deploy/push.sh ubuntu@staging-api.komtru.com ~/.ssh/komtru-ec2
ssh ubuntu@staging-api.komtru.com 'sudo -u komtru bash /srv/komtru/app/scripts/deploy/deploy.sh'
```

Once `Komtru/komtru-monorepo` exists, set `APP_SOURCE=git` and `REPO_URL` in
`/srv/komtru/deploy.conf` and `deploy.sh` fetches instead; `push.sh` can then be deleted.

`deploy.sh` installs, builds, migrates, reloads both processes and polls `/health/ready` until
the API answers. The order matters:

- **build before migrate** — a release that cannot compile must not change the schema;
- **migrate before reload** — the new code may need the new columns, and the old code tolerates
  them, because `tools/migration-safety` enforces expand/contract on every pull request;
- **health check after reload** — `pm2 reload` returning 0 proves only that PM2 forked something.

## Checking on it

```bash
curl https://staging-api.komtru.com/health/ready     # {"status":"ok","checks":{...}}
sudo -u komtru PM2_HOME=/srv/komtru/.pm2 pm2 list
sudo -u komtru PM2_HOME=/srv/komtru/.pm2 pm2 logs komtru-api --lines 100
sudo tail -f /var/log/apache2/komtru-api.error.log
```

Logs also land in `/srv/komtru/logs/{api,worker}.{out,err}.log`.

## Log rotation and swap

PM2 does not rotate its own logs, and Ubuntu's `rsyslog` entry rotates on a schedule with no
size ceiling. Between them they filled this host's 8 GB volume to 100% once already — a single
651 MB PM2 error log plus 250 MB of syslog. Both are now capped:

| What                       | Config                                                     | Policy                                                |
| -------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| PM2 logs                   | `/etc/logrotate.d/komtru`                                  | daily, keep 7, **or sooner at 50 MB**, `copytruncate` |
| syslog, kern.log, auth.log | `maxsize` added to the distro's `/etc/logrotate.d/rsyslog` | weekly, keep 4, **or sooner at 50 MB**                |
| Apache                     | Ubuntu's `/etc/logrotate.d/apache2`                        | unchanged                                             |

`copytruncate` rather than `create` is deliberate: PM2 holds those files open and writes by
descriptor, so renaming one out from under it would leave PM2 appending to an unlinked inode —
the log would look like it stopped while the disk kept filling invisibly.

The `maxsize` ceiling goes **into** the distribution's rsyslog entry rather than into a second
config file. logrotate refuses to run at all if a file is claimed by two definitions, so adding
`/var/log/syslog` in a file of our own breaks rotation for everything.

Rotation runs from `logrotate.timer`, a systemd timer, not from crontab:

```bash
systemctl list-timers logrotate.timer     # next run
sudo logrotate --debug /etc/logrotate.conf  # validate without rotating
sudo logrotate --force /etc/logrotate.d/komtru  # rotate now
```

**Swap** is a 1 GiB `/swapfile`, in `/etc/fstab`, with `vm.swappiness=10` and
`vm.vfs_cache_pressure=50` in `/etc/sysctl.d/99-komtru-swap.conf`. It exists so a `tsc` spike
during a deploy cannot OOM, not as a memory extension — with 7.6 GB of RAM the kernel should
not be moving warm pages onto a volume this small. `SWAP_SIZE_MB` in `deploy.conf` controls it,
and `bootstrap-ec2.sh` refuses to create one that would leave the disk under 1 GB free.

## Five things that cost time the first time

**`POSTGRES_CA_CERT` is a path, not a certificate.** It names a PEM file on disk. Point it at a
path that does not exist and the migrator fails with `PostgresCaError` before opening a
connection. `bootstrap-ec2.sh` downloads Amazon's bundle to `/srv/komtru/certs/`.

**Anything in PM2's `env` block silently beats `.env.backend`.** Node's `--env-file` does _not_
override a variable already present in the inherited environment. A `NODE_ENV: 'production'` in
`ecosystem.config.cjs` therefore won over the env file, and the only symptom was
`invalid: TRUST_KYC_PROVIDER` in a crash loop. The config now sets no `env` at all.

**PM2 spawns its daemon with the current working directory.** Start it from a directory the
service account cannot read — `/home/ubuntu` is 0750 — and it dies with
`spawn /usr/bin/node EACCES`, which says nothing about directories. `deploy.sh` `cd`s to
`$APP_DIR` before touching PM2.

**`PM2_HOME` must be explicit.** PM2 derives it from `$HOME`, `sudo -u` does not reliably carry
`HOME`, and the fallback puts `dump.pm2` in `/tmp` — erased on reboot, so `pm2 resurrect`
restores nothing. It is set in `deploy.conf` and exported by `deploy.sh`.

**certbot copies the vhost verbatim.** It generates the `:443` block from the `:80` one, so a
hardcoded `RequestHeader set X-Forwarded-Proto "http"` would tell the app that every TLS request
arrived in plaintext. The template uses `expr=%{REQUEST_SCHEME}`, which is right in both.

## Why this host is not `NODE_ENV=production`

[`env.ts`](../../apps/backend-api/src/config/env.ts) rejects `TRUST_KYC_PROVIDER=FAKE` when
`NODE_ENV=production` — the fake adapter grants `IDENTITY_VERIFIED` on the strength of a
trailing digit, and a production box that falls back to it quietly is a platform whose verified
sellers were verified by nobody. Selecting `DOJAH` instead needs `DOJAH_APP_ID`,
`DOJAH_SECRET_KEY` and `DOJAH_BASE_URL`, none of which exist yet.

So this host runs `development` with every production-shaped value set explicitly. Before a real
production deployment: obtain Dojah credentials, set `TRUST_KYC_PROVIDER=DOJAH`, and only then
`NODE_ENV=production`.

## Live-fire defaults

`NOTIFY_SMS_DRY_RUN` and `NOTIFY_PUSH_DRY_RUN` default to `false` when `NODE_ENV=production`,
and the Termii, Mailjet and Paystack keys in use are the live ones. A production boot with
seeded users can therefore text and email real people on its first run. Both flags and
`MAILJET_SANDBOX` are pinned `true` on this host; flip them deliberately, one at a time, once
you have watched a dry run do the right thing.

## Rolling back

With `APP_SOURCE=git`, `deploy.sh` prints the previous commit and you redeploy it:

```bash
sudo -u komtru REPO_REF=<previous-sha> bash /srv/komtru/app/scripts/deploy/deploy.sh
```

With `APP_SOURCE=rsync` there is no previous revision on the host — check out the older commit
locally and push again. That asymmetry is the main reason to get the repository onto a remote.

Either way this rolls back **code only**. Migrations are not reversed, and must not be: the
safety tool keeps every migration backwards-compatible with the release before it, which is what
makes a code-only rollback correct. A migration that genuinely has to be undone is a new forward
migration.

## Backups

Postgres is RDS — use automated snapshots and set the retention window there. Redis holds BullMQ
job state with `appendonly yes`, so a restart keeps the queue, but the AOF lives on the instance
volume only. Nothing on this host is backed up by these scripts.

## Known gaps

- **8 GB root volume, ~1.4 GB free** after a build and the swapfile. This is the binding
  constraint on everything: swap is 1 GiB rather than 2 for this reason alone. Grow it.
- **The API binds `0.0.0.0:7813`.** The security group does not expose it, which is the only
  thing keeping it private. There is no bind-address setting in the config today.
- **No CI deploy.** `.github/workflows/backend-api.yml` still has the T-005 placeholder step.
- **This host was compromised** before Komtru was installed on it — a root-level cryptominer ran
  from December 2025 until it was removed on 18 November 2026. The persistence was deleted and
  the box rebuilt in place rather than replaced, by the owner's decision. A sample of the
  malware's syslog output is kept at `/srv/komtru/backups/malware-syslog-sample.txt.gz`.

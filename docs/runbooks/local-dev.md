# Local development

How to run Komtru's backing services on your machine and give the backend its credentials.

## Prerequisites

- Docker Desktop running
- Node 22 and pnpm 10, then `pnpm install` at the repository root
- The old backend's `.env`, saved as `docs/specs/backend-apis.env` in the main checkout. It holds live credentials and is git-ignored; ask the project owner for it. Never commit it, paste it into a ticket, or print it in logs.

## Start and stop the services

```bash
pnpm infra:up      # start Postgres, PgBouncer, Redis and Mailpit; waits until all are healthy
pnpm test:infra    # optional smoke test of the running stack
pnpm infra:down    # stop them, keeping data
pnpm infra:reset   # stop them and delete the database and Redis volumes
```

| Service     | Address                                           | Notes                                                                                                                            |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| PgBouncer   | `localhost:56432`                                 | Transaction pooling. The app always connects here.                                                                               |
| Postgres 16 | `localhost:55432`                                 | Direct connection, for migrations only.                                                                                          |
| Redis 7     | `localhost:56379`                                 | BullMQ, rate limits, sessions, sockets.                                                                                          |
| Mailpit     | SMTP `localhost:51025`, UI http://localhost:58025 | SMTP catcher for any tool that sends mail over SMTP. The backend sends through Mailjet's API, so its email does not appear here. |

The local database is `komtru_v2_dev`, user `komtru`, password `komtru`. These credentials exist only in the throwaway containers.

Ports are deliberately non-standard so they never clash with an existing local Postgres or Redis. To change one, export `KOMTRU_PG_PORT`, `KOMTRU_PGBOUNCER_PORT`, `KOMTRU_REDIS_PORT`, `KOMTRU_MAILPIT_SMTP_PORT` or `KOMTRU_MAILPIT_UI_PORT` in your shell before `pnpm infra:up` and before running the env script; both read the same variables. Don't put them in a root `.env` file: Docker Compose reads that file but the env script does not, so the two would disagree.

## Give the backend its credentials

```bash
pnpm env:backend                  # writes apps/backend-api/.env for the local Docker stack
pnpm env:backend --target rds     # keeps the RDS host and credentials instead
pnpm env:backend --force          # overwrite an existing apps/backend-api/.env
```

The script copies every value from `docs/specs/backend-apis.env` exactly, with these changes:

- **Local target:** Postgres points at the Docker stack.
- **RDS target:** the host stays, and the database always changes to `komtru_v2_dev`, whatever the source named. The source's credentials become `POSTGRES_DIRECT_URL` (migrations only).
- **Both targets:** Redis points at the Docker stack and `MAILJET_SANDBOX=true`, because `--target` chooses where the database lives, not whether the run is local. `--target rds` is still your laptop: the source's Redis is the old stack's (port 6379, where nothing listens here) and its Mailjet switch is a server's, which would email real people.
- **Both targets:** this monorepo's own local topology replaces the old backend's, which is what the source file describes: `PORT=7813`, `ALLOWED_ORIGINS` and `SOCKET_CORS_ORIGINS` covering `localhost:3001`–`3004`, the two app base URLs the source leaves empty, and OAuth and passkey callbacks on `localhost:3001`. Copied verbatim these name the old stack's ports (3000, 7820, 5501), which starts the API where no frontend looks and then refuses the origins they do call from.
- **Both targets:** the app itself (`POSTGRES_URL`) connects as `komtru_app`, the least-privilege runtime role. Its password is `POSTGRES_APP_PASSWORD`: `komtru_app` locally, and on RDS a value derived from the owner password, so every developer generates the same one.

> **Live provider keys stay live.** The Termii SMS key, Cloudinary accounts and other provider credentials are copied unchanged, so a local run can send real SMS to real phone numbers and spend real credit. Until the notification module ships its SMS dry-run switch (T-045), only use phone numbers you own when testing OTP or alerts. Paystack is in test mode, so no real money moves.

> **Never point the new build at `komtru_dev`.** That database belongs to the old backend, which has already migrated its own schema into it. The new schema would collide with it. `komtru_v2_dev` must be created on the RDS instance before the RDS target works (design §12 Q8).

The script writes the file with owner-only permissions and prints variable names, never values. It finds the credentials file from any git worktree, because the file only exists in the main checkout.

### The frontends

```bash
pnpm env:apps          # writes apps/<app>/.env.local for all four frontends
pnpm env:apps --force  # replace files that already exist
```

Each file is its app's `.env.example` with one value filled in: `KOMTRU_SESSION_SECRET`, a freshly generated 32-character value. The example has to leave it empty — a committed file may hold nothing secret-shaped — but `middleware.ts` reads it at module scope and throws without it, so a hand-copied example yields an app that starts cleanly and then answers 500 on every page. All four apps get the same secret: on `localhost` they share a host and cookies ignore the port, so each app receives the others' `komtru_session`; one secret makes that cookie open and fail the scope check, which is what production does, rather than look like tampering.

The script skips an app that already has a `.env.local`, so a hand-edited file is never lost.

With the services up and the env files written, `pnpm dev` at the repository root starts the API, the worker and every frontend dev server together.

## Create the schema

```bash
pnpm --filter @komtru/backend-api db:migrate
```

This runs as the owner over `POSTGRES_DIRECT_URL`. It applies the migrations, creates `komtru_app` if needed, sets its password from `POSTGRES_APP_PASSWORD`, and grants it access to every module schema. Run it after every pull that adds a migration. The API and worker refuse to start if `POSTGRES_URL` names a superuser or the schema owner.

**Upgrading from before T-021:** regenerate your env with `pnpm env:backend --force` (it adds `POSTGRES_APP_PASSWORD` and points `POSTGRES_URL` at `komtru_app`), run `pnpm infra:up` once to recreate PgBouncer, then migrate. Without `POSTGRES_APP_PASSWORD`, `db:migrate` leaves `komtru_app` unable to log in.

### Running against RDS instead of local Postgres

`pnpm env:backend --target rds --force` points Postgres at the RDS instance; Redis stays on the Docker stack, so `pnpm infra:up` is still needed (you can stop the `komtru-postgres-1` and `komtru-pgbouncer-1` containers).

Two things bite on the way:

1. **The database must exist.** RDS has no `komtru_v2_dev` until someone creates it, and the old backend's `komtru_dev` is not a substitute: it holds the same schema names this build uses (`identity`, `trade`, `ledger`, `notify`, `files`) with live rows in them, and its `drizzle.__drizzle_migrations` already tracks the old backend's history. Create the new one, owned by the migrating user:

   ```sql
   CREATE DATABASE komtru_v2_dev OWNER <migrating-user>;
   ```

2. **Node does not trust the Amazon RDS CA.** `POSTGRES_SSL=true` makes the connection verify the certificate chain, and RDS presents one rooted in the Amazon RDS CA, which is not in Node's trust store. Download the bundle once:

   ```bash
   mkdir -p ~/.komtru/certs
   curl -fsSL -o ~/.komtru/certs/rds-global-bundle.pem \
     https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
   ```

   `pnpm env:backend --target rds` writes that path into `POSTGRES_CA_CERT`, and the API, worker, migrator and seeder all read it from there, so no shell variable is involved and `pnpm dev` works from any terminal. If the file is missing the process names it and prints the download command instead of failing inside TLS. `NODE_EXTRA_CA_CERTS` still works if you prefer it, but nothing requires it.

   Never set `POSTGRES_SSL=false` to get around a certificate error: that sends the credentials to a public endpoint in clear text.

**On RDS** the migrating user (the old backend's credentials) must own `komtru_v2_dev` and its `public` schema and have `CREATEROLE`, on Postgres 15 or later. The migrator checks the resulting privileges and fails with a list of what did not take, instead of carrying on with a weaker runtime role.

## Secret protection on commit

The pre-commit hook blocks a commit when:

- `docs/specs/backend-apis.env` or any `.env` file (other than `.env.example`) could be committed, including after `git add -f`;
- a staged file contains any value from `docs/specs/backend-apis.env`;
- a staged file contains a key-shaped secret: a Paystack secret key, a PEM private key or an AWS access key, plus everything in secretlint's recommended preset.

The hook names the file and the kind of finding. It never prints the secret. Fix the file, re-stage and commit again. Bypassing hooks with `--no-verify` defeats this protection; CI (T-004) repeats the scan.

## Before production cutover

- The Paystack dashboard's webhook URL still points at the old backend. Repoint it to the new backend's `/webhooks/paystack` at cutover, or payment confirmations will keep going to the old system.
- Sentry and a pooler in front of RDS (PgBouncer or RDS Proxy) must be provisioned for deployed environments (design §12 Q8).

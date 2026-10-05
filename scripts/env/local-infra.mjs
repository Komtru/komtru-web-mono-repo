// The local Docker stack's addresses. docker-compose.yml reads the same KOMTRU_* port variables, so
// changing a port in one place moves both. Non-standard default ports avoid clashing with an old
// Postgres or Redis already running on the developer's machine.
const env = process.env;

export const LOCAL_PORTS = Object.freeze({
  postgres: Number(env.KOMTRU_PG_PORT ?? 55432),
  pgbouncer: Number(env.KOMTRU_PGBOUNCER_PORT ?? 56432),
  redis: Number(env.KOMTRU_REDIS_PORT ?? 56379),
  mailpitSmtp: Number(env.KOMTRU_MAILPIT_SMTP_PORT ?? 51025),
  mailpitUi: Number(env.KOMTRU_MAILPIT_UI_PORT ?? 58025),
});

// Local-only credentials for throwaway containers; never used for any shared environment.
export const LOCAL_DATABASE = Object.freeze({ name: 'komtru_v2_dev', user: 'komtru', password: 'komtru' });

const db = LOCAL_DATABASE;

export const LOCAL_INFRA = Object.freeze({
  pooledUrl: `postgresql://${db.user}:${db.password}@localhost:${LOCAL_PORTS.pgbouncer}/${db.name}`,
  directUrl: `postgresql://${db.user}:${db.password}@localhost:${LOCAL_PORTS.postgres}/${db.name}`,
  redisUrl: `redis://localhost:${LOCAL_PORTS.redis}`,
  mailpitUrl: `http://localhost:${LOCAL_PORTS.mailpitUi}`,
});

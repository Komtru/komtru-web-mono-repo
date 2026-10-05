// Where integration tests find Postgres. Defaults match docker-compose.yml; CI overrides them.
export const infraEnabled = process.env.KOMTRU_INFRA_TESTS === '1';

const directBase = process.env.KOMTRU_TEST_DIRECT_URL ?? 'postgresql://komtru:komtru@localhost:55432';
const pooledBase = process.env.KOMTRU_TEST_POOLED_URL ?? 'postgresql://komtru_app:komtru_app@localhost:56432';

export const TEMPLATE_DATABASE = 'komtru_test_template';
/** Local throwaway password the harness gives komtru_app (it matches KOMTRU_TEST_POOLED_URL). */
export const TEST_APP_PASSWORD = decodeURIComponent(new URL(pooledBase).password);

/** Owner connection straight to Postgres. */
export const directUrl = (database: string) => `${directBase}/${database}`;
/** komtru_app through PgBouncer, as the app connects. */
export const pooledUrl = (database: string) => `${pooledBase}/${database}`;
export const pooledPort = () => Number(new URL(pooledBase).port);

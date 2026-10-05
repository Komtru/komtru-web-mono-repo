// drizzle-kit: `pnpm db:generate` diffs every module's schema.ts into a new migration under ./drizzle.
// Hand-written SQL (roles, triggers, appendOnly()) goes in `drizzle-kit generate --custom` migrations.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/db/platform-schema.ts', './src/modules/*/schema.ts'],
  out: './drizzle',
  dbCredentials: { url: process.env.POSTGRES_DIRECT_URL ?? '' },
  migrations: { schema: 'drizzle' },
  strict: true,
});

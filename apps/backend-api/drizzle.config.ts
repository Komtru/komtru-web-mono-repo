// drizzle-kit: `pnpm db:generate` diffs every module's schema into a new migration under ./drizzle.
// Hand-written SQL (roles, triggers, appendOnly()) goes in `drizzle-kit generate --custom` migrations.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // The second glob is the shape design §4.2 actually prescribes — a module's tables live under
  // `<module>/infrastructure/postgres/schema/` (T-030). The flat `<module>/schema.ts` stays for a
  // module small enough not to need the folder.
  schema: [
    './src/db/platform-schema.ts',
    './src/modules/*/schema.ts',
    './src/modules/*/infrastructure/postgres/schema/*.ts',
  ],
  out: './drizzle',
  dbCredentials: { url: process.env.POSTGRES_DIRECT_URL ?? '' },
  migrations: { schema: 'drizzle' },
  strict: true,
});

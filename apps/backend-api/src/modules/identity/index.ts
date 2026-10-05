// The identity module's public surface. Until T-031 adds services, that is the schema: other
// modules may read these tables, and the komtru/module-boundaries rule makes this the only way in.
export * from './infrastructure/postgres/schema/index.js';

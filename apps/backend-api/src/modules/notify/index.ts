// The notify module's public surface (M11). Other modules read these tables and subscribe through
// the bindings in domain/binding.ts; the komtru/module-boundaries rule makes this the only way in.
export * from './infrastructure/postgres/schema/index.js';

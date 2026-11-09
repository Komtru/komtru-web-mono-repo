// "A decision can never be recorded by the advisory path" (T-107), proved three ways that do not
// depend on each other: by what the advisory code can reach (source), by what its handle can do
// (types), and by what happens to the database when it runs (cases.http.int.test.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Db } from '../../../src/db/index.js';
import { caseRoutes } from '../../../src/modules/cases/http/routes.js';
import type { ReadDb } from '../../../src/modules/cases/services/read.service.js';
import { ruleBasedAdvisory } from '../../../src/modules/cases/domain/advisory.js';

const root = path.resolve(import.meta.dirname, '../../../src/modules/cases');
const source = (file: string) => readFileSync(path.join(root, file), 'utf8');
const code = (file: string) =>
  source(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the advisory path cannot record a decision', () => {
  const advisoryFiles = ['domain/advisory.ts', 'services/advisory.service.ts'];

  it.each(advisoryFiles)('%s imports no writer and issues no write', (file) => {
    const text = code(file);
    expect(text).not.toMatch(/case\.service|register\.service|\/audit\.js|platform\/events\/publish/);
    expect(text).not.toMatch(/\.(insert|update|delete|transaction|execute)\(/);
    expect(text).not.toMatch(/publish\(|writeAudit|writeTrail/);
  });

  it('is served by a read-only handle', () => {
    // A ReadDb has no insert, update or delete: the advisory service cannot write through it.
    expectTypeOf<ReadDb>().not.toHaveProperty('insert');
    expectTypeOf<ReadDb>().not.toHaveProperty('update');
    expectTypeOf<ReadDb>().not.toHaveProperty('delete');
    expectTypeOf<ReadDb>().not.toHaveProperty('transaction');
    // The full Db is assignable to it, so the route can hand over the one it has.
    const fromDb = (db: Db): ReadDb => db;
    expect(fromDb).toBeTypeOf('function');
  });

  it('is exposed only as a GET, and POST /decisions is the only route that records one', () => {
    const routes = caseRoutes({ db: () => ({}) as Db, advisory: () => ruleBasedAdvisory });
    const advisory = routes.filter((route) => route.path.includes('advisory'));
    expect(advisory.map((route) => route.method)).toEqual(['get']);
    expect(routes.filter((route) => route.path.endsWith('/decisions')).map((route) => route.method)).toEqual([
      'post',
    ]);
    // Only the decision service inserts into case_decisions.
    const writers = [
      'services/case.service.ts',
      'services/read.service.ts',
      'services/register.service.ts',
      'services/audit.ts',
      'services/advisory.service.ts',
    ].filter((file) => /insert\(caseDecisions\)/.test(code(file)));
    expect(writers).toEqual(['services/case.service.ts']);
  });

  it('gives the advisory nothing to be mistaken for a decision', () => {
    const advisory = ruleBasedAdvisory.suggest({
      type: 'FRAUD',
      state: 'OPEN',
      priority: 'HIGH',
      sla: 'AT_RISK',
      ageHours: 1,
      openEvidenceRequests: 0,
      resolvedEvidenceRequests: 0,
      priorDecisions: 0,
      facts: { signalCount: 5 },
    });
    expect(advisory).not.toHaveProperty('outcome');
    expect(advisory).not.toHaveProperty('policyCitation');
    expect(advisory).not.toHaveProperty('decidedByUserId');
  });
});

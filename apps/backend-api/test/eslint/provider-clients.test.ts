import { resolve } from 'node:path';
import { ESLint, RuleTester, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import providerClients from '../../eslint-rules/provider-clients.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module', parser: tseslint.parser },
});
const root = '/repo/apps/backend-api/src';
// A checkout whose path happens to contain "jobs" must not make every file look like a job.
const jobsCheckout = '/home/dev/jobs/komtru/apps/backend-api/src';
const client = `${root}/modules/ledger/infrastructure/providers/paystack.client.ts`;
const helper = `${root}/modules/ledger/infrastructure/providers/paystack.signature.ts`;
const job = `${root}/modules/ledger/jobs/verify-charge.job.ts`;
const service = `${root}/modules/ledger/services/funding.service.ts`;
const route = `${root}/modules/ledger/http/controllers.ts`;
const barrel = `${root}/modules/ledger/index.ts`;

tester.run('provider-clients', providerClients, {
  valid: [
    { filename: job, code: "import { verifyCharge } from '../infrastructure/providers/paystack.client.js';" },
    { filename: job, code: "const c = await import('../infrastructure/providers/paystack.client.js');" },
    // Pure helpers carry no I/O, so a request handler may use them.
    { filename: route, code: "import { verify } from '../infrastructure/providers/paystack.signature.js';" },
    { filename: service, code: "import { sign } from '../infrastructure/providers/paystack.signature.js';" },
    { filename: client, code: "import { providerRequest } from '../../../../platform/providers/http.js';" },
    { filename: helper, code: "import { createHmac } from 'node:crypto';" },
    { filename: route, code: "import { z } from 'zod';" },
    // A provider with its own folder names the file client.ts (T-071's paystack/ layout).
    { filename: job, code: "import { charge } from '../infrastructure/providers/paystack/client.js';" },
    // The platform may use its own helper.
    { filename: `${root}/platform/providers/circuit-breaker.ts`, code: "import { x } from './http.js';" },
    // A provider folder may share a base client between its own clients.
    { filename: client, code: "import { call } from './base.client.js';" },
    { filename: `${root}/platform/providers/http.ts`, code: 'await fetch("https://x.test");' },
    { filename: client, code: 'const r = await fetch("https://x.test");' },
    { filename: helper, code: 'const key = fetchKey();' },
  ],
  invalid: [
    {
      filename: service,
      code: "import { verifyCharge } from '../infrastructure/providers/paystack.client.js';",
      errors: [{ messageId: 'clientOutsideJobs' }],
    },
    {
      filename: route,
      code: "import { verifyCharge } from '../infrastructure/providers/paystack.client.js';",
      errors: [{ messageId: 'clientOutsideJobs' }],
    },
    {
      filename: route,
      code: "export { verifyCharge } from '../infrastructure/providers/paystack.client.js';",
      errors: [{ messageId: 'clientOutsideJobs' }],
    },
    {
      filename: route,
      code: "const c = await import('../infrastructure/providers/paystack.client.js');",
      errors: [{ messageId: 'clientOutsideJobs' }],
    },
    {
      filename: service,
      code: "import { charge } from '../infrastructure/providers/paystack/client.js';",
      errors: [{ messageId: 'clientOutsideJobs' }],
    },
    {
      filename: barrel,
      code: "export * from './infrastructure/providers/paystack.client.js';",
      errors: [{ messageId: 'clientOutsideJobs' }],
    },
    {
      filename: service,
      code: "import { providerRequest } from '../../../platform/providers/http.js';",
      errors: [{ messageId: 'httpOutsideClient' }],
    },
    {
      // A job calls its client; it does not reach past it and make its own requests.
      filename: job,
      code: "import { providerRequest } from '../../../platform/providers/http.js';",
      errors: [{ messageId: 'httpOutsideClient' }],
    },
    {
      filename: service,
      code: 'const r = await fetch("https://api.paystack.co/transaction");',
      errors: [{ messageId: 'rawNetworkCall' }],
    },
    {
      filename: route,
      code: "import https from 'node:https';",
      errors: [{ messageId: 'rawNetworkCall' }],
    },
    {
      filename: job,
      code: "import { request } from 'undici';",
      errors: [{ messageId: 'rawNetworkCall' }],
    },
    {
      filename: `${jobsCheckout}/modules/ledger/services/funding.service.ts`,
      code: "import { verifyCharge } from '../infrastructure/providers/paystack.client.js';",
      errors: [{ messageId: 'clientOutsideJobs' }],
    },
  ],
});

describe('eslint config', () => {
  it('turns the rule on for src, so the rule is not merely tested', async () => {
    const eslint = new ESLint({ cwd: resolve(import.meta.dirname, '../..') });
    const config = (await eslint.calculateConfigForFile(
      'src/modules/ledger/http/controllers.ts',
    )) as Linter.Config;

    // ESLint normalises 'error' to severity 2.
    expect(config.rules?.['komtru/provider-clients']).toEqual([2]);
  });
});

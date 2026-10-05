import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import moduleBoundaries from '../../eslint-rules/module-boundaries.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

// The rule runs on TypeScript in the real config, so the tester parses TypeScript too.
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module', parser: tseslint.parser },
});
const root = '/repo/apps/backend-api/src';
const inTrades = `${root}/modules/trades/services/trade.service.ts`;
const inPlatform = `${root}/platform/health.ts`;

tester.run('module-boundaries', moduleBoundaries, {
  valid: [
    { filename: inTrades, code: "import { x } from '../../identity/index.js';" },
    { filename: inTrades, code: "import { y } from '../domain/state-machine.js';" },
    { filename: inTrades, code: "import { logger } from '../../../platform/logger.js';" },
    { filename: inTrades, code: "import { z } from 'zod';" },
    { filename: `${root}/modules/index.ts`, code: "import { trades } from './trades/index.js';" },
    { filename: inPlatform, code: "import type { Router } from 'express';" },
  ],
  invalid: [
    {
      filename: inTrades,
      code: "import { x } from '../../identity/services/user.service.js';",
      errors: [{ messageId: 'crossModule' }],
    },
    {
      filename: inTrades,
      code: "export { x } from '../../ledger/domain/journal.js';",
      errors: [{ messageId: 'crossModule' }],
    },
    {
      filename: inTrades,
      code: "const m = await import('../../ledger/services/x.js');",
      errors: [{ messageId: 'crossModule' }],
    },
    {
      filename: inPlatform,
      code: "import { x } from '../modules/identity/services/user.service.js';",
      errors: [{ messageId: 'crossModule' }],
    },
  ],
});

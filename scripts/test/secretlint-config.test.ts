import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  'lint-staged': Record<string, string>;
};

describe('secretlint coverage', () => {
  const command = Object.values(pkg['lint-staged']).find((c) => c.startsWith('secretlint'));

  it('runs with its own ignore file, not Prettier’s', () => {
    expect(command).toContain('--secretlintignore .secretlintignore');
  });

  it('scans reference docs and agent notes, which sit next to the credentials file', () => {
    const ignore = existsSync(path.join(root, '.secretlintignore'))
      ? readFileSync(path.join(root, '.secretlintignore'), 'utf8')
      : '';
    for (const scanned of ['docs/specs', 'docs/design-reference', '.superpowers', '.claude']) {
      expect(ignore).not.toContain(scanned);
    }
  });
});

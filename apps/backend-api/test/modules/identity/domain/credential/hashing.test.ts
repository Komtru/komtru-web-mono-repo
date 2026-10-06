import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  needsRehash,
  performDecoyVerification,
  verifyPassword,
} from '../../../../../src/modules/identity/domain/credential/hashing.js';

describe('password hashing', () => {
  it('produces a PHC string at the OWASP baseline and verifies it', async () => {
    const phc = await hashPassword('correct horse battery staple');
    expect(phc).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(verifyPassword('correct horse battery staple', phc)).resolves.toBe(true);
    await expect(verifyPassword('wrong', phc)).resolves.toBe(false);
  });

  it('reads a corrupt hash as a wrong password rather than throwing', async () => {
    await expect(verifyPassword('x', 'not-a-phc-string')).resolves.toBe(false);
  });

  it.each([
    ['$argon2id$v=19$m=4096,t=2,p=1$abc$def', true, 'weaker memory'],
    ['$argon2id$v=19$m=19456,t=1,p=1$abc$def', true, 'weaker time'],
    ['$argon2i$v=19$m=65536,t=4,p=1$abc$def', true, 'a different argon2 variant'],
    ['$2b$12$abcdefghijklmnopqrstuv', true, 'a bcrypt row'],
    ['$argon2id$v=19$m=65536,t=4,p=2$abc$def', false, 'stronger than the baseline'],
    ['$argon2id$v=19$m=19456,t=2,p=1$abc$def', false, 'exactly the baseline'],
  ] as const)('needsRehash(%s) is %s for %s', (phc, expected, _why) => {
    expect(needsRehash(phc)).toBe(expected);
  });

  it('decoy verification always fails and always does the work', async () => {
    await expect(performDecoyVerification('a')).resolves.toBe(false);
    await expect(performDecoyVerification('b')).resolves.toBe(false);
  });
});

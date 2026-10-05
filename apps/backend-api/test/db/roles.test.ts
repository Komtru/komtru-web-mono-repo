import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { scramVerifier, setRuntimePassword } from '../../src/db/roles.js';

describe('setRuntimePassword', () => {
  it('sends a SCRAM verifier, never the plaintext, so the server log cannot leak it', async () => {
    const sent: string[] = [];
    const client = {
      query: (text: string) => {
        sent.push(text);
        return Promise.resolve({ rows: [] });
      },
      escapeIdentifier: (s: string) => `"${s}"`,
      escapeLiteral: (s: string) => `'${s}'`,
    } as unknown as pg.ClientBase;

    await setRuntimePassword(client, 'correct-horse-battery');

    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain('correct-horse-battery');
    expect(sent[0]).toMatch(/^ALTER ROLE "komtru_app" LOGIN PASSWORD 'SCRAM-SHA-256\$4096:/);
  });
});

describe('scramVerifier', () => {
  // Correctness is proven end to end: every integration test logs in as komtru_app with it.
  it('produces the Postgres SCRAM-SHA-256 verifier format, salted', () => {
    const salt = Buffer.alloc(16, 7);
    const verifier = scramVerifier('pencil', salt, 4096);
    expect(verifier).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/,
    );
    expect(scramVerifier('pencil', salt, 4096)).toBe(verifier);
    expect(scramVerifier('pencil', Buffer.alloc(16, 8), 4096)).not.toBe(verifier);
  });
});

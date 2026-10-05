import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** Every module `src/index.ts` can reach, following relative imports. */
async function reachableFromIndex(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const queue = ['index.ts'];

  while (queue.length > 0) {
    const relative = queue.pop();
    if (relative === undefined || files.has(relative)) continue;
    const source = await readFile(resolve(SRC, relative), 'utf8');
    // Prose is not code: a comment that mentions localStorage is not a use of it.
    files.set(relative, source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''));

    for (const match of source.matchAll(/from '(\.[^']+)'/g)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const path = resolve(dirname(resolve(SRC, relative)), specifier.replace(/\.js$/, '.ts'));
      queue.push(path.slice(SRC.length + 1));
    }
  }
  return files;
}

describe('@komtru/api-client', () => {
  it('exports the isomorphic surface', () => {
    for (const name of [
      'createApiClient',
      'createTransport',
      'defineEndpoint',
      'buildPath',
      'buildQuery',
      'createTokenStore',
      'createRouteHandlerRefresh',
      'authRoutePaths',
      'backendLoginPath',
      'createIdempotencyKey',
      'assertIdempotencyKey',
      'beginUserAction',
      'IDEMPOTENCY_KEY_PATTERN',
      'createRetryQueue',
      'createMemoryQueueStore',
      'isRetryable',
      'retryDelayMs',
      'nextPageParam',
      'flattenPages',
      'walkCursorPages',
      'ProblemError',
      'NetworkError',
      'TimeoutError',
      'ResponseShapeError',
      'attachRealtime',
    ]) {
      expect(api).toHaveProperty(name);
    }
  });

  it('keeps the browser-only entry points out of the main one', () => {
    // These live behind './browser' and './react'; importing either from here would break every
    // React Server Component that imports the client.
    for (const name of ['createIndexedDbQueueStore', 'RealtimeProvider', 'cursorInfiniteQueryOptions']) {
      expect(api).not.toHaveProperty(name);
    }
  });

  it('never reaches a browser-only module from the server-safe entry', async () => {
    const files = await reachableFromIndex();
    expect(files.size).toBeGreaterThan(5);

    for (const [path, source] of files) {
      for (const forbidden of [
        "'socket.io-client'",
        "'react'",
        "'react/jsx-runtime'",
        "'@tanstack/react-query'",
        'indexedDB',
        'localStorage',
        'document.',
      ]) {
        expect(`${path}: ${String(source.includes(forbidden))}`).toBe(`${path}: false`);
      }
    }
  });
});

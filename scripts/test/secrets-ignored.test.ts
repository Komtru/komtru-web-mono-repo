import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findCommittableSecrets,
  findUnignored,
  MUST_BE_IGNORED,
  MUST_BE_TRACKABLE,
} from '../check-secrets-ignored.mjs';

describe('secret files stay out of git', () => {
  it('ignores the old backend .env and every app .env', () => {
    expect(findUnignored(MUST_BE_IGNORED)).toEqual([]);
  });

  it('keeps .env.example files trackable', () => {
    expect(MUST_BE_TRACKABLE.filter((p) => findUnignored([p]).length === 0)).toEqual([]);
  });

  it('reports a path that git would track', () => {
    expect(findUnignored(['README.md'])).toEqual(['README.md']);
  });
});

describe('force-added secrets are caught', () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });

  const makeRepo = () => {
    repo = mkdtempSync(path.join(tmpdir(), 'komtru-secrets-'));
    git('init', '-q');
    mkdirSync(path.join(repo, 'docs/specs'), { recursive: true });
    writeFileSync(
      path.join(repo, '.gitignore'),
      'docs/specs/backend-apis.env\n*.env\n.env\n.env.*\n!.env.example\n',
    );
    writeFileSync(path.join(repo, 'docs/specs/backend-apis.env'), 'SECRET=1\n');
    writeFileSync(path.join(repo, '.env.example'), 'SECRET=\n');
  };

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('treats a force-added secrets file as not ignored', () => {
    makeRepo();
    git('add', '-f', 'docs/specs/backend-apis.env');
    expect(findUnignored(['docs/specs/backend-apis.env'], repo)).toEqual(['docs/specs/backend-apis.env']);
  });

  it('lists staged or tracked secret files but never .env.example', () => {
    makeRepo();
    git('add', '-f', 'docs/specs/backend-apis.env');
    git('add', '.env.example');
    expect(findCommittableSecrets(repo)).toEqual(['docs/specs/backend-apis.env']);
  });

  it('finds nothing in a clean repository', () => {
    makeRepo();
    git('add', '.gitignore', '.env.example');
    expect(findCommittableSecrets(repo)).toEqual([]);
  });
});

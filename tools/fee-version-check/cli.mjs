#!/usr/bin/env node
// Fails CI when a value in config/fees.yaml changed without a `version` bump (design §6.5).
//
//   node tools/fee-version-check/cli.mjs [base-ref]   # base-ref defaults to origin/main
//
// In CI the base is fetched shallowly first, so FETCH_HEAD is the ref to pass.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { FEES_FILE, findVersionProblems } from './check.mjs';

const baseRef = process.argv[2] ?? 'origin/main';

/** `null` when the file is not on that ref, which is the commit that adds it. */
const readBase = () => {
  try {
    // stderr is dropped: git's "exists on disk, but not in <ref>" is this branch adding the file,
    // which is the normal case, not something to print in red.
    return execFileSync('git', ['show', `${baseRef}:${FEES_FILE}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};

const problems = findVersionProblems(readBase(), readFileSync(FEES_FILE, 'utf8'));
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`${FEES_FILE} is unchanged or its version was bumped (base: ${baseRef}).`);

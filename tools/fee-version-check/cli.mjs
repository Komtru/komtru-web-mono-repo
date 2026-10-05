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

/** The all-zero sha GitHub passes as `github.event.before` for a branch's first push. */
const EMPTY_SHA = /^0{40}$/;

/**
 * A ref that does not resolve is a wiring mistake, and a check that cannot find its base must fail
 * rather than print a reassuring line: for most of this repo's life the version check will be the
 * only thing standing between a changed fee and a silent deploy.
 */
const assertResolvable = () => {
  if (EMPTY_SHA.test(baseRef)) return false;
  try {
    execFileSync('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    console.error(`fee-version-check: base ref "${baseRef}" does not resolve to a commit.`);
    process.exit(1);
  }
};

/** `null` when the file is not on that ref, which is the commit that adds it. */
const readBase = () => {
  if (!assertResolvable()) return null;
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

let head;
try {
  head = readFileSync(FEES_FILE, 'utf8');
} catch {
  console.error(`fee-version-check: ${FEES_FILE} is missing from this commit.`);
  process.exit(1);
}

const problems = findVersionProblems(readBase(), head);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`${FEES_FILE} is unchanged or its version was bumped (base: ${baseRef}).`);

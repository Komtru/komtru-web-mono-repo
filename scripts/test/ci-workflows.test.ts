// Shape tests for the per-app GitHub Actions workflows (T-004). CI is configuration, so the only
// thing a test can hold it to is its shape: the path filters have to follow the workspace graph, the
// job graph has to gate deploy behind the tests, and the backend's service containers have to match
// docker-compose.yml and the ports the backend's own test helpers expect.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = resolve(import.meta.dirname, '../..');
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), 'utf8');
const readYaml = <T>(relative: string): T => parse(read(relative)) as T;

type Step = { uses?: string; run?: string; with?: Record<string, string>; name?: string };
type CompositeAction = { inputs?: Record<string, unknown>; runs: { using: string; steps: Step[] } };

const action = readYaml<CompositeAction>('.github/actions/setup/action.yml');
const actionSteps = action.runs.steps;
const stepUsing = (prefix: string) => actionSteps.find((step) => step.uses?.startsWith(prefix));

describe('composite setup action', () => {
  it('is a composite action every workflow can call as ./.github/actions/setup', () => {
    expect(action.runs.using).toBe('composite');
    for (const step of actionSteps) {
      if (step.run !== undefined) expect(step).toHaveProperty('shell', 'bash');
    }
  });

  it('takes Node and pnpm from the root package.json instead of naming versions', () => {
    const setupNode = stepUsing('actions/setup-node@');
    expect(setupNode?.with?.['node-version-file']).toBe('package.json');
    expect(setupNode?.with?.['node-version']).toBeUndefined();
    expect(stepUsing('pnpm/action-setup@')?.with?.version).toBeUndefined();
    const manifest = JSON.parse(read('package.json')) as {
      packageManager: string;
      engines: { node: string };
    };
    const text = read('.github/actions/setup/action.yml');
    expect(text).not.toContain(manifest.packageManager.replace('pnpm@', ''));
    expect(text).not.toContain(manifest.engines.node);
  });

  it('installs pnpm before setup-node, which needs it to find the store', () => {
    const pnpmIndex = actionSteps.findIndex((step) => step.uses?.startsWith('pnpm/action-setup@'));
    const nodeIndex = actionSteps.findIndex((step) => step.uses?.startsWith('actions/setup-node@'));
    expect(pnpmIndex).toBeGreaterThanOrEqual(0);
    expect(pnpmIndex).toBeLessThan(nodeIndex);
  });

  it('restores the pnpm store and the Turbo cache', () => {
    expect(stepUsing('actions/setup-node@')?.with?.cache).toBe('pnpm');
    const turboCache = stepUsing('actions/cache@');
    expect(turboCache?.with?.path).toContain('.turbo');
    expect(turboCache?.with?.key).toContain("hashFiles('pnpm-lock.yaml')");
    expect(turboCache?.with?.['restore-keys']).toBeTruthy();
  });

  it('installs with a frozen lockfile', () => {
    expect(actionSteps.some((step) => step.run?.includes('pnpm install --frozen-lockfile'))).toBe(true);
  });
});

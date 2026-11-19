// `pnpm visual-capture --walk AC1 --app http://localhost:3913 --width 340`
// `pnpm visual-capture --app http://localhost:3913 --path /home --persona buyer --scenario no-trades --width 560`
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { captureBuilt, type CaptureOptions } from './capture.ts';
import { walkFor } from './walkthroughs.ts';
import { isPersonaId, isScenarioId, PERSONA_IDS, SCENARIO_IDS } from './standin/personas.ts';

const DEFAULT_OUT_DIR = fileURLToPath(new URL('../../../test-results/visual-capture/', import.meta.url));

const USAGE = `Usage: pnpm visual-capture (--walk <screen> | --path <route>) --app <origin> [options]

  --walk       A registered walkthrough (tools/visual-check/src/walkthroughs.ts): persona, scenario, route, clicks.
  --path       A route on the app, for example /home. Needs --persona for a signed-in screen.
  --app        The app's origin, for example http://localhost:3913.
  --persona    ${PERSONA_IDS.join(' | ')} — signs in against the stand-in (pnpm visual-standin).
  --scenario   ${SCENARIO_IDS.join(' | ')}. Default: with-trades.
  --width      The viewport width in CSS pixels. Default: 340 (mobile). Use 560 for tablet, 1040 for desktop.
  --height     The viewport height. Default: 844.
  --content    A selector to start the shot at, such as main.
  --out        Where the PNG goes. Default: test-results/visual-capture/<screen or route>-<width>.png (git-ignored).`;

function fail(message: string): never {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(2);
}

const { values } = (() => {
  try {
    return parseArgs({
      options: {
        walk: { type: 'string' },
        path: { type: 'string' },
        app: { type: 'string' },
        persona: { type: 'string' },
        scenario: { type: 'string' },
        width: { type: 'string' },
        height: { type: 'string' },
        content: { type: 'string' },
        out: { type: 'string' },
      },
      strict: true,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
})();

if (values.app === undefined) fail('--app is required.');
if ((values.walk === undefined) === (values.path === undefined))
  fail('Pass exactly one of --walk and --path.');

const positive = (name: string, raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 200 || parsed > 4000) {
    fail(`--${name} must be a whole number of CSS pixels between 200 and 4000, not ${raw}`);
  }
  return parsed;
};

const width = positive('width', values.width, 340);
const height = positive('height', values.height, 844);

const plan = ((): Pick<CaptureOptions, 'url' | 'walk' | 'session' | 'content'> & { label: string } => {
  if (values.walk !== undefined) {
    const walk = (() => {
      try {
        return walkFor(values.walk);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    })();
    return {
      label: walk.screen,
      url: new URL(walk.path, values.app).toString(),
      walk,
      session: { persona: walk.persona, scenario: walk.scenario },
      ...(values.content === undefined && walk.content !== undefined ? { content: walk.content } : {}),
    };
  }
  const route = values.path!;
  if (!route.startsWith('/')) fail(`--path must start with /, not ${route}`);
  const scenario = values.scenario ?? 'with-trades';
  if (!isScenarioId(scenario)) fail(`--scenario must be one of ${SCENARIO_IDS.join(', ')}`);
  const persona = values.persona;
  if (persona !== undefined && !isPersonaId(persona))
    fail(`--persona must be one of ${PERSONA_IDS.join(', ')}`);
  return {
    label: route.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root',
    url: new URL(route, values.app).toString(),
    ...(persona === undefined ? {} : { session: { persona, scenario } }),
    ...(values.content === undefined ? {} : { content: values.content }),
  };
})();

const out = values.out ?? join(DEFAULT_OUT_DIR, `${plan.label}-${width}.png`);
mkdirSync(DEFAULT_OUT_DIR, { recursive: true });

const result = await captureBuilt({
  url: plan.url,
  width,
  height,
  out,
  ...(plan.session === undefined ? {} : { session: plan.session }),
  ...(plan.walk === undefined ? {} : { walk: plan.walk }),
  ...(plan.content === undefined ? {} : { content: plan.content }),
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`visual-capture: ${message}\n`);
  process.exit(1);
});

process.stdout.write(`${result.file}\n  ${result.width} × ${result.height} CSS px\n`);

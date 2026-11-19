// `pnpm visual-check --screen U4 --url http://localhost:3004/handover/KMT-88213`
// `pnpm visual-check --screen AC1 --walk http://localhost:3913` — a registered walk, against the stand-in.
import { parseArgs } from 'node:util';

import { UI_REVIEW_DIR, visualCheck, type VisualCheckOptions } from './run.ts';
import { arrangeFor, type Walkthrough } from './walk.ts';
import { walkFor } from './walkthroughs.ts';
import { isPersonaId, isScenarioId, PERSONA_IDS, SCENARIO_IDS } from './standin/personas.ts';

const USAGE = `Usage: pnpm visual-check --screen <id> (--url <url> | --walk <origin>) [--persona <p> [--scenario <s>]]
                                [--out <dir>] [--line <n>] [--threshold <0-1>] [--content <selector>]

  --screen     A screen id from the reference's screen index, for example U4 or P2-D1. The index is
               docs/design-reference/SCREEN_INDEX.md (the v2 master) by default, and SCREEN_INDEX-v1.md
               when KOMTRU_VISUAL_CHECK_REFERENCE=v1 is set.
  --url        The built screen, already running, for example http://localhost:3004/handover/KMT-88213.
  --walk       Use the registered walkthrough for --screen (tools/visual-check/src/walkthroughs.ts): its persona,
               scenario, route and clicks. The value is the app's origin, for example http://localhost:3913.
  --persona    Sign the built app in as ${PERSONA_IDS.join(' | ')} before the shot. Needs the app to run
               against the stand-in (pnpm visual-standin). With --url only.
  --scenario   The stand-in data for --persona: ${SCENARIO_IDS.join(' | ')}. Default: with-trades.
  --out        Where the artefacts go. Default: docs/ui-review.
  --line       The reference line, for the one id the reference draws twice (TO-PA10).
  --content    A selector for the built screen's content, such as main. The built shot starts at its top
               edge, so an app shell the reference does not draw does not offset every line.
  --threshold  Per-pixel colour tolerance passed to pixelmatch. Default: 0.1.

The reference frame sets the width: a mobile screen is compared at 340px, a tablet at 560px and a desktop at
1040px. To capture a built screen at a width of your choosing, with no reference, use \`pnpm visual-capture\`.`;

function fail(message: string): never {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(2);
}

const { values } = (() => {
  try {
    return parseArgs({
      options: {
        screen: { type: 'string' },
        url: { type: 'string' },
        walk: { type: 'string' },
        persona: { type: 'string' },
        scenario: { type: 'string' },
        out: { type: 'string' },
        line: { type: 'string' },
        threshold: { type: 'string' },
        content: { type: 'string' },
      },
      strict: true,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
})();

if (values.screen === undefined) fail('--screen is required.');
if ((values.url === undefined) === (values.walk === undefined)) fail('Pass exactly one of --url and --walk.');
if (values.scenario !== undefined && values.persona === undefined) fail('--scenario needs --persona.');
if (values.walk !== undefined && values.persona !== undefined)
  fail('--walk names its own persona; drop --persona.');

const number = (name: string, raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) fail(`--${name} must be a number, not ${raw}`);
  return parsed;
};

/** The walk for --walk, or the session for --persona, or neither: the plain URL check. */
const plan = ((): { url: string; walk?: Walkthrough; session?: VisualCheckOptions['session'] } => {
  if (values.walk !== undefined) {
    const walk = (() => {
      try {
        return walkFor(values.screen);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    })();
    return {
      url: new URL(walk.path, values.walk).toString(),
      walk,
      session: { persona: walk.persona, scenario: walk.scenario },
    };
  }
  if (values.persona === undefined) return { url: values.url! };
  if (!isPersonaId(values.persona))
    fail(`--persona must be one of ${PERSONA_IDS.join(', ')}, not ${values.persona}`);
  const scenario = values.scenario ?? 'with-trades';
  if (!isScenarioId(scenario)) fail(`--scenario must be one of ${SCENARIO_IDS.join(', ')}, not ${scenario}`);
  return { url: values.url!, session: { persona: values.persona, scenario } };
})();

// Every failure here is an operator problem — the app is not running, the screen id is wrong — so
// it gets a line, not a Node stack trace with a Playwright call log attached.
const result = await visualCheck({
  screen: values.screen,
  url: plan.url,
  outDir: values.out ?? UI_REVIEW_DIR,
  ...(values.line === undefined ? {} : { line: number('line', values.line) }),
  ...(values.content === undefined
    ? plan.walk?.content === undefined
      ? {}
      : { content: plan.walk.content }
    : { content: values.content }),
  ...(values.threshold === undefined ? {} : { threshold: number('threshold', values.threshold) }),
  ...(plan.session === undefined ? {} : { session: plan.session }),
  ...(plan.walk === undefined ? {} : { arrange: arrangeFor(plan.walk) }),
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`visual-check: ${message}\n`);
  if (process.env.KOMTRU_VISUAL_CHECK_TRACE === '1') process.stderr.write(`${String(error)}\n`);
  else process.stderr.write('Set KOMTRU_VISUAL_CHECK_TRACE=1 for the full trace.\n');
  process.exit(1);
});

process.stdout.write(
  [
    `${result.screen} (${result.ticket}) — ${result.compared.width} × ${result.compared.height}`,
    `${result.changed.toLocaleString('en-GB')} of ${result.total.toLocaleString('en-GB')} pixels differ (${(result.ratio * 100).toFixed(2)}%)`,
    `  side by side  ${result.sideBySide}`,
    `  heat map      ${result.heatMap}`,
    `  deviations    ${result.markdown}`,
    '',
  ].join('\n'),
);

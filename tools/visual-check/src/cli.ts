// `pnpm visual-check --screen U4 --url http://localhost:3004/handover/KMT-88213`
import { parseArgs } from 'node:util';

import { UI_REVIEW_DIR, visualCheck } from './run.ts';

const USAGE = `Usage: pnpm visual-check --screen <id> --url <url> [--out <dir>] [--line <n>] [--threshold <0-1>] [--content <selector>]

  --screen     A screen id from the reference's screen index, for example U4 or P2-D1. The index is
               docs/design-reference/SCREEN_INDEX.md (the v2 master) by default, and SCREEN_INDEX-v1.md
               when KOMTRU_VISUAL_CHECK_REFERENCE=v1 is set.
  --url        The built screen, already running, for example http://localhost:3004/handover/KMT-88213.
  --out        Where the artefacts go. Default: docs/ui-review.
  --line       The reference line, for the one id the reference draws twice (TO-PA10).
  --content    A selector for the built screen's content, such as main. The built shot starts at its top
               edge, so an app shell the reference does not draw does not offset every line.
  --threshold  Per-pixel colour tolerance passed to pixelmatch. Default: 0.1.`;

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

if (values.screen === undefined || values.url === undefined) fail('--screen and --url are both required.');

const number = (name: string, raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) fail(`--${name} must be a number, not ${raw}`);
  return parsed;
};

// Every failure here is an operator problem — the app is not running, the screen id is wrong — so
// it gets a line, not a Node stack trace with a Playwright call log attached.
const result = await visualCheck({
  screen: values.screen,
  url: values.url,
  outDir: values.out ?? UI_REVIEW_DIR,
  ...(values.line === undefined ? {} : { line: number('line', values.line) }),
  ...(values.content === undefined ? {} : { content: values.content }),
  ...(values.threshold === undefined ? {} : { threshold: number('threshold', values.threshold) }),
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

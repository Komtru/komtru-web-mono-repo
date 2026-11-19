// `pnpm visual-standin` — the canned platform API for visual checks. No database, no Redis, no Docker.
//
// Start it, then build and serve the frontend against it (see docs/runbooks/visual-check.md). Port:
// KOMTRU_VISUAL_STANDIN_PORT, default 7913.
import { STANDIN_SESSION_SECRET } from './session.ts';
import { STANDIN_DEFAULT_PORT, startStandin } from './server.ts';

const raw = process.env.KOMTRU_VISUAL_STANDIN_PORT;
const port = raw === undefined ? STANDIN_DEFAULT_PORT : Number(raw);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write(`KOMTRU_VISUAL_STANDIN_PORT must be a port number, not ${raw ?? ''}\n`);
  process.exit(2);
}

const running = await startStandin({ port }).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`visual-standin: could not start on port ${port}: ${message}\n`);
  process.exit(1);
});

process.stdout.write(
  [
    `visual-check stand-in listening — API base ${running.apiUrl}`,
    'Build a frontend against it with:',
    `  NEXT_PUBLIC_KOMTRU_API_URL=${running.apiUrl}`,
    'and start it with the session secret the seeder signs with:',
    `  KOMTRU_SESSION_SECRET=${STANDIN_SESSION_SECRET}`,
    'Unmatched requests are logged as UNMATCHED. Ctrl-C to stop.',
    '',
  ].join('\n'),
);

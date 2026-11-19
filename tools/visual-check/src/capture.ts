// A screenshot of a built screen at a width the caller chooses, with no reference to compare against. For
// the states a reference frame does not draw (a tablet treatment of a mobile screen, a dispute reached by a
// walk) and for looking at a screen while building it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { shootBuilt, withBrowser } from './render.ts';
import { arrangeFor, type Walkthrough } from './walk.ts';
import { sessionCookiesFor, STANDIN_NOW_MS } from './standin/session.ts';
import type { PersonaId, ScenarioId } from './standin/personas.ts';

export interface CaptureOptions {
  url: string;
  width: number;
  height: number;
  out: string;
  /** Signs the app in as this persona, against the stand-in. Pins the clock to the stand-in's instant. */
  session?: { persona: PersonaId; scenario: ScenarioId };
  walk?: Walkthrough;
  /** Starts the shot at this element's top edge; see `ShootOptions.contentSelector`. */
  content?: string;
}

export interface CaptureResult {
  file: string;
  width: number;
  height: number;
}

export async function captureBuilt(options: CaptureOptions): Promise<CaptureResult> {
  const cookies =
    options.session === undefined
      ? undefined
      : await sessionCookiesFor(
          options.session.persona,
          options.session.scenario,
          new URL(options.url).hostname,
        );
  const shot = await withBrowser((browser) =>
    shootBuilt(
      browser,
      options.url,
      { width: options.width, height: options.height },
      {
        ...(options.content === undefined ? {} : { contentSelector: options.content }),
        ...(cookies === undefined ? {} : { cookies, clock: STANDIN_NOW_MS }),
        ...(options.walk === undefined ? {} : { arrange: arrangeFor(options.walk) }),
      },
    ),
  );
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, shot.png);
  return { file: options.out, width: shot.width, height: shot.height };
}

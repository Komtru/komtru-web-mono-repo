// Walkthroughs: how a browser reaches a screen that is not a URL of its own, such as a step several taps
// into a flow. A walk is data — a persona, a data scenario, a route and the clicks after it — so a ticket
// names the screen and gets the state, with no hand-written browser script.
import type { Page } from '@playwright/test';

import type { PersonaId, ScenarioId } from './standin/personas.ts';

/**
 * One action after the route loads. Selectors are Playwright selectors, so `role=button[name="Start a Trade"]`
 * and `text=Trades` both work. A step that finds nothing fails the walk: a screen reached by a different
 * path than the one a ticket names is a different screen.
 */
export type WalkStep = { click: string } | { fill: string; value: string } | { waitFor: string };

export interface Walkthrough {
  /** The screen this reaches: a row id of `SCREEN_INDEX.md`. */
  screen: string;
  persona: PersonaId;
  scenario: ScenarioId;
  /** The route the app serves first, such as `/home`. */
  path: string;
  /** Actions after the route loads. Empty for a screen that is a URL of its own. */
  steps?: readonly WalkStep[];
  /** The `--content` selector the shot starts at, when the app draws a shell the reference does not. */
  content?: string;
}

/** Where a session the app does not accept sends the visitor. Matches `signInPath` in web-app-ui. */
export const SIGN_IN_PATH = '/login';

/**
 * The arrange hook `shootBuilt` runs after the route loads. Fails loudly if the app bounced the session to
 * the sign-in page, because a screenshot of the sign-in form filed under a real screen's name is worse
 * than no screenshot.
 */
export function arrangeFor(walk: Walkthrough): (page: Page) => Promise<void> {
  return async (page) => {
    const landed = new URL(page.url());
    if (landed.pathname === SIGN_IN_PATH || landed.pathname.startsWith(`${SIGN_IN_PATH}/`)) {
      throw new Error(
        `${walk.screen}: the app sent the ${walk.persona} session to ${SIGN_IN_PATH}, so it did not accept the seed. ` +
          'Start the app with KOMTRU_SESSION_SECRET=visual-check-standin-session-secret-0001 and rebuild it against the stand-in.',
      );
    }
    await runSteps(page, walk.steps ?? [], walk.screen);
  };
}

export async function runSteps(page: Page, steps: readonly WalkStep[], screen: string): Promise<void> {
  for (const [index, step] of steps.entries()) {
    const at = `${screen}, step ${index + 1}`;
    if ('click' in step) {
      await page
        .locator(step.click)
        .first()
        .click({ timeout: 10_000 })
        .catch((cause: unknown) => {
          throw stepFailure(at, `click ${step.click}`, cause);
        });
    } else if ('fill' in step) {
      await page
        .locator(step.fill)
        .first()
        .fill(step.value, { timeout: 10_000 })
        .catch((cause: unknown) => {
          throw stepFailure(at, `fill ${step.fill}`, cause);
        });
    } else {
      await page
        .locator(step.waitFor)
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .catch((cause: unknown) => {
          throw stepFailure(at, `wait for ${step.waitFor}`, cause);
        });
    }
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  }
}

function stepFailure(at: string, what: string, cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message.split('\n')[0] : String(cause);
  return new Error(`${at}: could not ${what} (${reason})`);
}

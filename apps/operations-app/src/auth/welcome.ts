// The welcome flow's logic, apart from its screen: which step a person is on, and what a platform
// refusal says to them. OP-28 draws six steps; only the first two have a platform behind them.
import { ProblemError } from '@komtru/api-client';

export type StepState = 'done' | 'active' | 'pending';

export interface Step {
  title: string;
  detail: string;
  state: StepState;
}

/** How far the person has got, in the order the reference puts the steps. */
export interface Progress {
  accepted: boolean;
  secured: boolean;
}

/**
 * The six steps of OP-28, with the state each is in. "Accept your invite" and "Secure your account"
 * are real: they are what the platform lets a person do before they have a staff session. The other
 * four are drawn pending and dimmed, as the reference draws everything after the active step, and
 * nothing here pretends they can be done: identity checks, the rules, sample cases and the team
 * lead's sign-off belong to tickets that have not been built.
 */
export function stepsFor({ accepted, secured }: Progress): Step[] {
  const first: StepState = accepted ? 'done' : 'active';
  const second: StepState = !accepted ? 'pending' : secured ? 'done' : 'active';
  return [
    {
      title: 'Accept your invite',
      detail: accepted ? 'Done' : 'Sign in and confirm your email',
      state: first,
    },
    { title: 'Secure your account', detail: 'Two-step sign-in and your device', state: second },
    { title: 'Verify who you are', detail: 'A government ID, once', state: 'pending' },
    {
      title: 'Read the rules',
      detail: 'Conduct, data protection, how decisions are recorded',
      state: 'pending',
    },
    { title: 'Practise on sample cases', detail: 'Three cases, no real money', state: 'pending' },
    { title: 'Sign-off from your team lead', detail: 'Then your access opens', state: 'pending' },
  ];
}

/** "Step 2 of 6": the active step, or the last one done when nothing is active. */
export function stepLabel(steps: readonly Step[]): string {
  const active = steps.findIndex((step) => step.state === 'active');
  const index = active === -1 ? steps.filter((step) => step.state === 'done').length : active + 1;
  return `Step ${String(Math.max(index, 1))} of ${String(steps.length)}`;
}

/** What a refusal says. The platform's own title where it wrote one for a person, else a plain line. */
export function messageForError(error: unknown): string {
  if (error instanceof ProblemError) {
    if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
    if (error.status === 401) return 'Your sign-in ended. Sign in again to carry on.';
    if (error.status >= 400 && error.status < 500 && error.problem.title !== '') {
      return error.problem.detail === undefined || error.problem.detail === ''
        ? error.problem.title
        : `${error.problem.title}. ${error.problem.detail}`;
    }
  }
  return 'Something went wrong on our side. Try again in a moment.';
}

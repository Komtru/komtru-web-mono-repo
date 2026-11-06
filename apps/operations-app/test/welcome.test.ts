import { ProblemError } from '@komtru/api-client';
import { describe, expect, it } from 'vitest';
import { messageForError, stepLabel, stepsFor } from '../src/auth/welcome';

const states = (progress: { accepted: boolean; secured: boolean }) =>
  stepsFor(progress).map((step) => step.state);

describe('the six steps', () => {
  it('start on accepting the invite', () => {
    expect(states({ accepted: false, secured: false })).toEqual([
      'active',
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(stepLabel(stepsFor({ accepted: false, secured: false }))).toBe('Step 1 of 6');
  });

  it('move to securing the account once the invite is accepted, as OP-28 draws it', () => {
    const steps = stepsFor({ accepted: true, secured: false });
    expect(steps.map((step) => step.state)).toEqual([
      'done',
      'active',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(steps[0]?.detail).toBe('Done');
    expect(stepLabel(steps)).toBe('Step 2 of 6');
  });

  it('leave the four steps nothing can do yet pending, with nothing active', () => {
    const steps = stepsFor({ accepted: true, secured: true });
    expect(steps.map((step) => step.state)).toEqual([
      'done',
      'done',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(steps.some((step) => step.state === 'active')).toBe(false);
    expect(stepLabel(steps)).toBe('Step 2 of 6');
  });

  it('name the steps the way the reference does', () => {
    expect(stepsFor({ accepted: false, secured: false }).map((step) => step.title)).toEqual([
      'Accept your invite',
      'Secure your account',
      'Verify who you are',
      'Read the rules',
      'Practise on sample cases',
      'Sign-off from your team lead',
    ]);
  });
});

const problem = (status: number, title: string, detail?: string) =>
  new ProblemError(
    { type: 'about:blank', status, code: 'X', title, ...(detail === undefined ? {} : { detail }) },
    { requestId: undefined, retryAfterMs: undefined, rateLimit: undefined, replayed: false } as never,
    false,
  );

describe('messageForError', () => {
  it("uses the platform's own words for a refusal written for a person", () => {
    expect(messageForError(problem(422, "That code doesn't match", 'Check the message and try again'))).toBe(
      "That code doesn't match. Check the message and try again",
    );
  });

  it('says a throttle is a throttle and a lapsed sign-in is a lapsed sign-in', () => {
    expect(messageForError(problem(429, 'Slow down'))).toContain('Too many');
    expect(messageForError(problem(401, 'Unauthenticated'))).toContain('Sign in again');
  });

  it('does not put a server error in front of a person', () => {
    expect(messageForError(problem(500, 'Internal error: stack trace'))).toBe(
      'Something went wrong on our side. Try again in a moment.',
    );
    expect(messageForError(new TypeError('fetch failed'))).toBe(
      'Something went wrong on our side. Try again in a moment.',
    );
  });
});

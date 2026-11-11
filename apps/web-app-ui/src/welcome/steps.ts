// OB1–OB5: the five screens of the first-time walkthrough, at the reference's own URLs.

export type StepKey = '1' | '2' | '3' | 'notifications' | 'done';

export interface WelcomeStep {
  key: StepKey;
  path: string;
  title: string;
  body: string;
}

/** Copy is the reference's, word for word (OB1–OB4). OB5's heading carries the person's name, so it is built there. */
export const WELCOME_STEPS: readonly WelcomeStep[] = [
  {
    key: '1',
    path: '/welcome/1',
    title: 'Your money stays protected',
    body: 'Payment sits safely with Komtru, not the seller — released only once you confirm the item matches what was agreed.',
  },
  {
    key: '2',
    path: '/welcome/2',
    title: 'Always know where things stand',
    body: 'Every Trade shows a live 5-step timeline — Agreement, Protected, Shipped, Inspection, Release — never a guessing game about what happens next.',
  },
  {
    key: '3',
    path: '/welcome/3',
    title: 'Every trade builds your history',
    body: 'Completed Trades become evidence, not a score — something you can prove and share, not something Komtru assigns you.',
  },
  {
    key: 'notifications',
    path: '/welcome/notifications',
    title: 'Don’t miss a status change',
    body: 'We’ll only notify you about things that actually need your attention — payment protected, item shipped, inspection deadlines. You choose the channel for everything except disputes and fraud alerts, later in Settings.',
  },
  {
    key: 'done',
    path: '/welcome/done',
    title: 'You’re all set',
    body: 'Start your first protected Trade, or find one a seller already sent you.',
  },
];

export const stepFor = (key: string): WelcomeStep | undefined =>
  WELCOME_STEPS.find((step) => step.key === key);

/** The screen after this one, or `undefined` at the end. */
export function nextPath(key: StepKey): string | undefined {
  const index = WELCOME_STEPS.findIndex((step) => step.key === key);
  return WELCOME_STEPS[index + 1]?.path;
}

/** Where the walkthrough hands over to: the app's root sends each person to their mode's landing screen. */
export const AFTER_WELCOME = '/';

// @vitest-environment jsdom
// F-013: the route behind `/welcome/<step>` serves the five screens and 404s anything else.
import { describe, expect, it, vi } from 'vitest';
import WelcomeStepPage from '../app/(app)/welcome/[step]/page';

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({
  notFound: nav.notFound,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const render = (step: string) => WelcomeStepPage({ params: Promise.resolve({ step }) });

describe('/welcome/[step]', () => {
  it.each(['1', '2', '3', 'notifications', 'done'])('serves %s', async (step) => {
    expect(await render(step)).toBeTruthy();
    expect(nav.notFound).not.toHaveBeenCalled();
  });

  it('is not found for any other step', async () => {
    await expect(render('4')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(render('../x')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

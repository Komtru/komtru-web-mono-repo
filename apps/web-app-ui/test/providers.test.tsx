// @vitest-environment jsdom
// The app's one provider tree. `@komtru/app-kit` proves that `socketFollowsSession` connects a socket as the signed-in
// person; nothing there can prove THIS app sets it, and an app that does not gets no realtime at all (its layout
// cannot mint a socket token) while every other test stays green. So the app's own wiring is pinned here.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }));

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@komtru/app-kit/react', () => ({
  createKomtruQueryClient: () => ({ clear: vi.fn() }),
  KomtruProviders: (props: Record<string, unknown> & { children: React.ReactNode }) => {
    captured.props = props;
    return props.children;
  },
}));

import { Providers } from '../src/shell/Providers';

afterEach(() => {
  cleanup();
  captured.props = undefined;
  vi.unstubAllEnvs();
});

describe('the app providers', () => {
  const mount = () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_API_URL', 'https://api.komtru.test/v1');
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_SOCKET_URL', 'https://api.komtru.test');
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_APP_URL', 'https://app.komtru.test');
    return render(
      <Providers>
        <span>app</span>
      </Providers>,
    );
  };

  it('has the socket follow the signed-in session, which is the only way this app can connect one', () => {
    mount();
    expect(captured.props?.socketFollowsSession).toBe(true);
  });

  it('explains a session that ended on its own, and carries the screen the person was on (SP-M16)', async () => {
    window.history.pushState({}, '', '/trades/KMT-9042800-NG?tab=terms');
    mount();
    (captured.props?.onSessionEnded as () => void)();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(
        '/session-expired?next=%2Ftrades%2FKMT-9042800-NG%3Ftab%3Dterms',
      );
    });
  });

  it('does not hand the socket a token of its own to override the session', () => {
    mount();
    expect(captured.props?.socketToken).toBeUndefined();
  });

  it('gives the socket the platform address it was configured with', () => {
    mount();
    expect(captured.props?.config).toEqual({
      apiUrl: 'https://api.komtru.test/v1',
      socketUrl: 'https://api.komtru.test',
    });
  });
});

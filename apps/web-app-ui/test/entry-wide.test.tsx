// @vitest-environment jsdom
//
// The entry screens at tablet and desktop width (F-067, F-072; DX-01, TX-01, and the screens the reference draws on a
// phone only). The phone is held by the suites that already exist and is only spot-checked here: nothing wide is drawn,
// and nothing wide is read for, until a window says it is wide.
import { KomtruProviders } from '@komtru/app-kit/react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from '../src/entry/components/LoginForm';
import {
  ForgotPasswordForm,
  ResetPasswordForm,
  SetPasswordForm,
} from '../src/entry/components/PasswordReset';
import { SignUpForm } from '../src/entry/components/SignUpForm';
import { TermsForm } from '../src/entry/components/TermsForm';
import { FullTerms, TermsUpdated } from '../src/entry/components/TermsScreens';
import { VerifyForm } from '../src/entry/components/VerifyForm';
import { Welcome } from '../src/entry/components/Welcome';
import { clearEntryDrafts, resetCode, signUpCode, signUpDraft } from '../src/entry/drafts';
import { ServiceNotice } from '../src/system/ServiceNotice';
import { SessionExpired } from '../src/system/SessionExpired';
import { TooManyAttempts } from '../src/system/TooManyAttempts';
import { UpdateRequired } from '../src/system/UpdateRequired';
import { expectNoAxeViolations } from './axe';
import { atWidth, resizeTo, unwidth, type Width } from './support/viewport';
import { SHELL_RULES, answerWith, page, renderWithApi, type CallFn } from './support/trade';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
vi.mock('../src/shell/ServiceWorker', () => ({
  clearOfflineCache: () => Promise.resolve(),
  ServiceWorker: () => null,
}));

const API = 'https://api.komtru.com/v1';
const challengeId = '9b2f4c1e-7a3d-4e5b-8c6f-1d0a2b3c4e5f';
const HEADLINE = 'Trade with strangers, protected.';

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

beforeEach(() => {
  clearEntryDrafts();
  api.call.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === `${API}/auth/terms`)
        return json(200, { termsVersion: '2026-09-01', privacyVersion: '2026-09-01' });
      if (url.endsWith('/api/auth/refresh'))
        return json(200, {
          accessToken: 'at-1',
          scope: 'CONSUMER',
          expiresIn: 600,
          expiresAt: 4_000_000_000_000,
        });
      if (url === `${API}/me/terms`)
        return json(200, {
          termsVersion: '2026-09-01',
          privacyVersion: '2026-09-01',
          acceptedTermsVersion: '2026-08-01',
          acceptedPrivacyVersion: '2026-08-01',
          upToDate: false,
        });
      return Promise.reject(new TypeError(`no route for ${url}`));
    }),
  );
});

afterEach(() => {
  cleanup();
  unwidth();
  vi.clearAllMocks();
});

const show = (screenUnderTest: React.ReactNode) =>
  render(
    <KomtruProviders config={{ apiUrl: API, socketUrl: 'https://api.komtru.com' }} session={null}>
      {screenUnderTest}
    </KomtruProviders>,
  );

interface Case {
  name: string;
  /** Draws the screen and waits until what it is waiting for has arrived. */
  open: () => Promise<{ container: HTMLElement; axeRules?: Parameters<typeof expectNoAxeViolations>[1] }>;
  /** The screen's own heading, which every width keeps. */
  heading: RegExp;
  /** The screen's real action, in the footer on a phone and under the form on a wide window. */
  action: { role: 'button' | 'link'; name: string | RegExp };
  /** TX-01's "Have a Trade Code? Enter it here": log in, welcome and sign up only. */
  tabletTradeCode: boolean;
}

const entry = (node: React.ReactNode) => () => Promise.resolve(show(node));

const CASES: Case[] = [
  {
    name: 'E1 Welcome',
    open: entry(<Welcome />),
    heading: /Trade with strangers, protected\./,
    action: { role: 'link', name: 'Create account' },
    tabletTradeCode: true,
  },
  {
    name: 'E4 Log in',
    open: entry(<LoginForm next={undefined} notice={undefined} />),
    heading: /^Log in( to Komtru)?$/,
    action: { role: 'button', name: 'Log in' },
    tabletTradeCode: true,
  },
  {
    name: 'E2 Sign up',
    open: entry(<SignUpForm />),
    heading: /What.s your number\?/,
    action: { role: 'button', name: 'Continue' },
    tabletTradeCode: true,
  },
  {
    name: 'TOS1 Terms',
    open: async () => {
      signUpDraft.write({ phone: '0802 341 5567', email: 'ada@example.com', fullName: 'Ada Obi' });
      const shown = show(<TermsForm />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Agree & create account' })).toBeDefined();
      });
      return shown;
    },
    heading: /Review the Terms of Service and Privacy Policy/,
    action: { role: 'button', name: 'Agree & create account' },
    tabletTradeCode: false,
  },
  {
    name: 'E3 Verify',
    open: () => {
      signUpCode.write({ challengeId, destination: '+23480•••5567', delivered: true, sentAt: Date.now() });
      return Promise.resolve(show(<VerifyForm />));
    },
    heading: /Enter the 6-digit code/,
    action: { role: 'button', name: 'Verify & continue' },
    tabletTradeCode: false,
  },
  {
    name: 'AC2 Forgot password',
    open: entry(<ForgotPasswordForm />),
    heading: /What.s your number\?/,
    action: { role: 'button', name: 'Send reset code' },
    tabletTradeCode: false,
  },
  {
    name: 'AC3 Set new password',
    open: () => {
      resetCode.write({ challengeId, destination: '+23480•••5567', delivered: true, sentAt: Date.now() });
      return Promise.resolve(show(<ResetPasswordForm />));
    },
    heading: /./,
    action: { role: 'button', name: 'Save new password' },
    tabletTradeCode: false,
  },
  {
    name: 'First password after sign-up',
    open: entry(<SetPasswordForm next={undefined} />),
    heading: /./,
    action: { role: 'button', name: /password/i },
    tabletTradeCode: false,
  },
  {
    name: 'TOS2 Terms updated',
    open: async () => {
      const shown = show(<TermsUpdated next="/trades" />);
      await screen.findByRole('heading', { name: "We've updated our Terms" });
      return shown;
    },
    heading: /We.ve updated our Terms/,
    action: { role: 'button', name: 'Agree & continue' },
    tabletTradeCode: false,
  },
  {
    name: 'The Terms in full',
    open: entry(<FullTerms />),
    heading: /Terms of Service and Privacy Policy/,
    action: { role: 'link', name: 'Back' },
    tabletTradeCode: false,
  },
  {
    name: 'SP-M14 Service notice',
    open: async () => {
      answerWith(api.call, { 'GET /geo/states': page([]) });
      const shown = renderWithApi(api.call, <ServiceNotice />);
      await screen.findByRole('heading', { name: 'Komtru is working' });
      return { ...shown, axeRules: SHELL_RULES };
    },
    heading: /Komtru is working/,
    action: { role: 'link', name: 'Back to Trades' },
    tabletTradeCode: false,
  },
  {
    name: 'SP-M15 Update required',
    open: entry(<UpdateRequired />),
    heading: /Please update Komtru/,
    action: { role: 'button', name: 'Update now' },
    tabletTradeCode: false,
  },
  {
    name: 'SP-M16 Session expired',
    open: entry(<SessionExpired next="/trades" />),
    heading: /Please sign in again/,
    action: { role: 'link', name: 'Log in' },
    tabletTradeCode: false,
  },
  {
    name: 'SP-M17 Too many attempts',
    open: entry(<TooManyAttempts waitSeconds={undefined} onRetry={() => undefined} />),
    heading: /Too many tries/,
    action: { role: 'link', name: 'Recover my account' },
    tabletTradeCode: false,
  },
];

const brand = () => screen.queryByRole('complementary', { name: 'Why Komtru' });
const tradeCodeBox = () => screen.queryByRole('search', { name: 'Find a trade by its code' });
const tabletTradeLine = () => screen.queryByRole('region', { name: 'Trade Code' });
const wideBack = () => screen.queryByRole('navigation', { name: 'Back' });

describe('a phone', () => {
  it.each(CASES)('$name draws no brand panel, Trade Code entry or wide Back link', async (screenCase) => {
    await screenCase.open();
    expect(brand()).toBeNull();
    expect(tradeCodeBox()).toBeNull();
    expect(tabletTradeLine()).toBeNull();
    expect(wideBack()).toBeNull();
  });
});

describe.each<{ width: Width }>([{ width: 'tablet' }, { width: 'desktop' }])(
  'a $width window',
  ({ width }) => {
    beforeEach(() => {
      atWidth(width);
    });

    describe.each(CASES)('$name', (screenCase) => {
      it('keeps its heading and its action, and never two Back links', async () => {
        await screenCase.open();
        expect(screen.getAllByRole('heading', { name: screenCase.heading }).length).toBeGreaterThan(0);
        expect(
          screen.getAllByRole(screenCase.action.role, { name: screenCase.action.name }).length,
        ).toBeGreaterThan(0);
        // The phone's top bar is replaced by one plain Back link inside the card or column, never both.
        expect(screen.queryAllByRole('link', { name: 'Back' }).length).toBeLessThanOrEqual(1);
      });

      it('has no accessibility violations', async () => {
        const { container, axeRules } = await screenCase.open();
        await expectNoAxeViolations(container, axeRules);
      });

      if (width === 'tablet') {
        it(
          screenCase.tabletTradeCode
            ? 'draws the card, with the Trade Code one tap away'
            : 'draws the card, without the Trade Code line',
          async () => {
            await screenCase.open();
            expect(brand()).toBeNull();
            expect(tradeCodeBox()).toBeNull();
            if (screenCase.tabletTradeCode) {
              const line = within(tabletTradeLine()!);
              expect(line.getByText(/Have a Trade Code\?/)).toBeDefined();
              expect(line.getByRole('link', { name: 'Enter it here' }).getAttribute('href')).toBe('/find');
            } else {
              expect(tabletTradeLine()).toBeNull();
            }
          },
        );
      } else {
        it('draws the brand story and the Trade Code entry beside it', async () => {
          await screenCase.open();
          const panel = within(brand()!);
          expect(panel.getByText(HEADLINE)).toBeDefined();
          for (const point of [
            'Agree before you pay',
            'Payment stays protected',
            'Every trade builds your record',
          ]) {
            expect(panel.getByText(point)).toBeDefined();
          }
          const search = within(tradeCodeBox()!);
          expect(search.getByLabelText('Have a Trade Code?')).toBeDefined();
          expect(search.getByRole('button', { name: 'Find' })).toBeDefined();
          expect(tabletTradeLine()).toBeNull();
        });
      }
    });
  },
);

describe('the tablet card (TX-01)', () => {
  beforeEach(() => {
    atWidth('tablet');
  });

  it('puts the wordmark and the headline above the log-in card, and the actions side by side in it', () => {
    show(<LoginForm next={undefined} notice={undefined} />);
    expect(screen.getByRole('img', { name: 'Komtru' })).toBeDefined();
    expect(screen.getByText(HEADLINE)).toBeDefined();
    expect(screen.getByLabelText('Phone number or email')).toBeDefined();
    expect(screen.getByLabelText('Password')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Create account' }).getAttribute('href')).toBe('/signup');
  });

  it('puts the wordmark alone above the other cards', () => {
    show(<SignUpForm />);
    expect(screen.getByRole('img', { name: 'Komtru' })).toBeDefined();
    expect(screen.queryByText(HEADLINE)).toBeNull();
  });

  it('keeps one Back link, in the card', () => {
    show(<SignUpForm />);
    const back = within(wideBack()!).getByRole('link', { name: 'Back' });
    expect(back.getAttribute('href')).toBe('/');
    expect(screen.getAllByRole('link', { name: 'Back' })).toHaveLength(1);
  });

  it('draws the welcome card with the logo, the graphic, the copy and both ways in', () => {
    show(<Welcome />);
    expect(screen.getByRole('heading', { level: 1, name: HEADLINE })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Create account' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Log in' })).toBeDefined();
  });
});

describe('the desktop frame (DX-01)', () => {
  beforeEach(() => {
    atWidth('desktop');
  });

  it('draws log in as the reference does', () => {
    show(<LoginForm next={undefined} notice={undefined} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeDefined();
    expect(screen.getByText('Use the phone number or email you signed up with.')).toBeDefined();
    expect(screen.getByLabelText('Phone number or email')).toBeDefined();
    expect(screen.getByLabelText('Password')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe(
      '/reset-password',
    );
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Create account' }).getAttribute('href')).toBe('/signup');
    // The platform has no session length to choose, so the drawn "Keep me signed in" is not a control here.
    expect(screen.queryByText(/Keep me signed in/)).toBeNull();
  });

  it('makes the welcome headline the page heading, once', () => {
    show(<Welcome />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: HEADLINE })).toBeDefined();
    expect(screen.getByText(/Komtru holds payment safely/)).toBeDefined();
  });

  it('takes a Trade Code to the existing find-a-trade screen, which looks it up on arrival', () => {
    show(<SessionExpired next={undefined} />);
    const search = within(tradeCodeBox()!);
    fireEvent.change(search.getByLabelText('Have a Trade Code?'), { target: { value: 'KMT-482731' } });
    fireEvent.click(search.getByRole('button', { name: 'Find' }));
    expect(router.push).toHaveBeenCalledWith('/find?code=KMT-482731-NG');
  });

  it('says what a Trade Code looks like instead of going anywhere when it is not one', () => {
    show(<SessionExpired next={undefined} />);
    const search = within(tradeCodeBox()!);
    fireEvent.change(search.getByLabelText('Have a Trade Code?'), { target: { value: 'hello' } });
    fireEvent.click(search.getByRole('button', { name: 'Find' }));
    expect(router.push).not.toHaveBeenCalled();
    expect(search.getByRole('alert').textContent).toMatch(/isn.t a Trade Code/);
  });

  it('says that a logged-out visitor logs in before the trade is shown', () => {
    show(<SessionExpired next={undefined} />);
    expect(within(tradeCodeBox()!).getByText(/log in first/i)).toBeDefined();
  });
});

describe('a resize while the person is typing', () => {
  const WIDTHS: (Width | 'phone')[] = ['tablet', 'desktop', 'tablet', 'phone', 'desktop', 'phone'];

  it('keeps what was typed into log in, in the same field', () => {
    atWidth('phone');
    show(<LoginForm next={undefined} notice={undefined} />);
    const who = screen.getByLabelText('Phone number');
    const secret = screen.getByLabelText('Password');
    fireEvent.change(who, { target: { value: '0802 341 5567' } });
    fireEvent.change(secret, { target: { value: 'a long passphrase' } });
    for (const width of WIDTHS) {
      resizeTo(width);
      expect(who.isConnected).toBe(true);
      expect(secret.isConnected).toBe(true);
      expect((who as HTMLInputElement).value).toBe('0802 341 5567');
      expect((secret as HTMLInputElement).value).toBe('a long passphrase');
    }
  });

  it('keeps what was typed into sign up, in the same fields', () => {
    atWidth('tablet');
    show(<SignUpForm />);
    const fields = ['Phone number', 'Email address', 'Full name'].map((label) =>
      screen.getByLabelText(label),
    );
    ['0802 341 5567', 'ada@example.com', 'Ada Obi'].forEach((value, index) => {
      fireEvent.change(fields[index]!, { target: { value } });
    });
    for (const width of WIDTHS) {
      resizeTo(width);
      fields.forEach((field, index) => {
        expect(field.isConnected).toBe(true);
        expect((field as HTMLInputElement).value).toBe(
          ['0802 341 5567', 'ada@example.com', 'Ada Obi'][index],
        );
      });
    }
  });

  it('keeps a half-ticked terms form, in the same boxes', () => {
    signUpDraft.write({ phone: '0802 341 5567', email: 'ada@example.com', fullName: 'Ada Obi' });
    atWidth('desktop');
    show(<TermsForm />);
    const [first, second] = screen.getAllByRole<HTMLInputElement>('checkbox');
    fireEvent.click(first!);
    for (const width of WIDTHS) {
      resizeTo(width);
      expect(first!.isConnected).toBe(true);
      expect(first!.checked).toBe(true);
      expect(second!.checked).toBe(false);
    }
  });

  it('keeps the six cells of a code the person has typed', () => {
    signUpCode.write({ challengeId, destination: '+23480•••5567', delivered: true, sentAt: Date.now() });
    atWidth('tablet');
    show(<VerifyForm />);
    const cells = screen.getAllByRole('textbox', { name: /Digit \d of 6/ });
    fireEvent.paste(cells[0]!, { clipboardData: { getData: () => '729401' } });
    for (const width of WIDTHS) {
      resizeTo(width);
      const now = screen.getAllByRole('textbox', { name: /Digit \d of 6/ });
      expect(now[0]!.isConnected).toBe(true);
      expect(now.map((cell) => (cell as HTMLInputElement).value).join('')).toBe('729401');
    }
  });
});

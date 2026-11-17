// @vitest-environment jsdom
// F-045 (SP-M03): what Komtru can use, and your data.
import { NetworkError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivacyScreen } from '../src/account/PrivacyScreen';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES, answerWith, callsTo, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

const permissions = (states: Record<string, string>) => {
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: {
      query: ({ name }: { name: string }) =>
        states[name] === undefined
          ? Promise.reject(new TypeError('unsupported'))
          : Promise.resolve({ state: states[name], addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    },
  });
};

beforeEach(() => {
  api.call.mockReset();
  permissions({ camera: 'granted', geolocation: 'denied', notifications: 'prompt' });
});
afterEach(cleanup);

describe('Privacy & data (SP-M03)', () => {
  it('states what the browser allows in plain words, and says where to change it', async () => {
    const { container } = renderWithApi(api.call, <PrivacyScreen />);
    expect(await screen.findByText('Allowed')).toBeDefined();
    expect(screen.getByText('Blocked in your browser')).toBeDefined();
    expect(screen.getByText('Your browser asks first')).toBeDefined();
    expect(screen.getByText(/Change these in your browser’s site settings/)).toBeDefined();
    expect(
      screen.getByText(
        'Komtru never sells your data. Your Trust Passport shows only what you choose to share.',
      ),
    ).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says "set in your browser" for a permission the browser cannot be asked about, rather than guessing', async () => {
    permissions({ geolocation: 'granted' });
    renderWithApi(api.call, <PrivacyScreen />);
    expect(await screen.findByText('Allowed')).toBeDefined();
    expect(screen.getAllByText('Set in your browser')).toHaveLength(2);
  });

  it('asks for a copy of the data and says when it will be ready', async () => {
    answerWith(api.call, {
      'POST /me/data-export': {
        outcome: 'REQUESTED',
        requestedAt: '2026-11-17T09:00:00.000Z',
        dueBy: '2026-11-18T09:00:00.000Z',
      },
    });
    renderWithApi(api.call, <PrivacyScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Request\s*a copy of my data/ }));
    expect(await screen.findByText('We’re on it')).toBeDefined();
    expect(screen.getByText(/Your copy will be ready by 18 Nov/)).toBeDefined();
    expect(callsTo(api.call, 'POST', '/me/data-export')).toHaveLength(1);
  });

  it('says so when a copy was already asked for', async () => {
    answerWith(api.call, {
      'POST /me/data-export': {
        outcome: 'ALREADY_REQUESTED',
        requestedAt: '2026-11-17T09:00:00.000Z',
        dueBy: '2026-11-18T09:00:00.000Z',
      },
    });
    renderWithApi(api.call, <PrivacyScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Request\s*a copy of my data/ }));
    expect(await screen.findByText('You’ve already asked')).toBeDefined();
  });

  it('says it could not reach Komtru when the request fails with no network, and lets the person try again', async () => {
    let first = true;
    answerWith(api.call, {
      'POST /me/data-export': () => {
        if (first) {
          first = false;
          return new NetworkError('offline');
        }
        return {
          outcome: 'REQUESTED',
          requestedAt: '2026-11-17T09:00:00.000Z',
          dueBy: '2026-11-18T09:00:00.000Z',
        };
      },
    });
    renderWithApi(api.call, <PrivacyScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Request\s*a copy of my data/ }));
    expect(
      await screen.findByText('We couldn’t reach Komtru. Check your connection and try again.'),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Request\s*a copy of my data/ }));
    await waitFor(() => expect(screen.getByText('We’re on it')).toBeDefined());
  });

  it('sends "Delete my data" through the close screens, because erasing closes the account', () => {
    renderWithApi(api.call, <PrivacyScreen />);
    expect(screen.getByRole('link', { name: /Delete my data/ }).getAttribute('href')).toBe(
      '/account/close?erase=1',
    );
    expect(screen.getByRole('link', { name: /Close my account/ }).getAttribute('href')).toBe(
      '/account/close',
    );
  });
});

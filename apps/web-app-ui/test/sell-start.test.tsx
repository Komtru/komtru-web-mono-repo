// @vitest-environment jsdom
// T-121 (SO1): "Tell Us About Your Business", the first step of merchant verification.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SellStart } from '../src/sell/Start';
import { expectNoAxeViolations } from './axe';
import { problem, status } from './support/account';
import { SHELL_RULES, answerWith, callsTo, id, page, renderWithApi, type CallFn } from './support/trade';
import { LAGOS_ID, OGUN_ID, IKEJA_ID, application, states, verifiedOwner } from './support/merchant';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, replace: nav.push }) }));

const cities = page([{ id: id(304), stateId: LAGOS_ID, name: 'Ikeja', active: true }]);

const base = {
  'GET /verification/status': status(verifiedOwner),
  'GET /merchant/applications/me': null,
  'GET /geo/states': page(states),
  'GET /geo/states/:stateId/cities': cities,
};

beforeEach(() => {
  api.call.mockReset();
  nav.push.mockReset();
});
afterEach(cleanup);

describe('Your business, step 1 (SO1)', () => {
  it('draws the reference: identity already verified, the business name, and the step count', async () => {
    answerWith(api.call, base);
    const { container } = renderWithApi(api.call, <SellStart />);
    expect(await screen.findByText('Identity already verified')).toBeDefined();
    expect(screen.getByText('You verified this as a buyer — no need to redo it here.')).toBeDefined();
    expect(screen.getByText('Business or shop name')).toBeDefined();
    expect(screen.getByText('1 / 5')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Continue to category' })).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('does not say the identity is verified when it is not, and points to the check', async () => {
    answerWith(api.call, { ...base, 'GET /verification/status': status() });
    renderWithApi(api.call, <SellStart />);
    expect(await screen.findByText('Verify your ID first')).toBeDefined();
    expect(screen.queryByText('Identity already verified')).toBeNull();
  });

  it('keeps Continue disabled until the name and the registered address are complete', async () => {
    answerWith(api.call, base);
    renderWithApi(api.call, <SellStart />);
    const cont = await screen.findByRole<HTMLButtonElement>('button', { name: 'Continue to category' });
    expect(cont.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Business or shop name'), { target: { value: 'TechEdge NG' } });
    fireEvent.change(screen.getByLabelText('Registered address'), { target: { value: '12 Allen Avenue' } });
    fireEvent.change(await screen.findByLabelText('State'), { target: { value: LAGOS_ID } });
    await screen.findByRole('option', { name: 'Ikeja' });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: IKEJA_ID } });
    expect(cont.disabled).toBe(false);
  });

  it('saves the fields this step owns and moves on to category', async () => {
    answerWith(api.call, {
      ...base,
      'PUT /merchant/applications/me': application({ form: { businessName: 'TechEdge NG' } }),
    });
    renderWithApi(api.call, <SellStart />);
    await screen.findByText('Identity already verified');
    fireEvent.change(screen.getByLabelText('Business or shop name'), { target: { value: ' TechEdge NG ' } });
    fireEvent.change(screen.getByLabelText('Registered address'), { target: { value: '12 Allen Avenue' } });
    fireEvent.change(await screen.findByLabelText('State'), { target: { value: LAGOS_ID } });
    await screen.findByRole('option', { name: 'Ikeja' });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: IKEJA_ID } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to category' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/account/verification/merchant/category'));
    expect(callsTo(api.call, 'PUT', '/merchant/applications/me')[0]?.body).toEqual({
      businessName: 'TechEdge NG',
      addressLine: '12 Allen Avenue',
      stateId: LAGOS_ID,
      cityId: IKEJA_ID,
    });
  });

  it('shows what the person already entered when they come back', async () => {
    answerWith(api.call, {
      ...base,
      'GET /merchant/applications/me': application({
        form: {
          businessName: 'TechEdge NG',
          addressLine: '12 Allen Avenue',
          stateId: OGUN_ID,
          cityId: IKEJA_ID,
        },
      }),
    });
    renderWithApi(api.call, <SellStart />);
    expect((await screen.findByLabelText<HTMLInputElement>('Business or shop name')).value).toBe(
      'TechEdge NG',
    );
    expect(screen.getByLabelText<HTMLInputElement>('Registered address').value).toBe('12 Allen Avenue');
  });

  it('shows a loading state, then a load failure with a retry', async () => {
    answerWith(api.call, { ...base, 'GET /merchant/applications/me': problem('INTERNAL', 500) });
    renderWithApi(api.call, <SellStart />);
    expect(await screen.findByText('Couldn’t load your application')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('shows the offline state when a read fails with no network', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    try {
      answerWith(api.call, { ...base, 'GET /merchant/applications/me': problem('INTERNAL', 500) });
      renderWithApi(api.call, <SellStart />);
      expect(await screen.findByText('You’re offline')).toBeDefined();
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    }
  });
});

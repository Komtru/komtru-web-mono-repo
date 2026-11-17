// @vitest-environment jsdom
// F-044 (SP-M01, SP-M02): saved addresses, and adding or editing one, against the platform's own address routes.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddressForm } from '../src/account/addresses/AddressForm';
import { AddressList } from '../src/account/addresses/AddressList';
import { expectNoAxeViolations } from './axe';
import { problem } from './support/account';
import {
  SHELL_RULES,
  address,
  answerWith,
  callsTo,
  id,
  page,
  renderWithApi,
  type CallFn,
} from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, replace: nav.push }) }));

const setOnline = (online: boolean) =>
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });

beforeEach(() => {
  api.call.mockReset();
  nav.push.mockReset();
});
afterEach(() => {
  cleanup();
  setOnline(true);
});

const LAGOS = id(70);
const OGUN = id(72);
const GEO = {
  'GET /geo/states': page([
    { id: LAGOS, code: 'LA', name: 'Lagos' },
    { id: OGUN, code: 'OG', name: 'Ogun' },
  ]),
  'GET /geo/states/:stateId/cities': (input: { params?: Record<string, string> }) =>
    page(
      input.params?.stateId === LAGOS
        ? [
            { id: id(71), stateId: LAGOS, name: 'Ikeja', active: true },
            { id: id(73), stateId: LAGOS, name: 'Lekki', active: true },
          ]
        : [{ id: id(74), stateId: OGUN, name: 'Abeokuta', active: true }],
    ),
};

describe('Saved addresses (SP-M01)', () => {
  it('lists the addresses, says which is the default and what that means, and offers to add one', async () => {
    answerWith(api.call, {
      'GET /me/addresses': page([
        address(1, { label: 'Home', recipientPhone: '+2348032214471', landmark: 'Opposite Fidelity Bank' }),
        address(2, { label: 'Work', isDefault: false }),
      ]),
    });
    const { container } = renderWithApi(api.call, <AddressList />);
    expect(await screen.findByRole('heading', { name: 'Saved Addresses' })).toBeDefined();
    const list = await screen.findByRole('list', { name: 'Your addresses' });
    expect(within(list).getAllByRole('link', { name: /^Edit / })).toHaveLength(2);
    expect(list.textContent).toContain('Home');
    expect(list.textContent).toContain('12 Allen Avenue, Ikeja, Lagos');
    expect(list.textContent).toContain('0803 221 4471');
    expect(screen.getByText('Default · chosen first on a new Trade')).toBeDefined();
    expect(screen.getAllByText(/Default/)).toHaveLength(1);
    expect(screen.getByText(/we choose your default address first/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Add an address' }).getAttribute('href')).toBe(
      '/account/addresses/new',
    );
    expect(screen.getByRole('link', { name: 'Edit Home' }).getAttribute('href')).toBe(
      `/account/addresses/${id(1)}`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows loading while the first read is in flight', async () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    const { container } = renderWithApi(api.call, <AddressList />);
    expect(screen.getByRole('status', { name: 'Loading your addresses' })).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says there are none yet, and why to add one', async () => {
    answerWith(api.call, { 'GET /me/addresses': page([]) });
    const { container } = renderWithApi(api.call, <AddressList />);
    expect(await screen.findByText('No saved addresses yet')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Add an address' })).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says the read failed, and tries again', async () => {
    answerWith(api.call, { 'GET /me/addresses': problem('INTERNAL', 500) });
    const { container } = renderWithApi(api.call, <AddressList />);
    expect(await screen.findByText('Couldn’t load your addresses')).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
    answerWith(api.call, { 'GET /me/addresses': page([address(1)]) });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Home')).toBeDefined();
  });

  it('says offline in the person’s own words when the read fails with no network', async () => {
    setOnline(false);
    answerWith(api.call, { 'GET /me/addresses': new TypeError('Failed to fetch') });
    const { container } = renderWithApi(api.call, <AddressList />);
    expect(await screen.findByText('You’re offline')).toBeDefined();
    expect(screen.getByText(/Reconnect to see your addresses/)).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('makes another address the default', async () => {
    answerWith(api.call, {
      'GET /me/addresses': page([address(1), address(2, { label: 'Work', isDefault: false })]),
      'POST /me/addresses/:id/default': address(2, { label: 'Work', isDefault: true }),
    });
    renderWithApi(api.call, <AddressList />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make Work the default' }));
    await waitFor(() => expect(callsTo(api.call, 'POST', '/me/addresses/:id/default')).toHaveLength(1));
    expect(callsTo(api.call, 'POST', '/me/addresses/:id/default')[0]?.params).toEqual({ id: id(2) });
  });

  it('asks before it removes, says trades keep their address, then archives it', async () => {
    answerWith(api.call, {
      'GET /me/addresses': page([address(1), address(2, { label: 'Work', isDefault: false })]),
      'POST /me/addresses/:id/archive': address(2, { archivedAt: '2026-11-17T10:00:00.000Z' }),
    });
    renderWithApi(api.call, <AddressList />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Work' }));
    const sheet = await screen.findByRole('dialog', { name: 'Remove this address?' });
    expect(sheet.textContent).toContain('Trades already agreed keep the address they were agreed with');
    await expectNoAxeViolations(sheet, SHELL_RULES);
    expect(callsTo(api.call, 'POST', '/me/addresses/:id/archive')).toHaveLength(0);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove address' }));
    await waitFor(() => expect(callsTo(api.call, 'POST', '/me/addresses/:id/archive')).toHaveLength(1));
  });

  it('flags an address whose city has left the catalog, and says how to fix it', async () => {
    answerWith(api.call, { 'GET /me/addresses': page([address(1, { cityActive: false })]) });
    renderWithApi(api.call, <AddressList />);
    expect(await screen.findByText(/no longer in our city list/)).toBeDefined();
  });

  it('holds "Add an address" at the platform’s cap and says so', async () => {
    answerWith(api.call, {
      'GET /me/addresses': page(Array.from({ length: 20 }, (_, n) => address(n + 1, { isDefault: n === 0 }))),
    });
    renderWithApi(api.call, <AddressList />);
    expect(await screen.findByText(/You can keep 20 addresses/)).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Add an address' })).toBeNull();
  });

  it('says a failed change failed, and that nothing changed', async () => {
    answerWith(api.call, {
      'GET /me/addresses': page([address(1), address(2, { isDefault: false })]),
      'POST /me/addresses/:id/default': problem('INTERNAL', 500),
    });
    const { container } = renderWithApi(api.call, <AddressList />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make Address 2 the default' }));
    expect(
      await screen.findByText('We couldn’t change your default address. Nothing was changed.'),
    ).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('Add an address (SP-M02)', () => {
  it('draws the platform’s fields, and refuses to save until they are given', async () => {
    answerWith(api.call, { 'GET /me/addresses': page([address(1)]), ...GEO });
    const { container } = renderWithApi(api.call, <AddressForm />);
    expect(await screen.findByRole('heading', { name: 'Add Address' })).toBeDefined();
    for (const label of [
      'Label',
      'Recipient name',
      'Phone',
      'Address',
      'Landmark (optional)',
      'State',
      'City',
    ]) {
      expect(screen.getByLabelText(label)).toBeDefined();
    }
    expect(screen.getByRole('switch', { name: 'Make this my default address' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    expect(
      await screen.findByText('Fill in every field except the landmark to save this address.'),
    ).toBeDefined();
    expect(callsTo(api.call, 'POST', '/me/addresses')).toHaveLength(0);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('saves with the chosen state and city and goes back to the list', async () => {
    answerWith(api.call, {
      'GET /me/addresses': page([address(1)]),
      ...GEO,
      'POST /me/addresses': address(5, { label: 'Shop' }),
    });
    renderWithApi(api.call, <AddressForm />);
    await screen.findByRole('heading', { name: 'Add Address' });
    type('Label', 'Shop');
    type('Recipient name', 'Ada Obi');
    type('Phone', '0803 221 4471');
    type('Address', 'Admiralty Way, Lekki Phase 1');
    type('Landmark (optional)', 'Opposite Fidelity Bank');
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Lagos' })).toHaveLength(1));
    type('State', LAGOS);
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Lekki' })).toHaveLength(1));
    type('City', id(73));
    fireEvent.click(screen.getByRole('switch', { name: 'Make this my default address' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() => expect(callsTo(api.call, 'POST', '/me/addresses')).toHaveLength(1));
    expect(callsTo(api.call, 'POST', '/me/addresses')[0]?.body).toEqual({
      label: 'Shop',
      recipientName: 'Ada Obi',
      recipientPhone: '0803 221 4471',
      streetLine: 'Admiralty Way, Lekki Phase 1',
      landmark: 'Opposite Fidelity Bank',
      stateId: LAGOS,
      cityId: id(73),
      makeDefault: true,
    });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/account/addresses'));
  });

  it('clears the city when the state changes, so a city of another state is never sent', async () => {
    answerWith(api.call, { 'GET /me/addresses': page([]), ...GEO });
    renderWithApi(api.call, <AddressForm />);
    await screen.findByRole('heading', { name: 'Add Address' });
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Lagos' })).toHaveLength(1));
    type('State', LAGOS);
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Ikeja' })).toHaveLength(1));
    type('City', id(71));
    type('State', OGUN);
    expect(screen.getByLabelText<HTMLSelectElement>('City').value).toBe('');
  });

  it('says why a save failed, in the person’s words, and keeps what they typed', async () => {
    answerWith(api.call, {
      'GET /me/addresses': page([address(1)]),
      ...GEO,
      'POST /me/addresses': problem('VALIDATION_FAILED', 422),
    });
    const { container } = renderWithApi(api.call, <AddressForm />);
    await screen.findByRole('heading', { name: 'Add Address' });
    type('Label', 'Shop');
    type('Recipient name', 'Ada Obi');
    type('Phone', '12345678');
    type('Address', '1 Road');
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Lagos' })).toHaveLength(1));
    type('State', LAGOS);
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Ikeja' })).toHaveLength(1));
    type('City', id(71));
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    expect(await screen.findByText(/Check the phone number/)).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>('Label').value).toBe('Shop');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says the states did not load, and offers another go', async () => {
    answerWith(api.call, { 'GET /me/addresses': page([]), 'GET /geo/states': problem('INTERNAL', 500) });
    const { container } = renderWithApi(api.call, <AddressForm />);
    expect(await screen.findByText('We couldn’t load the list of states.')).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('asks for a city that is not listed, against the chosen state', async () => {
    answerWith(api.call, {
      'GET /me/addresses': page([]),
      ...GEO,
      'POST /geo/city-requests': {
        id: id(900),
        stateId: LAGOS,
        cityName: 'Epe',
        status: 'PENDING',
        resolvedCityId: null,
        decisionReason: null,
        createdAt: '2026-11-17T10:00:00.000Z',
        decidedAt: null,
      },
    });
    const { container } = renderWithApi(api.call, <AddressForm />);
    await screen.findByRole('heading', { name: 'Add Address' });
    expect(screen.queryByRole('button', { name: 'My city isn’t listed' })).toBeNull();
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Lagos' })).toHaveLength(1));
    type('State', LAGOS);
    fireEvent.click(screen.getByRole('button', { name: 'My city isn’t listed' }));
    type('City name', 'Epe');
    fireEvent.click(screen.getByRole('button', { name: 'Ask us to add it' }));
    expect(await screen.findByText(/We’ve passed Epe to the team/)).toBeDefined();
    expect(callsTo(api.call, 'POST', '/geo/city-requests')[0]?.body).toEqual({
      stateId: LAGOS,
      cityName: 'Epe',
    });
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('Edit an address (SP-M02)', () => {
  it('opens with what is saved, and sends only what changed', async () => {
    answerWith(api.call, {
      'GET /me/addresses': page([
        address(1, { landmark: 'Near the gate', recipientPhone: '+2348032214471' }),
      ]),
      ...GEO,
      'PATCH /me/addresses/:id': address(1),
    });
    renderWithApi(api.call, <AddressForm addressId={id(1)} />);
    expect(await screen.findByLabelText('Label')).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>('Label').value).toBe('Home');
    expect(screen.getByLabelText<HTMLInputElement>('Phone').value).toBe('0803 221 4471');
    expect(screen.getByLabelText<HTMLInputElement>('Landmark (optional)').value).toBe('Near the gate');
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('City').value).toBe(id(71)));
    expect(screen.queryByRole('switch', { name: 'Make this my default address' })).toBeNull();
    expect(screen.getByText('This is your default address.')).toBeDefined();
    type('Label', 'Home (Lekki)');
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() => expect(callsTo(api.call, 'PATCH', '/me/addresses/:id')).toHaveLength(1));
    const call = callsTo(api.call, 'PATCH', '/me/addresses/:id')[0];
    expect(call?.params).toEqual({ id: id(1) });
    expect(call?.body).toEqual({ label: 'Home (Lekki)' });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/account/addresses'));
  });

  it('can clear the landmark', async () => {
    answerWith(api.call, {
      'GET /me/addresses': page([address(1, { landmark: 'Near the gate' })]),
      ...GEO,
      'PATCH /me/addresses/:id': address(1),
    });
    renderWithApi(api.call, <AddressForm addressId={id(1)} />);
    await screen.findByLabelText('Label');
    type('Landmark (optional)', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() => expect(callsTo(api.call, 'PATCH', '/me/addresses/:id')).toHaveLength(1));
    expect(callsTo(api.call, 'PATCH', '/me/addresses/:id')[0]?.body).toEqual({ landmark: null });
  });

  it('makes a non-default address the default after saving when the switch is on', async () => {
    answerWith(api.call, {
      'GET /me/addresses': page([address(1), address(2, { label: 'Work', isDefault: false })]),
      ...GEO,
      'PATCH /me/addresses/:id': address(2),
      'POST /me/addresses/:id/default': address(2, { isDefault: true }),
    });
    renderWithApi(api.call, <AddressForm addressId={id(2)} />);
    await screen.findByLabelText('Label');
    fireEvent.click(screen.getByRole('switch', { name: 'Make this my default address' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() => expect(callsTo(api.call, 'POST', '/me/addresses/:id/default')).toHaveLength(1));
    expect(callsTo(api.call, 'PATCH', '/me/addresses/:id')).toHaveLength(0);
  });

  it('says the address is not there when it was removed or is not theirs', async () => {
    answerWith(api.call, { 'GET /me/addresses': page([address(1)]), ...GEO });
    const { container } = renderWithApi(api.call, <AddressForm addressId={id(99)} />);
    expect(await screen.findByText('We can’t find that address')).toBeDefined();
    expect(screen.getByRole('link', { name: 'See your saved addresses' }).getAttribute('href')).toBe(
      '/account/addresses',
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows loading and the offline state while the saved address is read', async () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    const loading = renderWithApi(api.call, <AddressForm addressId={id(1)} />);
    expect(screen.getByRole('status', { name: 'Loading your address' })).toBeDefined();
    await expectNoAxeViolations(loading.container, SHELL_RULES);
    cleanup();
    setOnline(false);
    answerWith(api.call, { 'GET /me/addresses': new TypeError('Failed to fetch') });
    const offline = renderWithApi(api.call, <AddressForm addressId={id(1)} />);
    expect(await screen.findByText('You’re offline')).toBeDefined();
    await expectNoAxeViolations(offline.container, SHELL_RULES);
  });
});

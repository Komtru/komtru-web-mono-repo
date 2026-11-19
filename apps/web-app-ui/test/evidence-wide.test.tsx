// @vitest-environment jsdom
// F-069 and F-073: Evidence across the Trade at a desktop (DX-38) and a tablet (TX-22). The groups are the phone's (see
// delivery-evidence.test.tsx); these pin how the three states are arranged, and what is not invented for them.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Evidence } from '../src/trade/delivery/Evidence';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  fileRead,
  id,
  inspectionRead,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';
import { atWidth, unwidth, type Width } from './support/viewport';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
beforeEach(() => {
  api.call.mockReset();
});
afterEach(() => {
  cleanup();
  unwidth();
});

const show = (width: Width, status = 'INSPECTION') => {
  atWidth(width);
  answerWith(api.call, {
    'GET /trades/:id': workspaceTrade(status, 'BUYER'),
    'GET /trades/:id/inspection': inspectionRead(),
    'GET /trades/:id/evidence': { items: [], nextCursor: null },
    'GET /files/:id': fileRead(7),
  });
  return renderWithApi(api.call, <Evidence id={id(1)} />);
};

describe('DX-38: the same media in three states, side by side', () => {
  it('draws Before you accept, During the Trade and After it’s complete as three panels', async () => {
    show('desktop');
    const before = await screen.findByRole('region', { name: 'Before you accept' });
    const during = screen.getByRole('region', { name: 'During the Trade' });
    const after = screen.getByRole('region', { name: 'After it’s complete' });
    expect(screen.queryByRole('group', { name: /Which state/ })).toBeNull();
    await waitFor(() => expect(within(before).getAllByRole('img')).toHaveLength(2));
    expect(within(before).getByText('Shown when the Trade was agreed')).toBeTruthy();
    // During: the groups the phone draws, each with its own state.
    expect(within(during).getByRole('region', { name: 'Dispatch' })).toBeTruthy();
    expect(within(during).getByRole('region', { name: 'Delivery' })).toBeTruthy();
    expect(within(during).getByText(/Nothing can be edited or deleted/)).toBeTruthy();
    // After: the Trade is not complete, so it says so instead of drawing a record that does not exist.
    expect(within(after).getByText('The record is there once the Trade is complete')).toBeTruthy();
  });

  it('draws the record once the Trade is complete, and invents no retention period or download', async () => {
    show('desktop', 'SETTLED');
    const after = await screen.findByRole('region', { name: 'After it’s complete' });
    expect(await within(after).findByLabelText('Evidence kept with this Trade')).toBeTruthy();
    expect(within(after).getByRole('link', { name: 'Receipt & documents' })).toBeTruthy();
    expect(screen.queryByText(/months/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = show('desktop');
    await screen.findByRole('region', { name: 'Before you accept' });
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('TX-22: a segmented control, one column at a time', () => {
  it('opens on During the Trade for a Trade that is running, and moves between the three states', async () => {
    show('tablet');
    expect(await screen.findByRole('region', { name: 'During the Trade' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Before you accept' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Before you accept' }));
    expect(screen.getByRole('region', { name: 'Before you accept' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'During the Trade' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'After it’s complete' }));
    expect(screen.getByText('The record is there once the Trade is complete')).toBeTruthy();
  });

  it('opens on the record when the Trade is complete', async () => {
    show('tablet', 'SETTLED');
    expect(await screen.findByRole('region', { name: 'After it’s complete' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'After it’s complete' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('has no accessibility violations', async () => {
    const { container } = show('tablet');
    await screen.findByRole('region', { name: 'During the Trade' });
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

// @vitest-environment jsdom
// F-069 and F-073: Inspect & compare at a desktop (DX-23) and a tablet (TX-14). The flow is the phone's (see
// inspect.test.tsx); these pin what the wider drawings change: the panels, and that the actions are still there.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inspect } from '../src/trade/inspection/Inspect';
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
import { atWidth, panelOf, resizeTo, unwidth, type Width } from './support/viewport';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(() => {
  cleanup();
  unwidth();
});

const show = (width: Width, read: unknown = inspectionRead()) => {
  atWidth(width);
  answerWith(api.call, {
    'GET /trades/:id': workspaceTrade('INSPECTION', 'BUYER'),
    'GET /trades/:id/inspection': read,
    'GET /files/:id': (input: { params?: Record<string, string> }) =>
      fileRead(input.params?.id === id(8) ? 8 : 7),
  });
  return renderWithApi(api.call, <Inspect id={id(1)} />);
};

describe('DX-23: what the seller showed beside what you received', () => {
  it('draws both panels at once, with no pills to swap between them', async () => {
    show('desktop');
    const seller = panelOf(await screen.findByRole('heading', { name: 'What the seller showed' }));
    const mine = panelOf(screen.getByRole('heading', { name: 'What you received' }));
    expect(screen.queryByRole('group', { name: 'Which photos to look at' })).toBeNull();
    await waitFor(() => expect(within(seller).getAllByRole('img')).toHaveLength(2));
    // What you received: your own photos, the platform's record of the delivery, and the checks.
    expect(within(mine).getByRole('region', { name: 'My photos' })).toBeTruthy();
    expect(within(mine).getByLabelText('Delivery evidence')).toBeTruthy();
    expect(within(mine).getByRole('group', { name: 'Does it match?' })).toBeTruthy();
    // The panels are headings, not landmarks, and the headings inside them sit one level down.
    expect(within(mine).getByRole('heading', { level: 3, name: 'Does it match?' })).toBeTruthy();
  });

  it('keeps every action: confirm and release, ask for more time, back to the trade', async () => {
    show('desktop');
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & Release Payment' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask for more time' })).toBeTruthy();
    // The header's way back and the action row's: both lead to the trade.
    const back = screen.getAllByRole('link', { name: 'Back to the trade' });
    expect(back).toHaveLength(2);
    back.forEach((link) => {
      expect(link.getAttribute('href')).toBe(`/trade/${id(1)}`);
    });
  });

  it('has no accessibility violations', async () => {
    const { container } = show('desktop');
    await screen.findByRole('heading', { name: 'What the seller showed' });
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('TX-14: a segmented control instead of two cramped panes', () => {
  it('swaps the seller’s proof and your photos, with the checks beside them', async () => {
    show('tablet');
    expect(await screen.findByRole('heading', { name: 'Photos' })).toBeTruthy();
    expect(await screen.findByRole('region', { name: "Seller's proof" })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'My photos' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'My photos' }));
    expect(screen.getByRole('region', { name: 'My photos' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: "Seller's proof" })).toBeNull();

    const checks = panelOf(screen.getByRole('heading', { name: 'Checks' }));
    expect(within(checks).getAllByRole('checkbox')).toHaveLength(4);
  });

  it('keeps confirm and release one press away, and the sheet still opens', async () => {
    show('tablet');
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & Release Payment' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    const { container } = show('tablet');
    await screen.findByRole('heading', { name: 'Checks' });
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('a change of width while the screen is open', () => {
  it('keeps the photos the buyer chose and the checks they ticked', async () => {
    show('desktop');
    const mine = panelOf(await screen.findByRole('heading', { name: 'What you received' }));
    const photo = new File(['x'], 'imei-screen.jpg', { type: 'image/jpeg' });
    fireEvent.change(mine.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [photo] },
    });
    expect(within(mine).getByRole('img', { name: 'imei-screen.jpg' })).toBeTruthy();
    fireEvent.click(within(mine).getByRole('checkbox', { name: 'IMEI matches the label' }));

    // The tablet is turned: the layout changes, the work does not.
    resizeTo('tablet');
    expect(await screen.findByRole('checkbox', { name: 'IMEI matches the label' })).toHaveProperty(
      'checked',
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'My photos' }));
    expect(screen.getByRole('img', { name: 'imei-screen.jpg' })).toBeTruthy();

    resizeTo('mobile');
    expect(screen.getByRole('checkbox', { name: 'IMEI matches the label' })).toHaveProperty('checked', true);
  });

  it('ties the pills to the photos they show', async () => {
    show('tablet');
    const pill = await screen.findByRole('button', { name: 'My photos' });
    const target = pill.getAttribute('aria-controls') ?? '';
    expect(target).not.toBe('');
    expect(document.getElementById(target)).not.toBeNull();
  });
});

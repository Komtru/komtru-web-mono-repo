// @vitest-environment jsdom
// F-028 / CWT-S13: Evidence - Submit. Upload first (signed ticket, storage, finalize), then attach the file ids to the
// trade under an event.
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddEvidence } from '../src/trade/delivery/AddEvidence';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  callsTo,
  id,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
afterEach(cleanup);
beforeEach(() => {
  api.call.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
  );
});

let ticket = 0;
const uploads = {
  'POST /files/upload-url': () => {
    ticket += 1;
    return {
      fileId: id(60 + ticket),
      cloudName: 'komtru',
      uploadUrl: 'https://upload.test/x',
      params: { signature: 's' },
      maxBytes: 5_000_000,
      expiresAt: '2026-11-11T12:00:00.000Z',
    };
  },
  'POST /files/:id/finalize': (input: { params?: { id?: string } }) => ({
    fileId: input.params?.id ?? id(61),
    uploadState: 'PENDING',
  }),
};
const stored = (event: string, fileId: string) => ({
  evidence: [{ id: id(900), fileId, event, attachedByRole: 'BUYER', attachedAt: '2026-11-17T10:00:00.000Z' }],
});

const serve = (trade: unknown, more: Record<string, unknown> = {}) => {
  ticket = 0;
  answerWith(api.call, {
    'GET /trades/:id': trade,
    ...uploads,
    'POST /trades/:id/evidence': (input: { body?: { event?: string; fileIds?: string[] } }) =>
      stored(input.body?.event ?? 'DELIVERY', input.body?.fileIds?.[0] ?? id(61)),
    ...more,
  });
  return renderWithApi(api.call, <AddEvidence id={id(1)} waitMs={0} />);
};

const pick = (container: HTMLElement, ...names: string[]) =>
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: {
      files: names.map(
        (name) => new File(['x'], name, { type: name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg' }),
      ),
    },
  });
const submit = () => screen.getByRole<HTMLButtonElement>('button', { name: /Submit evidence|Submitting/ });

describe('CWT-S13 add evidence', () => {
  it('offers the buyer the events they may add, with the first chosen, and keeps Submit shut until a file is added', async () => {
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'));
    expect(
      await screen.findByText(
        'Choose the event and attach the media that supports your trade record or case.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Add Evidence' })).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Evidence category' });
    const options = [...group.querySelectorAll('input[type="radio"]')].map(
      (r) => (r as HTMLInputElement).value,
    );
    // Dispatch is the seller's to add.
    expect(options).toEqual(['INSPECTION', 'DELIVERY', 'ISSUE']);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Inspection' }).checked).toBe(true);
    expect(screen.getByText('Add photos and video')).toBeTruthy();
    expect(screen.getByText('Stored with this trade')).toBeTruthy();
    expect(submit().disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/evidence`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('offers the seller dispatch, delivery and issue, and not inspection', async () => {
    serve(workspaceTrade('SHIPPED', 'SELLER'));
    await screen.findByRole('group', { name: 'Evidence category' });
    expect(screen.queryByRole('radio', { name: 'Inspection' })).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Dispatch' }).checked).toBe(true);
    expect(screen.getByRole('radio', { name: 'Delivery' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Issue' })).toBeTruthy();
  });

  it('uploads each file first, then attaches the ids under the chosen event, and says it is done', async () => {
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'));
    await screen.findByRole('group', { name: 'Evidence category' });
    fireEvent.click(screen.getByRole('radio', { name: 'Delivery' }));
    pick(container, 'box.jpg', 'unboxing.mp4');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove unboxing.mp4' })).toBeTruthy();
    });
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    expect(await screen.findByText('Evidence added')).toBeTruthy();
    const order = api.call.mock.calls.map(([e]) => `${e.method.toUpperCase()} ${e.path}`);
    expect(order.indexOf('POST /trades/:id/evidence')).toBeGreaterThan(
      order.lastIndexOf('POST /files/:id/finalize'),
    );
    expect(callsTo(api.call, 'POST', '/trades/:id/evidence')).toEqual([
      { params: { id: id(1) }, body: { event: 'DELIVERY', fileIds: [id(61), id(62)] } },
    ]);
    expect(screen.getByRole('link', { name: 'View trade evidence' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/evidence`,
    );
  });

  it('lets a wrong file come off before it is sent', async () => {
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'));
    await screen.findByRole('group', { name: 'Evidence category' });
    pick(container, 'wrong.jpg');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove wrong.jpg' }));
    expect(screen.queryByRole('button', { name: 'Remove wrong.jpg' })).toBeNull();
    expect(submit().disabled).toBe(true);
  });

  it('turns away a file that is not a photo or video, in words, and attaches nothing', async () => {
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'));
    await screen.findByRole('group', { name: 'Evidence category' });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByText(/notes\.pdf isn’t a photo or video/)).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/files/upload-url')).toHaveLength(0);
  });

  it('says a failed upload plainly and keeps what was already added', async () => {
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'));
    await screen.findByRole('group', { name: 'Evidence category' });
    pick(container, 'good.jpg');
    await screen.findByRole('button', { name: 'Remove good.jpg' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    pick(container, 'lost.jpg');
    expect(await screen.findByText(/lost\.jpg didn’t upload/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove good.jpg' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove lost.jpg' })).toBeNull();
  });

  it('waits out a file that is still processing and attaches it once it is ready', async () => {
    let attempts = 0;
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'), {
      'POST /trades/:id/evidence': (input: { body?: { fileIds?: string[] } }) => {
        attempts += 1;
        if (attempts < 3) {
          throw new ProblemError(
            {
              type: 'about:blank',
              title: 'A file is still being processed',
              status: 409,
              code: 'CONFLICT',
              reason: 'FILE_PROCESSING',
            },
            {
              status: 409,
              requestId: undefined,
              retryAfterMs: undefined,
              rateLimit: undefined,
              replayed: false,
            },
            false,
          );
        }
        return stored('INSPECTION', input.body?.fileIds?.[0] ?? id(61));
      },
    });
    await screen.findByRole('group', { name: 'Evidence category' });
    pick(container, 'late.jpg');
    await screen.findByRole('button', { name: 'Remove late.jpg' });
    fireEvent.click(submit());
    expect(await screen.findByText('Evidence added')).toBeTruthy();
    expect(attempts).toBe(3);
  });

  it('says what the platform refused, keeps the files, and lets the person try again', async () => {
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'), {
      'POST /trades/:id/evidence': new ProblemError(
        {
          type: 'about:blank',
          title: 'Some files cannot be used as evidence',
          status: 422,
          code: 'VALIDATION_FAILED',
          detail: 'Evidence must be your own finished uploads, not used anywhere else.',
        },
        { status: 422, requestId: undefined, retryAfterMs: undefined, rateLimit: undefined, replayed: false },
        false,
      ),
    });
    await screen.findByRole('group', { name: 'Evidence category' });
    pick(container, 'a.jpg');
    await screen.findByRole('button', { name: 'Remove a.jpg' });
    fireEvent.click(submit());
    expect(await screen.findByText(/Evidence must be your own finished uploads/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove a.jpg' })).toBeTruthy();
    await waitFor(() => {
      expect(submit().disabled).toBe(false);
    });
  });

  it('sends one attach for a double press', async () => {
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'));
    await screen.findByRole('group', { name: 'Evidence category' });
    pick(container, 'a.jpg');
    await screen.findByRole('button', { name: 'Remove a.jpg' });
    fireEvent.click(submit());
    fireEvent.click(submit());
    await screen.findByText('Evidence added');
    expect(callsTo(api.call, 'POST', '/trades/:id/evidence')).toHaveLength(1);
  });

  it('says a trade that cannot take evidence cannot, with no picker', async () => {
    for (const status of ['FUNDED', 'COMPLETED']) {
      const { container } = serve(workspaceTrade(status, 'BUYER'));
      expect(await screen.findByText(/Evidence can be added while the item is on its way/)).toBeTruthy();
      expect(container.querySelector('input[type="file"]')).toBeNull();
      expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull();
      cleanup();
    }
  });

  it('shows loading, a retryable error, and the offline words', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), { 'GET /trades/:id': new Error('down') });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByText('Couldn’t load this trade')).toBeTruthy();
    cleanup();
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'));
    expect(await screen.findByText('You’re offline')).toBeTruthy();
    expect(screen.getByText(/Photos and video can’t be added until you’re back online/)).toBeTruthy();
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')).toBeTruthy();
    expect(submit().disabled).toBe(true);
    online.mockRestore();
  });
});

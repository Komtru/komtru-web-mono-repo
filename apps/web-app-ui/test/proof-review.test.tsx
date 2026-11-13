// @vitest-environment jsdom
// F-029, PM-5 and PM-7: the buyer reviews the seller's proof before accepting, and compares it with their own photos
// at inspection. The seller's files are signed per file; the buyer's own photos stay on the device and the screen says so.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectCompare, MatchChecks, ProofReview, takenRange } from '../src/trade/proof/ProofReview';
import { expectNoAxeViolations } from './axe';
import { answerWith, fileRead, id, inspectionRead, renderWithApi, type CallFn } from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
beforeEach(() => {
  api.call.mockReset();
  answerWith(api.call, {
    'GET /files/:id': (input: { params?: Record<string, string> }) =>
      fileRead(input.params?.id === id(8) ? 8 : 7),
  });
});
afterEach(cleanup);

describe('PM-5: the buyer reviews the proof before accepting', () => {
  it('says who showed it and when it was taken', async () => {
    const { container } = renderWithApi(
      api.call,
      <ProofReview
        seller="TechEdge NG"
        total={2}
        media={[
          { fileId: id(7), attachedAt: '2026-09-29T15:42:00.000Z' },
          { fileId: id(8), attachedAt: '2026-09-29T15:58:00.000Z' },
        ]}
      />,
    );
    const grid = screen.getByLabelText('The seller’s proof', { selector: 'ul' });
    await waitFor(() => {
      expect(within(grid).getAllByRole('img')).toHaveLength(2);
    });
    const terms = screen.getByLabelText('Where the proof came from');
    expect(within(terms).getByText('TechEdge NG')).toBeTruthy();
    expect(within(terms).getByText('Taken')).toBeTruthy();
    expect(screen.getByText(/This proof stays with the Trade as its evidence/)).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('says what it can: a count, where the platform does not yet let the buyer open the files', () => {
    renderWithApi(api.call, <ProofReview seller="TechEdge NG" total={4} />);
    expect(screen.getByText('TechEdge NG attached 4 photos or videos')).toBeTruthy();
    expect(
      screen.getByText(/the platform lists a Trade’s files only once the item has shipped/),
    ).toBeTruthy();
    expect(screen.queryByText(/open once the Trade is agreed/)).toBeNull();
    expect(screen.queryByText('Taken')).toBeNull();
  });

  it('says so when nothing was shown', () => {
    renderWithApi(api.call, <ProofReview seller="TechEdge NG" total={0} />);
    expect(screen.getByText('TechEdge NG hasn’t shown any photos or video.')).toBeTruthy();
  });

  it('writes the taken time as the reference does', () => {
    expect(takenRange(['2026-09-29T15:42:00.000Z', '2026-09-29T15:58:00.000Z'])).toMatch(/ · .* – /);
    expect(takenRange([undefined])).toBeUndefined();
    expect(takenRange(['2026-09-29T15:42:00.000Z'])).toMatch(/Sep/);
  });
});

describe('PM-7: compare with the seller’s proof', () => {
  const read = inspectionRead() as unknown as Parameters<typeof InspectCompare>[0]['read'];

  it('shows the seller’s proof first, then the buyer’s own photos, kept on this device', async () => {
    const { container } = renderWithApi(
      api.call,
      <>
        <InspectCompare read={read} seller="TechEdge NG" />
        <MatchChecks />
      </>,
    );
    const group = screen.getByRole('group', { name: 'Which photos to look at' });
    expect(within(group).getByRole('button', { name: 'Seller’s proof' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    const proof = await screen.findByRole('region', { name: "Seller's proof" });
    await waitFor(() => {
      expect(within(proof).getAllByRole('img')).toHaveLength(2);
    });
    fireEvent.click(within(group).getByRole('button', { name: 'My photos' }));
    expect(screen.queryByRole('region', { name: "Seller's proof" })).toBeNull();
    expect(screen.getByText(/They stay on this device/)).toBeTruthy();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['x'], 'imei.jpg', { type: 'image/jpeg' })] },
    });
    expect(await screen.findByRole('img', { name: 'imei.jpg' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove imei.jpg' }));
    expect(screen.queryByRole('img', { name: 'imei.jpg' })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('gives each of "My photos" its own key and its own Remove, even for two photos with the same name', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: () => {
          const url = `blob:test-${String(created.length)}`;
          created.push(url);
          return url;
        },
        revokeObjectURL: (url: string) => {
          revoked.push(url);
        },
      }),
    );
    const { container, unmount } = renderWithApi(
      api.call,
      <InspectCompare read={read} seller="TechEdge NG" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'My photos' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
    const same = () => new File(['x'], 'imei.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [same(), same()] } });
    expect(await screen.findAllByRole('button', { name: 'Remove imei.jpg' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove imei.jpg' })[0] as HTMLElement);
    expect(screen.getAllByRole('button', { name: 'Remove imei.jpg' })).toHaveLength(1);
    fireEvent.change(input, { target: { files: [same()] } });
    expect(await screen.findAllByRole('button', { name: 'Remove imei.jpg' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove imei.jpg' })[0] as HTMLElement);
    expect(screen.getAllByRole('button', { name: 'Remove imei.jpg' })).toHaveLength(1);
    // The preview of a removed photo is let go, and the rest go with the screen.
    expect(revoked).toHaveLength(2);
    unmount();
    expect(revoked).toHaveLength(3);
    vi.unstubAllGlobals();
  });

  it('lists the four checks and lets each be ticked', () => {
    renderWithApi(api.call, <MatchChecks />);
    const boxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes.map((box) => box.closest('label')?.textContent)).toEqual([
      'Same colour and storage',
      'Same condition as the video',
      'IMEI matches the label',
      'Everything in the box is there',
    ]);
    fireEvent.click(boxes[2] as HTMLInputElement);
    expect(boxes[2]?.checked).toBe(true);
  });
});

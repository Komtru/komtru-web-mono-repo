// @vitest-environment jsdom
// The share box on /trade-code: it must hand over a code to search, never a link to tap.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ShareCode } from '../app/trade-code/ShareCode';

afterEach(cleanup);

const field = (): HTMLElement => screen.getByLabelText('Your Trade Code');
const shareLink = (): HTMLAnchorElement =>
  screen.getByRole<HTMLAnchorElement>('link', { name: /Share on WhatsApp/ });

/** What WhatsApp would actually send, decoded back out of the wa.me link. */
const sharedMessage = (): string => decodeURIComponent(shareLink().href.split('?text=')[1] ?? '');

describe('ShareCode', () => {
  it('shares the code that is in the box', () => {
    render(<ShareCode />);
    fireEvent.change(field(), { target: { value: 'KMT-900001' } });
    expect(sharedMessage()).toContain('Search KMT-900001 on Komtru');
  });

  /*
   * The whole point of the page: the message carries a code and the instruction to look it up.
   * A URL into a trade would teach exactly the habit the page is trying to break.
   */
  it('sends an instruction to search, not a link to tap', () => {
    render(<ShareCode />);
    const message = sharedMessage();
    expect(message).toContain('Open Komtru yourself and look it up');
    expect(message).toContain('don’t tap links from strangers');
    expect(message).not.toMatch(/https?:\/\//);
  });

  it('accepts the code however it was typed', () => {
    render(<ShareCode />);
    fireEvent.change(field(), { target: { value: '  kmt-482731 ' } });
    expect(sharedMessage()).toContain('Search KMT-482731 on Komtru');
  });

  it('has nothing to share when the box is empty', () => {
    render(<ShareCode />);
    fireEvent.change(field(), { target: { value: '' } });
    expect(screen.queryByRole('link', { name: /Share on WhatsApp/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Share on WhatsApp/ })).toHaveProperty('disabled', true);
  });
});

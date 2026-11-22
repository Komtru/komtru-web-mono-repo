// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SideChoice, sideOf, startTradeHref } from '../src/trade/create/SideChoice';
import { expectNoAxeViolations } from './axe';

afterEach(cleanup);

// Owner rulings 2026-11-20 and 2026-11-22: the person creating a trade always says which side they are on,
// with the side of the Buy/Sell mode they are in already picked.
describe('Start Trade: buying or selling', () => {
  it('asks the question and links each answer to its flow', () => {
    render(<SideChoice />);
    expect(screen.getByRole('heading', { name: 'Are you buying or selling?' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /I’m buying/ }).getAttribute('href')).toBe('/trade/new?side=buy');
    expect(screen.getByRole('link', { name: /I’m selling/ }).getAttribute('href')).toBe(
      '/trade/new?side=sell',
    );
  });

  it('keeps a counterparty named in advance through the choice', () => {
    render(<SideChoice counterparty="@techedge" />);
    expect(screen.getByRole('link', { name: /I’m buying/ }).getAttribute('href')).toBe(
      '/trade/new?side=buy&with=%40techedge',
    );
    expect(startTradeHref('sell', '')).toBe('/trade/new?side=sell');
  });

  it('reads only buy or sell from the link', () => {
    expect(sideOf('buy')).toBe('buy');
    expect(sideOf('sell')).toBe('sell');
    expect(sideOf('merchant')).toBeUndefined();
    expect(sideOf(['buy', 'sell'])).toBeUndefined();
    expect(sideOf(undefined)).toBeUndefined();
  });

  it('picks the side of the mode the person is in, and Continue opens it', () => {
    render(<SideChoice picked="sell" counterparty="@amaka" />);
    expect(screen.getByRole('link', { name: /I’m selling/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('link', { name: /I’m buying/ }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe(
      '/trade/new?side=sell&with=%40amaka',
    );
  });

  it('offers no Continue when nothing is picked', () => {
    render(<SideChoice />);
    expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<SideChoice />);
    await expectNoAxeViolations(container);
  });
});

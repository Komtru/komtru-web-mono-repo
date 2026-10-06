import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';
import { FOCUS_RING } from '../../src/index.js';

afterEach(cleanup);

/**
 * jsdom does not implement `:focus-visible` matching, so a component's keyboard ring is checked in
 * two halves: the element really takes focus, and it really carries the reference ring's utilities.
 * That those utilities compile to `outline:2.5px solid var(--trust-indigo); outline-offset:2px` is
 * what `primitives-parity.test.tsx` proves.
 */
export function expectFocusRing(element: HTMLElement): void {
  element.focus();
  expect(element.ownerDocument.activeElement).toBe(element);
  for (const utility of FOCUS_RING.split(' ')) expect(element.className).toContain(utility);
}

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as uiKit from '../src/index.js';

describe('@komtru/ui-kit', () => {
  // Exhaustive on purpose: the entry point is the package's contract, and an export that arrives by
  // accident is one T-013 and the apps will build on before anyone decides it should exist.
  it('exposes the tokens, the brand components and the primitives — and nothing else', () => {
    expect(Object.keys(uiKit).sort()).toEqual([
      'Avatar',
      'BREAKPOINTS',
      'Banner',
      'Button',
      'CONTROL_CLASS',
      'CONTROL_INVALID_CLASS',
      'Card',
      'Chip',
      'DesktopShell',
      'EmptyState',
      'FOCUS_RING',
      'FOCUS_RING_UTILITIES',
      'Field',
      'FileDropzone',
      'KOMTRU_TOKENS',
      'KomtruLogo',
      'KomtruMark',
      'LogoBar',
      'MediaGate',
      'MobileShell',
      'NodeLoader',
      'OtpInput',
      'PublicShell',
      'Select',
      'Sheet',
      'SideNav',
      'Skeleton',
      'Stepper',
      'StickyFooter',
      'TRADE_STAGES',
      'TabBar',
      'TextField',
      'Toast',
      'Toggle',
      'TopBar',
      'TopNav',
      'TradeProgress',
      'TradeRow',
      'cssVar',
      'cx',
      'isMediaGateSatisfied',
    ]);
  });
});

describe('the published sources', () => {
  // The library preset's NodeNext resolution would have enforced this; ui-kit had to move to
  // bundler resolution for `next/font/google`, so the convention needs its own guard.
  it('give every relative import a .js extension, because dist is consumed as Node ESM', () => {
    const sources = globSync('src/**/*.{ts,tsx}', { cwd: process.cwd() });
    expect(sources.length).toBeGreaterThan(0);
    const offenders = sources.flatMap((file) => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      return [...source.matchAll(/from '(\.[^']*)'/g)]
        .filter((match) => !match[1]?.endsWith('.js'))
        .map((match) => `${file}: ${match[1]}`);
    });
    expect(offenders).toEqual([]);
  });
});

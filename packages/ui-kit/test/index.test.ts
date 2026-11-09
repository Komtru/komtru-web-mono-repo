import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as uiKit from '../src/index.js';

describe('@komtru/ui-kit', () => {
  // Exhaustive on purpose: the entry point is the package's contract, and an export that arrives by
  // accident is one T-013 and the apps will build on before anyone decides it should exist.
  it('exposes the tokens, the brand components, the primitives and the TrustOps patterns — and nothing else', () => {
    expect(Object.keys(uiKit).sort()).toEqual([
      'ADVISORY_LABEL',
      'ActionStack',
      'AdvisoryBox',
      'Avatar',
      'BREAKPOINTS',
      'Banner',
      'Button',
      'CONTROL_CLASS',
      'CONTROL_INVALID_CLASS',
      'Card',
      'CaseLayout',
      'Chip',
      'CodeCard',
      'CollapsibleSideNav',
      'ConsoleShell',
      'CounterDiffRow',
      'DataTable',
      'DecisionPanel',
      'DesktopShell',
      'EmptyState',
      'EvidenceMatrix',
      'FOCUS_RING',
      'FOCUS_RING_UTILITIES',
      'Field',
      'FileDropzone',
      'FilterBar',
      'GlobalSearch',
      'HUMAN_DECIDES',
      'ItemCard',
      'KOMTRU_TOKENS',
      'KomtruLogo',
      'KomtruMark',
      'KpiCard',
      'LoadFailed',
      'LoadingScreen',
      'LogoBar',
      'MediaGate',
      'MobileShell',
      'ModeSwitch',
      'NodeLoader',
      'NoteBanner',
      'OfflineBanner',
      'OptionCard',
      'OtpInput',
      'PERIODS',
      'PartyStrip',
      'PeriodFilter',
      'PolicyCite',
      'PublicShell',
      'QueuedActionNote',
      'ReadyBanner',
      'ResponsiveAppShell',
      'RiskBanner',
      'ScreenColumn',
      'ScreenHeader',
      'SectionLabel',
      'Select',
      'SettingsGroup',
      'SettingsRow',
      'Sheet',
      'SideNav',
      'Skeleton',
      'StandardCard',
      'StatusHero',
      'Stepper',
      'StickyFooter',
      'TRADE_STAGES',
      'TRUST_TRAIL_CAPTION',
      'TabBar',
      'TermList',
      'TermRow',
      'TextField',
      'Timeline',
      'Toast',
      'Toggle',
      'TopBar',
      'TopNav',
      'TradeProgress',
      'TradeRow',
      'TrustTrail',
      'VersionTimeline',
      'WarnBanner',
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

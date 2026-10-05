/* eslint-disable komtru-design/no-raw-hex -- proving the harness catches a wrong colour means naming one. */
/**
 * Every primitive is checked against the rule the reference HTML declares for it: the component is
 * rendered, its class attributes are compiled through the real Tailwind preset, and the resulting
 * declarations are diffed against the reference's. A property the component does not reproduce has
 * to be named in `DEVIATIONS` with a reason — and a `DEVIATIONS` entry that no longer deviates fails
 * too, so the list cannot rot into a blanket excuse.
 *
 * Node, not jsdom: under jsdom Vite rewrites `import.meta.url` into a `/@fs` URL, which breaks both
 * the reference-file read and Tailwind's stylesheet resolution. `react-dom/server` needs no DOM.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  FOCUS_RING_UTILITIES,
  FileDropzone,
  NodeLoader,
  OtpInput,
  Select,
  Sheet,
  Skeleton,
  Stepper,
  StickyFooter,
  TextField,
  Toggle,
  TradeProgress,
  TradeRow,
} from '../src/index.js';
import { REFERENCE_FILE } from '../scripts/extract-tokens.js';
import { canonicalise, compiledDeclarations, expandDeclaration, referenceRule } from './reference-css.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '../../../docs/design-reference', REFERENCE_FILE), 'utf8');

/**
 * Every property a primitive knowingly does not reproduce, keyed by parity id, with the reason. Each
 * entry is also carried into the ticket's deferred list and into `src/primitives/DEVIATIONS.md`.
 */
const DEVIATIONS: Record<string, Record<string, string>> = {
  'focus-visible': {
    'border-radius':
      "The reference's global ring also sets border-radius:4px, but that rule is declared before " +
      'every component rule, so any element with its own radius keeps it. Reproducing it as a ' +
      'utility would invert the cascade and square off chips, cards and sheets while focused.',
  },
  'btn-sticky': {
    background:
      'The fade is `linear-gradient(to top, var(--surface-primary) 70%, transparent)`, written as a ' +
      'Tailwind arbitrary value; Tailwind emits it through its own gradient custom properties ' +
      'rather than as a plain `background-image`, so the two cannot be compared literally. The ' +
      'gradient string itself is asserted in Button.test.tsx.',
  },
  skeleton: {
    background:
      'The shimmer gradient is written as a Tailwind arbitrary value, which Tailwind emits as ' +
      "`background-image` rather than the reference's `background` shorthand. The gradient string " +
      'itself is identical and is asserted in Skeleton.test.tsx.',
  },
  sheet: {
    'box-shadow':
      'Tailwind routes every shadow through its own `--tw-shadow` composition chain so ring, inset ' +
      'and drop shadows can stack, so the compiled declaration is a variable list rather than ' +
      '`var(--shadow-raised)`. The token reaching it is asserted in Sheet.test.tsx.',
  },
  'proof-thumb': {
    background:
      "The filled thumbnail's 135deg stone-to-cloud gradient is a Tailwind arbitrary value, which " +
      "compiles to `background-image` rather than the reference's `background` shorthand. The " +
      'gradient string is asserted in FileDropzone.test.tsx.',
  },
  'sheet-scrim': {
    position:
      'The reference pins the scrim `absolute` inside the 340px phone frame it is drawn in. A real ' +
      'screen has no such frame, so the scrim is `fixed` to the viewport.',
    'border-radius':
      'The reference rounds the scrim to the phone frame it sits inside (`0 0 14px 14px`). There ' +
      'is no frame outside the reference document.',
  },
};

/** A stand-in for whatever icon a screen gives an empty state; only its wrapper is under test. */
const ICON = <svg aria-hidden viewBox="0 0 24 24" />;

interface ParityRow {
  /** Key into `DEVIATIONS`, and the name the failure is reported under. */
  id: string;
  /** The selector the reference HTML declares for this piece of markup. */
  selector: string;
  /** Rendered, then its class attributes harvested. */
  element?: React.ReactElement;
  /** Which element in the rendered markup carries the class under test. Defaults to the first. */
  node?: number;
  /** Given instead of `element` when the classes are not reachable through a rendered component. */
  classes?: readonly string[];
  /** Set where the reference carries two designs under one class name. */
  styleId?: string;
}

/** The `class` attribute of every element in the rendered markup, in document order. */
function classAttributes(element: React.ReactElement): string[] {
  return [...renderToStaticMarkup(element).matchAll(/\sclass="([^"]*)"/g)].map((match) => match[1] ?? '');
}

const ROWS: ParityRow[] = [
  { id: 'focus-visible', selector: ':focus-visible', classes: FOCUS_RING_UTILITIES },

  { id: 'btn-primary', selector: '.btn-primary', element: <Button>Start a Trade</Button> },
  {
    id: 'btn-secondary',
    selector: '.btn-secondary',
    element: <Button variant="secondary">Enter a Trade Code</Button>,
  },
  { id: 'btn-ghost', selector: '.btn-ghost', element: <Button variant="ghost">Forgot password?</Button> },
  {
    id: 'btn-danger',
    selector: '.btn-danger',
    element: <Button variant="danger">Yes, cancel this Trade</Button>,
  },
  {
    id: 'btn-sticky',
    selector: '.btn-sticky',
    element: (
      <StickyFooter>
        <Button>Verify &amp; continue</Button>
      </StickyFooter>
    ),
  },

  { id: 'chip', selector: '.chip', element: <Chip tone="protected">Protected</Chip> },
  { id: 'chip-protected', selector: '.chip.protected', element: <Chip tone="protected">Protected</Chip> },
  {
    id: 'chip-awaiting',
    selector: '.chip.awaiting',
    element: <Chip tone="awaiting">Under Inspection</Chip>,
  },
  { id: 'chip-risk', selector: '.chip.risk', element: <Chip tone="risk">At risk</Chip> },
  { id: 'chip-resolved', selector: '.chip.resolved', element: <Chip tone="resolved">Resolved</Chip> },
  { id: 'chip-verified', selector: '.chip.verified', element: <Chip tone="verified">Verified</Chip> },
  { id: 'chip-dot', selector: '.chip .dot', element: <Chip tone="protected">Protected</Chip>, node: 1 },

  { id: 'avatar', selector: '.avatar', element: <Avatar initials="TE" /> },
  { id: 'item-card', selector: '.item-card', element: <Card layout="row">MacBook Air M2</Card> },

  { id: 'trade-row', selector: '.trade-row', element: <TradeRow amount="₦452,000" /> },
  { id: 'trade-row-top', selector: '.trade-row .tr-top', element: <TradeRow amount="₦452,000" />, node: 1 },
  { id: 'trade-row-amt', selector: '.trade-row .tr-amt', element: <TradeRow amount="₦452,000" />, node: 2 },
  {
    id: 'trade-row-parties',
    selector: '.trade-row .tr-parties',
    element: <TradeRow amount="₦452,000" counterparty={{ name: 'TechEdge NG', initials: 'TE' }} />,
    node: 3,
  },
  {
    id: 'trade-row-sub',
    selector: '.trade-row .tr-sub',
    element: <TradeRow amount="₦452,000" sub="iPhone 13 Pro · Awaiting shipment" />,
    node: 3,
  },
  { id: 'progress-5step', selector: '.progress-5step', element: <TradeProgress stage={3} /> },
  { id: 'p5-seg', selector: '.progress-5step .p5-seg', element: <TradeProgress stage={1} />, node: 5 },
  {
    id: 'progress-5step-labels',
    selector: '.progress-5step-labels',
    element: <TradeProgress stage={3} />,
    node: 6,
  },

  // `komtru-refinement-v2` is the numbered inline rail; `komtru-nav-v2` restates `.ko-stepper` as a
  // centred-dot rail. The component reproduces the first, so the parity rows name it.
  {
    id: 'ko-stepper',
    selector: '.ko-stepper',
    styleId: 'komtru-refinement-v2',
    element: <Stepper steps={['One', 'Two']} current={0} />,
  },
  {
    id: 'ko-step',
    selector: '.ko-step',
    styleId: 'komtru-refinement-v2',
    element: <Stepper steps={['One', 'Two']} current={1} />,
    node: 2,
  },
  {
    id: 'ko-step-dot',
    selector: '.ko-step .dot',
    styleId: 'komtru-refinement-v2',
    element: <Stepper steps={['One', 'Two']} current={1} />,
    node: 3,
  },

  { id: 'field', selector: '.field', element: <TextField label="Phone number" /> },
  { id: 'field-label', selector: '.field label', element: <TextField label="Phone number" />, node: 1 },
  { id: 'input', selector: '.input', element: <TextField label="Phone number" />, node: 2 },
  {
    id: 'field-helper',
    selector: '.field .helper',
    element: <TextField label="Phone number" helper="We never share it." />,
    node: 3,
  },
  { id: 'select-input', selector: '.input', element: <Select label="Delivery method" />, node: 2 },

  { id: 'otp-row', selector: '.otp-row', element: <OtpInput label="One-time code" value="" /> },
  { id: 'otp-cell', selector: '.otp-cell', element: <OtpInput label="One-time code" value="" />, node: 1 },
  {
    id: 'otp-cell-filled',
    selector: '.otp-cell.filled',
    element: <OtpInput label="One-time code" value="4" />,
    node: 1,
  },

  { id: 'm-switch', selector: '.m-switch', element: <Toggle label="Marketing" checked={false} /> },

  {
    id: 'sheet-scrim',
    selector: '.bottom-sheet-overlay',
    element: <Sheet open title="Cancel this Trade?" />,
  },
  {
    id: 'sheet',
    selector: '.bottom-sheet',
    element: <Sheet open title="Cancel this Trade?" />,
    node: 1,
  },
  {
    id: 'sheet-handle',
    selector: '.bottom-sheet .sheet-handle',
    element: <Sheet open title="Cancel this Trade?" />,
    node: 2,
  },

  { id: 'skeleton', selector: '.skeleton', element: <Skeleton /> },
  { id: 'node-loader', selector: '.node-loader', element: <NodeLoader title="Verifying payment" /> },
  {
    id: 'node-loader-dot',
    selector: '.node-loader .nl-dot',
    element: <NodeLoader title="Verifying payment" />,
    node: 1,
  },

  {
    id: 'state-panel',
    selector: '.state-panel',
    element: <EmptyState icon={ICON} title="No protected Trades yet" body="Start one." />,
  },
  {
    id: 'state-panel-icon',
    selector: '.state-panel .icon-wrap',
    element: <EmptyState icon={ICON} title="No protected Trades yet" body="Start one." />,
    node: 1,
  },

  {
    id: 'proof-compare-note',
    selector: '.proof-compare-note',
    element: <Banner tone="info">Compare this against the seller&apos;s proof.</Banner>,
  },
  {
    id: 'guard-lock-banner',
    selector: '.guard-lock-banner',
    element: (
      <Banner tone="warning" title="Accept is locked">
        Attach at least one photo.
      </Banner>
    ),
  },

  {
    id: 'm-upload',
    selector: '.m-upload',
    element: (
      <FileDropzone label="Add evidence photos" hint="Helps TrustOps resolve this faster" media={[]} />
    ),
    node: 8,
  },
  {
    id: 'proof-media-grid',
    selector: '.proof-media-grid',
    element: <FileDropzone label="Proof of possession" media={[]} />,
    node: 1,
  },
  {
    id: 'proof-thumb-empty',
    selector: '.proof-thumb.empty',
    element: <FileDropzone label="Proof of possession" media={[]} />,
    node: 2,
  },
  {
    id: 'proof-thumb',
    selector: '.proof-thumb',
    element: <FileDropzone label="Proof of possession" media={[{ id: 'a' }]} />,
    node: 2,
  },
];

describe('the parity harness', () => {
  it('reports a property whose compiled value does not match the reference', async () => {
    const reference = canonicalise(referenceRule(html, '.btn-primary'));
    // `bg-cloud-gray` is not the reference's midnight fill, and the harness has to say so.
    const wrong = await compiledDeclarations(['bg-cloud-gray']);
    expect(reference.get('background-color')).toBe('#101725');
    expect(wrong.get('background-color')).toBe('#F5F7FA');
  });

  it('refuses a selector the reference does not declare', () => {
    expect(() => referenceRule(html, '.btn-tertiary')).toThrow(/declares no rule/);
  });
});

describe.each(ROWS)('$id', (row) => {
  const classes = [...(row.classes ?? (classAttributes(row.element!)[row.node ?? 0] ?? '').split(/\s+/))];

  it(`compiles to what the reference declares for ${row.selector}`, async () => {
    const raw = referenceRule(html, row.selector, row.styleId);
    const reference = canonicalise(raw);
    const compiled = await compiledDeclarations(classes);
    // A deviation is written against the property the reference declares; widen it to the longhands
    // that property expands into, so excusing `border-radius` does not mean listing four corners.
    const excused = new Map<string, string>();
    for (const [property, reason] of Object.entries(DEVIATIONS[row.id] ?? {})) {
      for (const [longhand] of expandDeclaration(property, raw.get(property) ?? '0')) {
        excused.set(longhand, reason);
      }
    }

    const mismatches: string[] = [];
    const excusedButMatching: string[] = [];
    for (const [property, expected] of reference) {
      const actual = compiled.get(property);
      if (excused.has(property)) {
        if (actual === expected) excusedButMatching.push(property);
        continue;
      }
      if (actual !== expected) {
        mismatches.push(`${property}: expected "${expected}", compiled "${actual ?? '(absent)'}"`);
      }
    }

    expect(mismatches, `${row.id} drifted from ${row.selector}`).toEqual([]);
    expect(
      excusedButMatching,
      `${row.id} excuses properties it actually reproduces — delete the DEVIATIONS entry`,
    ).toEqual([]);
  });
});

describe('DEVIATIONS', () => {
  it('names only primitives the suite actually checks', () => {
    const ids = new Set(ROWS.map((row) => row.id));
    expect([...Object.keys(DEVIATIONS)].filter((id) => !ids.has(id))).toEqual([]);
  });

  it('gives every excused property a reason, not a bare entry', () => {
    for (const [id, properties] of Object.entries(DEVIATIONS)) {
      for (const [property, reason] of Object.entries(properties)) {
        expect(reason.length, `${id}.${property} needs a real reason`).toBeGreaterThan(40);
      }
    }
  });
});

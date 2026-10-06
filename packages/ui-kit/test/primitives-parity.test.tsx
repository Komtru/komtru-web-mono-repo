/* eslint-disable komtru-design/no-raw-hex -- proving the harness catches a wrong colour means naming one. */
/**
 * Every primitive is checked against the rule the reference HTML declares for it. The tables below
 * are this suite's; the runner that consumes them lives in `parity.tsx`, because `shells-parity`
 * needs the same one.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { type ParityRow, describeParity } from './parity.js';
import { canonicalise, compiledDeclarations, referenceRule } from './reference-css.js';

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
  'proof-compare-note-icon': {
    stroke:
      'The reference strokes the icon with `var(--info-on-soft)` directly. The wrapper stroke is ' +
      '`currentColor`, and the wrapper sets `color` to that same token, so the computed stroke is ' +
      'identical — routing it through `color` is what lets a screen pass any icon it likes.',
  },
  'guard-lock-banner-icon': {
    stroke:
      'Same as proof-compare-note-icon: `currentColor` resolves to the `--warning-on-soft` the ' +
      'wrapper sets, which is exactly what the reference strokes the icon with.',
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

/**
 * Every property a primitive applies that its reference rule does not declare, keyed by parity id.
 * The reference stops at the rule; a component has to be a real element as well, and that costs a
 * handful of declarations. Each one is listed so it is a decision rather than an accident.
 */
const ADDITIONS: Record<string, readonly string[]> = {
  // The reference writes the column layout and 8px gap inline on every instance holding more than
  // one button, and the fade is a Tailwind gradient, which compiles to `background-image`.
  'btn-sticky': ['display', 'flex-direction', 'gap', 'background-image'],
  // `.chip .dot` has no colour of its own; every instance sets it inline to the chip's `on-soft`.
  'chip-dot': ['background-color'],
  // The reference strokes the icon itself (`.state-panel.empty .icon-wrap svg{stroke:…}`); the
  // wrapper carries the colour here so any icon a screen passes inherits it through `currentColor`.
  'state-panel-icon': ['color'],
  // The row is a `<button>` or an `<a>` as often as a `<div>`, and those do not fill or left-align
  // on their own.
  'trade-row': ['width', 'text-align'],
  // The reference's cell is a `<div>` centred by flex; a real `<input>` also needs its text centred.
  'otp-cell': ['text-align'],
  'otp-cell-filled': ['text-align'],
  'otp-cell-invalid': ['text-align'],
  // The shimmer gradient compiles to `background-image`; `width` is the `.skel-line` width variant.
  skeleton: ['background-image', 'width'],
  // The upload target is a `<label>` wrapping a hidden file input, so it has to be a clickable block.
  'm-upload': ['display', 'cursor'],
  // The filled thumbnail's gradient, same story as the skeleton's.
  'proof-thumb': ['background-image'],
  // The icon wrapper carries `color` so `stroke-current` resolves to the tone — see DEVIATIONS.
  'proof-compare-note-icon': ['color'],
  'guard-lock-banner-icon': ['color'],
};

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

  {
    id: 'chip-protected',
    selector: '.chip.protected',
    extends: ['.chip'],
    element: <Chip tone="protected">Protected</Chip>,
  },
  {
    id: 'chip-awaiting',
    selector: '.chip.awaiting',
    extends: ['.chip'],
    element: <Chip tone="awaiting">Under Inspection</Chip>,
  },
  { id: 'chip-risk', selector: '.chip.risk', extends: ['.chip'], element: <Chip tone="risk">At risk</Chip> },
  {
    id: 'chip-resolved',
    selector: '.chip.resolved',
    extends: ['.chip'],
    element: <Chip tone="resolved">Resolved</Chip>,
  },
  {
    id: 'chip-verified',
    selector: '.chip.verified',
    extends: ['.chip'],
    element: <Chip tone="verified">Verified</Chip>,
  },
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

  {
    id: 'p5-seg-done',
    selector: '.progress-5step .p5-seg.done',
    extends: ['.progress-5step .p5-seg'],
    element: <TradeProgress stage={3} />,
    node: 1,
  },
  {
    id: 'p5-seg-active',
    selector: '.progress-5step .p5-seg.active',
    extends: ['.progress-5step .p5-seg'],
    element: <TradeProgress stage={1} />,
    node: 1,
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
    extends: ['.otp-cell'],
    element: <OtpInput label="One-time code" value="4" />,
    node: 1,
  },

  {
    // The active step is where the ternary lives, so it is the one worth pinning.
    id: 'ko-step-active',
    selector: '.ko-step.active',
    extends: ['.ko-step'],
    styleId: 'komtru-refinement-v2',
    element: <Stepper steps={['One', 'Two']} current={0} />,
    node: 2,
  },
  {
    id: 'ko-step-dot-active',
    selector: '.ko-step.active .dot',
    extends: ['.ko-step .dot'],
    styleId: 'komtru-refinement-v2',
    element: <Stepper steps={['One', 'Two']} current={0} />,
    node: 3,
  },
  {
    id: 'ko-step-line',
    selector: '.ko-step-line',
    styleId: 'komtru-refinement-v2',
    element: <Stepper steps={['One', 'Two']} current={0} />,
    node: 4,
  },

  {
    // E3b marks the whole code wrong, not one digit, and says so inline rather than in a rule.
    id: 'otp-cell-invalid',
    selector: '.otp-cell.filled',
    extends: ['.otp-cell'],
    inline: 'otp-cell filled',
    element: <OtpInput label="One-time code" value="481902" invalid />,
    node: 1,
  },

  { id: 'm-switch', selector: '.m-switch', element: <Toggle label="Marketing" checked={false} /> },
  {
    id: 'm-switch-on',
    selector: '.m-switch.on',
    extends: ['.m-switch'],
    element: <Toggle label="Shipment updates" checked />,
  },
  {
    // Checked *and* locked: the only locked switch the reference draws, and the one that regressed.
    id: 'm-switch-locked',
    selector: '.m-switch.locked',
    extends: ['.m-switch'],
    element: <Toggle label="Dispute & fraud alerts" checked locked />,
  },

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

  // `lines` is the `.skel-line` form, which is the only one the reference draws; the single-block
  // form is the same rule without `.skel-line`'s 8px margin, since a lone skeleton owns no spacing.
  { id: 'skeleton', selector: '.skel-line', extends: ['.skeleton'], element: <Skeleton lines={1} /> },
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
    selector: '.state-panel.empty .icon-wrap',
    extends: ['.state-panel .icon-wrap'],
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
    id: 'proof-compare-note-icon',
    selector: '.proof-compare-note svg',
    element: (
      <Banner tone="info" icon={ICON}>
        Compare this against the proof.
      </Banner>
    ),
    node: 1,
  },
  {
    id: 'proof-compare-note-body',
    selector: '.proof-compare-note span',
    element: <Banner tone="info">Compare this against the proof.</Banner>,
    node: 1,
  },
  {
    id: 'guard-lock-banner-icon',
    selector: '.guard-lock-banner svg',
    element: (
      <Banner tone="warning" icon={ICON} title="Accept is locked">
        Attach a photo.
      </Banner>
    ),
    node: 1,
  },
  {
    id: 'guard-lock-banner-title',
    selector: '.guard-lock-banner b',
    element: (
      <Banner tone="warning" title="Accept is locked">
        Attach a photo.
      </Banner>
    ),
    node: 1,
  },
  {
    id: 'guard-lock-banner-body',
    selector: '.guard-lock-banner span',
    element: (
      <Banner tone="warning" title="Accept is locked">
        Attach a photo.
      </Banner>
    ),
    node: 2,
  },

  {
    id: 'm-upload',
    selector: '.m-upload',
    element: <FileDropzone label="Add evidence photos" hint="Helps TrustOps…" media={[]} requiredCount={0} />,
    node: 8,
  },
  {
    id: 'proof-media-grid',
    selector: '.proof-media-grid',
    element: <FileDropzone label="Proof of possession" media={[]} requiredCount={0} />,
    node: 1,
  },
  {
    id: 'proof-thumb-empty',
    selector: '.proof-thumb.empty',
    extends: ['.proof-thumb'],
    element: <FileDropzone label="Proof of possession" media={[]} requiredCount={0} />,
    node: 2,
  },
  {
    id: 'proof-thumb',
    selector: '.proof-thumb',
    element: <FileDropzone label="Proof of possession" media={[{ id: 'a' }]} requiredCount={0} />,
    node: 2,
  },
  {
    id: 'play-badge',
    selector: '.proof-thumb .play-badge',
    element: (
      <FileDropzone label="Proof of possession" media={[{ id: 'a', kind: 'video' }]} requiredCount={0} />
    ),
    node: 4,
  },
  {
    id: 'play-badge-icon',
    selector: '.proof-thumb .play-badge svg',
    element: (
      <FileDropzone label="Proof of possession" media={[{ id: 'a', kind: 'video' }]} requiredCount={0} />
    ),
    node: 5,
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

describeParity({
  html,
  rows: ROWS,
  deviations: DEVIATIONS,
  additions: ADDITIONS,
  // A primitive's reference rule is unconditional, so the width-blind reader is the right one:
  // it refuses to resolve a variant at all rather than pick a width for it.
  declarations: (classes) => compiledDeclarations(classes),
});

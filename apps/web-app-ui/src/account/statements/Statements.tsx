'use client';

import { collectCursorPages, listMyRefunds, listPayouts } from '@komtru/api-client';
import { useApiClient } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  NoteBanner,
  OptionCard,
  ReadyBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  SettingsGroup,
  SettingsRow,
  TextField,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { useOnline } from '../../shell/OfflineStatus';
import { Loading } from '../states';
import { buildStatement, periodRange, toCsv, type PeriodChoice } from './statement';

const PAGE = 50;

type Kind = PeriodChoice['kind'];
type Outcome = { kind: 'ready'; lines: number } | { kind: 'empty' } | { kind: 'failed' } | undefined;

const PERIODS: { kind: Kind; label: string; detail: string }[] = [
  { kind: 'this-month', label: 'This month', detail: 'From the 1st, Lagos time' },
  { kind: 'last-3-months', label: 'Last 3 months', detail: 'This month and the two before it' },
  { kind: 'custom', label: 'Custom', detail: 'Pick the first and last day' },
];

const stamp = (now: Date): string => now.toISOString().slice(0, 10);

/** Hands the file to the browser as a download. */
function save(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * SP-M13: a statement for a period, as a CSV an accountant can open. There is no statement service: the file is made
 * here from the person's payouts and refunds (`GET /me/payouts`, `GET /me/refunds`), so it holds those and says so. It
 * is a CSV and not the reference's PDF, because nothing here can make a PDF that means more than the lists it came from;
 * payments made for Trades have no list to build from yet, and the screen tells the person where their receipt is.
 */
export function Statements(): React.JSX.Element {
  const client = useApiClient();
  const online = useOnline();
  const [kind, setKind] = useState<Kind>('this-month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [payouts, setPayouts] = useState(true);
  const [refunds, setRefunds] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(undefined);

  const now = new Date();
  const choice: PeriodChoice = kind === 'custom' ? { kind, from, to } : { kind };
  const range = periodRange(choice, now);
  const backwards = kind === 'custom' && from !== '' && to !== '' && range === undefined && from > to;
  const canExport = range !== undefined && (payouts || refunds) && !busy;

  const run = async () => {
    if (range === undefined) return;
    setBusy(true);
    setOutcome(undefined);
    try {
      const [payoutRows, refundRows] = await Promise.all([
        payouts
          ? collectCursorPages((cursor) =>
              client.call(listPayouts, { query: { limit: PAGE, ...(cursor ? { cursor } : {}) } }),
            )
          : Promise.resolve([]),
        refunds
          ? collectCursorPages((cursor) =>
              client.call(listMyRefunds, { query: { limit: PAGE, ...(cursor ? { cursor } : {}) } }),
            )
          : Promise.resolve([]),
      ]);
      const rows = buildStatement({
        range,
        payouts: payoutRows,
        refunds: refundRows,
        include: { payouts, refunds },
      });
      if (rows.length === 0) {
        setOutcome({ kind: 'empty' });
        return;
      }
      save(toCsv(rows), `komtru-statement-${stamp(now)}.csv`);
      setOutcome({ kind: 'ready', lines: rows.length });
    } catch {
      setOutcome({ kind: 'failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenColumn>
      <ScreenHeader title="Statements" backHref="/account" backLabel="Back to your account" />
      <fieldset className="mb-[14px] min-w-0 border-0 p-0">
        <legend className="mb-[6px] p-0">
          <SectionLabel as="h2">Period</SectionLabel>
        </legend>
        {PERIODS.map((period) => (
          <OptionCard
            key={period.kind}
            name="statement-period"
            value={period.kind}
            checked={kind === period.kind}
            onChange={() => {
              setKind(period.kind);
              setOutcome(undefined);
            }}
            description={period.detail}
          >
            {period.label}
          </OptionCard>
        ))}
      </fieldset>
      {kind === 'custom' && (
        <div className="grid grid-cols-2 gap-[10px]">
          <TextField
            label="From"
            type="date"
            max={stamp(now)}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <TextField
            label="To"
            type="date"
            max={stamp(now)}
            value={to}
            onChange={(event) => setTo(event.target.value)}
            invalid={backwards}
          />
        </div>
      )}
      {backwards && (
        <p role="alert" className="-mt-[6px] mb-[12px] text-[12px] font-semibold text-risk-on-soft">
          The end date is before the start date.
        </p>
      )}
      <SettingsGroup label="Format">
        <SettingsRow label="CSV" sub="Opens in Excel, Google Sheets and most accounting tools" />
      </SettingsGroup>
      <SettingsGroup label="Includes">
        <SettingsRow
          label="Payouts"
          sub="Each with its fee and what reached your bank"
          control={<Check label="Payouts" checked={payouts} onChange={setPayouts} />}
        />
        <SettingsRow
          label="Refunds"
          sub="Each with the buyer protection fee it handled"
          control={<Check label="Refunds" checked={refunds} onChange={setRefunds} />}
        />
      </SettingsGroup>
      <p className="mb-[14px] text-[11.5px] leading-[1.6] text-trust-gray">
        A statement lists what moved and when. Payments you made for Trades aren’t listed here yet. For a
        receipt for one Trade, open its documents.
      </p>

      {busy && <Loading label="Preparing your statement" lines={2} />}
      {outcome?.kind === 'ready' && (
        <ReadyBanner
          title={`Your statement is ready: ${String(outcome.lines)} ${outcome.lines === 1 ? 'line' : 'lines'}.`}
        >
          It was saved to your downloads.
        </ReadyBanner>
      )}
      {outcome?.kind === 'empty' && (
        <NoteBanner title="Nothing moved in this period">
          There are no payouts or refunds to list for these dates, so there’s no file to save.
        </NoteBanner>
      )}
      {outcome?.kind === 'failed' && (
        <RiskBanner title={online ? 'We couldn’t make your statement' : 'You’re offline'}>
          {online
            ? 'Check your connection and try again. Your choices are kept.'
            : 'Reconnect to make your statement. Nothing was saved.'}
        </RiskBanner>
      )}
      <ActionStack>
        <Button type="button" disabled={!canExport} onClick={() => void run()}>
          {busy ? 'Preparing…' : 'Export statement'}
        </Button>
      </ActionStack>
    </ScreenColumn>
  );
}

/** A native checkbox: it is a real choice among several, not a setting that applies the moment it is flipped. */
function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="h-[18px] w-[18px] shrink-0 accent-trust-indigo"
    />
  );
}

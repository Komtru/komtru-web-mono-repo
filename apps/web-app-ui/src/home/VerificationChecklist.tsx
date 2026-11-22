'use client';

import { useMe, useVerificationStatus } from '@komtru/api-client/react';
import { Chip, NoteBanner, SettingsGroup, type ChipTone } from '@komtru/ui-kit';
import { useState } from 'react';
import { activeRejections } from '../account/rejections';
import { stepsOwed, type DashboardSide, type VerificationStep } from './verificationSteps';

/**
 * "Not now" on the optional ID step, remembered on this device for this account only, so a shared browser does not
 * hide it from the next person. Not a credential.
 */
export const notNowKey = (accountId: string): string => `komtru.verify.identity.not-now:${accountId}`;

function readNotNow(accountId: string): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(notNowKey(accountId)) === '1';
  } catch {
    return false;
  }
}

function writeNotNow(accountId: string): void {
  try {
    window.localStorage.setItem(notNowKey(accountId), '1');
  } catch {
    // Blocked site data: it stays hidden for this page only, which is still what the person asked for.
  }
}

/** What the chip on a step says, from its state first and then from whether this side requires it. */
function badge(step: VerificationStep): { tone: ChipTone; label: string } {
  if (step.state === 'in_review') return { tone: 'verifying', label: 'In review' };
  if (step.state === 'rejected') return { tone: 'risk', label: 'Try again' };
  return step.required
    ? { tone: 'awaiting', label: 'Required' }
    : { tone: 'verifying', label: 'Recommended' };
}

/**
 * F-084: the "Finish verifying" card at the top of Buy's Home and Sell's Shop. It names each verification step the
 * person still owes and opens VF1 at it: email or phone, whichever they did not sign up with, and their ID (required
 * on Sell, recommended on Buy).
 *
 * It is information, never a gate: the server decides every refusal. So it draws nothing until `/me` is read, and
 * leaves the ID step out while the verification status is unread or unreadable, rather than guess. A required step can't be put away; the optional ID step on Buy has
 * "Not now", which hides it on this device.
 */
export function VerificationChecklist({ side }: { side: DashboardSide }): React.JSX.Element | null {
  const me = useMe();
  const status = useVerificationStatus();
  // The account whose "Not now" this page has seen pressed. Read from storage while it is not this one.
  const [hiddenFor, setHiddenFor] = useState<string | undefined>(undefined);

  // Contacts need only `/me`; the ID step joins once the status is read, and is left out if it can't be.
  if (me.data === undefined) return null;
  const accountId = me.data.id;
  const notNow = hiddenFor === accountId || readNotNow(accountId);

  const steps = stepsOwed(
    me.data,
    status.data,
    status.data === undefined ? [] : activeRejections(status.data),
    side,
  ).filter((step) => step.required || !notNow);
  if (steps.length === 0) return null;

  const required = steps.filter((step) => step.required).length;

  return (
    <section aria-label="Finish verifying" className="mb-[14px]">
      <NoteBanner title="Finish verifying" className="mb-[8px]">
        {required > 0
          ? `${String(required)} step${required === 1 ? '' : 's'} left before you can trade freely.`
          : 'One more step to raise your trust.'}
      </NoteBanner>
      <SettingsGroup>
        <ul className="m-0 list-none p-0">
          {steps.map((step) => {
            const chip = badge(step);
            return (
              <li key={step.id} className="border-t-[1px] border-t-border-hairline first:border-t-0">
                <a
                  href={step.href}
                  className="flex items-center justify-between gap-[10px] px-[14px] py-[12px] hover:bg-surface-secondary focus-visible:outline-[2.5px] focus-visible:outline-offset-[-2px] focus-visible:outline-trust-indigo"
                >
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold text-midnight-text">{step.title}</span>
                    <span className="mt-[1px] block text-[10.5px] leading-[1.45] text-slate">
                      {step.reason}
                    </span>
                  </span>
                  <Chip tone={chip.tone} dot={false} className="shrink-0">
                    {chip.label}
                  </Chip>
                </a>
                {!step.required && step.state === 'todo' && (
                  <div className="px-[14px] pb-[10px]">
                    <button
                      type="button"
                      className="text-[11.5px] font-semibold text-trust-indigo"
                      onClick={() => {
                        writeNotNow(accountId);
                        setHiddenFor(accountId);
                      }}
                    >
                      Not now
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </SettingsGroup>
    </section>
  );
}

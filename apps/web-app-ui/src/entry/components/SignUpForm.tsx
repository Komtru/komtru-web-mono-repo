'use client';

import { Button, TextField } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signUpDraft } from '../drafts';
import { ENTRY } from '../flow';
import { EntryFrame, EntryHeading, Lede, TrustNote } from './EntryFrame';
import { useDraft } from './useDraft';

const FORM = 'signup-form';

/**
 * Screen E2 — phone first, not email first.
 *
 * Nothing is sent from here. The platform takes the Terms the person accepted in the same call that
 * opens the account and sends the code (M1 §10.1), and TOS1 must come before the account exists, so
 * this screen keeps the details and TOS1 makes the call.
 */
export function SignUpForm(): React.JSX.Element {
  const router = useRouter();
  // Coming back from the Terms keeps what was typed: the draft is the starting value, and what the
  // person types here replaces it.
  const draft = useDraft(signUpDraft);
  const [typedPhone, setPhone] = useState<string | undefined>(undefined);
  const [typedName, setFullName] = useState<string | undefined>(undefined);
  const [tried, setTried] = useState(false);
  const phone = typedPhone ?? draft?.phone ?? '';
  const fullName = typedName ?? draft?.fullName ?? '';

  const phoneMissing = phone.replace(/\D/g, '').length < 7;
  const nameMissing = fullName.trim() === '';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (phoneMissing || nameMissing) return;
    signUpDraft.write({ phone: phone.trim(), fullName: fullName.trim() });
    router.push(ENTRY.terms);
  };

  return (
    <EntryFrame
      title="Create account"
      back={ENTRY.welcome}
      footer={
        <Button type="submit" form={FORM}>
          Continue
        </Button>
      }
    >
      <form id={FORM} onSubmit={submit} noValidate>
        <EntryHeading>What&apos;s your number?</EntryHeading>
        <Lede>
          This becomes the anchor of your Trust Profile — buyers and sellers you trade with will see it&apos;s
          verified, never the number itself.
        </Lede>
        <TextField
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="080X XXX XXXX"
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
          }}
          invalid={tried && phoneMissing}
          {...(tried && phoneMissing ? { helper: 'Enter your phone number, for example 0802 341 5567' } : {})}
        />
        <TextField
          label="Full name"
          autoComplete="name"
          placeholder="As it appears on your ID"
          value={fullName}
          onChange={(event) => {
            setFullName(event.target.value);
          }}
          invalid={tried && nameMissing}
          {...(tried && nameMissing ? { helper: 'Enter your name as it appears on your ID' } : {})}
        />
        <TrustNote>
          Your Trust Profile starts at zero — it&apos;s built entirely from what you do on Komtru, never
          bought or carried over from anywhere else.
        </TrustNote>
      </form>
    </EntryFrame>
  );
}

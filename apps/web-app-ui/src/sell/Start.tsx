'use client';

import {
  useCities,
  useMyMerchantApplication,
  useSaveMerchantDraft,
  useStates,
  useVerificationStatus,
} from '@komtru/api-client/react';
import { Banner, Button, RiskBanner, Select, TextField } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LoadProblem, Loading } from '../account/states';
import { SellFrame } from './Frame';
import { STEP_HREF, VERIFICATION_HREF, startComplete, stepBody, valuesFrom, type SellValues } from './rules';

const READY_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 12.5l4.5 4.5L20 6" />
  </svg>
);

/**
 * SO1 (T-121): "Tell Us About Your Business", the first step of merchant verification. The identity check the person
 * passed as a buyer carries over, so the screen says so and asks nothing about it again. The registered address, state
 * and city are drawn here although the reference does not draw them: submit needs them (see the plan).
 */
export function SellStart(): React.JSX.Element {
  const application = useMyMerchantApplication();
  const verification = useVerificationStatus();
  const states = useStates();

  if (application.isPending || verification.isPending || states.isPending) {
    return (
      <SellFrame title="Your business" step={1} backHref={VERIFICATION_HREF} action={null}>
        <Loading label="Loading your application" lines={4} />
      </SellFrame>
    );
  }
  if (application.data === undefined || verification.data === undefined || states.data === undefined) {
    return (
      <SellFrame title="Your business" step={1} backHref={VERIFICATION_HREF} action={null}>
        <LoadProblem
          what="your application"
          onRetry={() => {
            void application.refetch();
            void verification.refetch();
            void states.refetch();
          }}
        />
      </SellFrame>
    );
  }
  return (
    <SellForm
      initial={valuesFrom(application.data)}
      identityVerified={verification.data.requirements.identifier && verification.data.requirements.liveness}
      states={states.data}
    />
  );
}

type StateOption = { id: string; name: string };

function SellForm({
  initial,
  identityVerified,
  states,
}: {
  initial: SellValues;
  identityVerified: boolean;
  states: StateOption[];
}): React.JSX.Element {
  const router = useRouter();
  const save = useSaveMerchantDraft();
  const [values, setValues] = useState<SellValues>(initial);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const cities = useCities(values.stateId === '' ? null : values.stateId);
  const ready = startComplete(values) && !save.isPending;

  const set = <K extends keyof SellValues>(key: K, value: SellValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const next = () => {
    if (!ready) return;
    setProblem(undefined);
    save.mutate(stepBody('start', values), {
      onSuccess: () => router.push(STEP_HREF.category),
      onError: () => setProblem('Couldn’t save your business details. Check your connection and try again.'),
    });
  };

  return (
    <SellFrame
      title="Your business"
      step={1}
      backHref={VERIFICATION_HREF}
      action={
        <>
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
          <Button type="button" disabled={!ready} onClick={next}>
            {save.isPending ? 'Saving…' : 'Continue to category'}
          </Button>
        </>
      }
    >
      {identityVerified ? (
        <Banner tone="success" icon={READY_MARK} title="Identity already verified">
          You verified this as a buyer — no need to redo it here.
        </Banner>
      ) : (
        <Banner tone="warning" title="Verify your ID first">
          Your ID and selfie check are what buyers and sellers trust.{' '}
          <a href="/account/verification">Verify them</a> first.
        </Banner>
      )}
      <p className="mb-[16px] text-[12px] leading-[1.6] text-slate">
        Merchant verification is how your business becomes a merchant. Until then you sell as a default
        seller, and the amount you can transact is limited.
      </p>
      <form onSubmit={(event) => event.preventDefault()} noValidate>
        <TextField
          label="Business or shop name"
          placeholder="e.g. TechEdge NG"
          autoComplete="organization"
          value={values.businessName}
          onChange={(event) => set('businessName', event.target.value)}
        />
        <TextField
          label="Registered address"
          autoComplete="street-address"
          value={values.addressLine}
          onChange={(event) => set('addressLine', event.target.value)}
        />
        <Select
          label="State"
          value={values.stateId}
          onChange={(event) => {
            set('stateId', event.target.value);
            set('cityId', '');
          }}
        >
          <option value="">Choose a state</option>
          {states.map((state) => (
            <option key={state.id} value={state.id}>
              {state.name}
            </option>
          ))}
        </Select>
        <Select
          label="City"
          value={values.cityId}
          disabled={values.stateId === ''}
          onChange={(event) => set('cityId', event.target.value)}
        >
          <option value="">
            {values.stateId === ''
              ? 'Choose a state first'
              : cities.isPending
                ? 'Loading cities…'
                : 'Choose a city'}
          </option>
          {cities.data?.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
            </option>
          ))}
        </Select>
      </form>
    </SellFrame>
  );
}

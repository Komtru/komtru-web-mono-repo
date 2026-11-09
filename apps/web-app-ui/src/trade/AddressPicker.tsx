'use client';

import { useAddresses, useCities, useCreateAddress, useStates } from '@komtru/api-client/react';
import { Button, OptionCard, RiskBanner, SectionLabel, Select, TextField } from '@komtru/ui-kit';
import { useEffect, useState } from 'react';
import { problemMessage } from './format';

export interface AddressPickerProps {
  /** "Delivery address" for a buyer, "Ships from" for a seller. */
  label: string;
  /** The chosen saved address, or `null` before one is chosen. */
  value: string | null;
  onChange: (addressId: string | null) => void;
  /** Whose phone to prefill is not known here, so the form asks. */
  disabled?: boolean;
}

/**
 * The proposal and acceptance forms' address step: the person's saved addresses to choose from, and
 * "Add a new address" inline, which is the whole form when they have none. A trade snapshots the
 * address it is given, so choosing one here is a term of the trade and not a profile edit.
 */
export function AddressPicker({
  label,
  value,
  onChange,
  disabled = false,
}: AddressPickerProps): React.JSX.Element {
  const addresses = useAddresses();
  const [adding, setAdding] = useState(false);
  const list = addresses.data ?? [];
  // The default address is chosen for them until they choose, so the common case is no taps at all.
  const chosen = value ?? list.find((address) => address.isDefault)?.id ?? null;
  useEffect(() => {
    if (value === null && chosen !== null) onChange(chosen);
  }, [value, chosen, onChange]);
  const showForm = addresses.isSuccess && (adding || list.length === 0);

  return (
    <fieldset className="mb-[16px] min-w-0 border-0 p-0" disabled={disabled}>
      <legend className="mb-[6px] p-0 text-[13px] font-semibold">{label}</legend>
      {addresses.isPending && <p className="text-[12px] text-slate">Loading your addresses…</p>}
      {addresses.isError && (
        <RiskBanner title="Couldn't load your addresses">
          <button type="button" className="underline" onClick={() => void addresses.refetch()}>
            Try again
          </button>
        </RiskBanner>
      )}
      {list.map((address) => (
        <OptionCard
          key={address.id}
          name={`address-${label}`}
          value={address.id}
          checked={chosen === address.id}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          description={`${address.streetLine}, ${address.cityName}, ${address.stateName}`}
        >
          {address.label}
        </OptionCard>
      ))}
      {addresses.isSuccess && !showForm && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setAdding(true);
          }}
        >
          Add a new address
        </Button>
      )}
      {showForm && (
        <NewAddressForm
          canCancel={list.length > 0}
          onDone={(id) => {
            setAdding(false);
            if (id !== undefined) onChange(id);
          }}
        />
      )}
    </fieldset>
  );
}

function NewAddressForm({
  onDone,
  canCancel,
}: {
  onDone: (createdId?: string) => void;
  canCancel: boolean;
}): React.JSX.Element {
  const create = useCreateAddress();
  const states = useStates();
  const [stateId, setStateId] = useState('');
  const cities = useCities(stateId === '' ? null : stateId);
  const [cityId, setCityId] = useState('');
  const [fields, setFields] = useState({
    label: '',
    recipientName: '',
    recipientPhone: '',
    streetLine: '',
    landmark: '',
  });
  const [tried, setTried] = useState(false);
  const set = (key: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setFields((current) => ({ ...current, [key]: event.target.value }));
  };

  const missing =
    fields.label.trim() === '' ||
    fields.recipientName.trim() === '' ||
    fields.recipientPhone.replace(/\D/g, '').length < 7 ||
    fields.streetLine.trim() === '' ||
    stateId === '' ||
    cityId === '';

  const submit = () => {
    setTried(true);
    if (missing) return;
    create.mutate(
      {
        label: fields.label,
        recipientName: fields.recipientName,
        recipientPhone: fields.recipientPhone,
        streetLine: fields.streetLine,
        landmark: fields.landmark === '' ? null : fields.landmark,
        stateId,
        cityId,
        makeDefault: false,
      },
      { onSuccess: (address) => onDone(address.id) },
    );
  };

  return (
    <div className="mt-[12px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[14px]">
      <SectionLabel as="h3">New address</SectionLabel>
      <TextField
        label="Name for this address"
        placeholder="Home, Shop, Office"
        value={fields.label}
        onChange={set('label')}
        invalid={tried && fields.label.trim() === ''}
      />
      <TextField
        label="Recipient name"
        autoComplete="name"
        value={fields.recipientName}
        onChange={set('recipientName')}
        invalid={tried && fields.recipientName.trim() === ''}
      />
      <TextField
        label="Recipient phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={fields.recipientPhone}
        onChange={set('recipientPhone')}
        invalid={tried && fields.recipientPhone.replace(/\D/g, '').length < 7}
      />
      <TextField
        label="Street address"
        autoComplete="street-address"
        value={fields.streetLine}
        onChange={set('streetLine')}
        invalid={tried && fields.streetLine.trim() === ''}
      />
      <TextField label="Landmark (optional)" value={fields.landmark} onChange={set('landmark')} />
      <Select
        label="State"
        value={stateId}
        onChange={(event) => {
          setStateId(event.target.value);
          setCityId('');
        }}
        invalid={tried && stateId === ''}
      >
        <option value="">Choose a state</option>
        {states.data?.map((state) => (
          <option key={state.id} value={state.id}>
            {state.name}
          </option>
        ))}
      </Select>
      <Select
        label="City"
        value={cityId}
        disabled={stateId === ''}
        onChange={(event) => {
          setCityId(event.target.value);
        }}
        invalid={tried && cityId === ''}
      >
        <option value="">{stateId === '' ? 'Choose a state first' : 'Choose a city'}</option>
        {cities.data?.map((city) => (
          <option key={city.id} value={city.id}>
            {city.name}
          </option>
        ))}
      </Select>
      {tried && missing && (
        <p role="alert" className="mb-[12px] text-[12px] font-semibold text-risk-on-soft">
          Fill in every field except the landmark to save this address.
        </p>
      )}
      {create.isError && (
        <RiskBanner>{problemMessage(create.error, "We couldn't save that address. Try again.")}</RiskBanner>
      )}
      <div className="flex flex-col gap-[8px]">
        <Button type="button" onClick={submit} disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Save address'}
        </Button>
        {canCancel && (
          <Button
            type="button"
            variant="ghost"
            className="self-center"
            onClick={() => {
              onDone();
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

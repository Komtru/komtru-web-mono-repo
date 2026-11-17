'use client';

import type { Address, UpdateAddressBody } from '@komtru/shared-types';
import {
  useAddresses,
  useCities,
  useCreateAddress,
  useMakeDefaultAddress,
  useStates,
  useSubmitCityRequest,
  useUpdateAddress,
} from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  EmptyState,
  NoteBanner,
  ReadyBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  Select,
  SettingsGroup,
  SettingsRow,
  TextField,
  Toggle,
} from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loading, LoadProblem } from '../states';
import { ADDRESSES_HREF } from './AddressList';
import { addressProblem, localPhone } from './format';

/**
 * SP-M02: add an address, or edit one (`addressId`). The fields are the platform's: a recipient, a phone number, a
 * street, a landmark, and a state and city chosen from the location catalog (the platform refuses a city that is not in
 * the state it names, so the city is cleared when the state changes). The reference's free-text city and its "drop a
 * pin" map are not here: the catalog is what couriers and trades read, and the platform holds no coordinates.
 */
export function AddressForm({ addressId }: { addressId?: string }): React.JSX.Element {
  const editing = addressId !== undefined;
  const title = editing ? 'Edit Address' : 'Add Address';
  const addresses = useAddresses();
  const header = <ScreenHeader title={title} backHref={ADDRESSES_HREF} backLabel="Back to saved addresses" />;

  if (!editing) return <Body header={header} initial={undefined} />;

  if (addresses.isPending) {
    return (
      <ScreenColumn>
        {header}
        <Loading label="Loading your address" />
      </ScreenColumn>
    );
  }
  if (addresses.data === undefined) {
    return (
      <ScreenColumn>
        {header}
        <LoadProblem what="your address" onRetry={() => void addresses.refetch()} />
      </ScreenColumn>
    );
  }
  const found = addresses.data.find((address) => address.id === addressId);
  if (found === undefined) {
    return (
      <ScreenColumn>
        {header}
        <EmptyState
          title="We can’t find that address"
          body="It may have been removed. Your saved addresses are all in the list."
          action={
            <Button asChild variant="secondary">
              <a href={ADDRESSES_HREF}>See your saved addresses</a>
            </Button>
          }
        />
      </ScreenColumn>
    );
  }
  return <Body key={found.id} header={header} initial={found} />;
}

function Body({
  header,
  initial,
}: {
  header: React.ReactNode;
  initial: Address | undefined;
}): React.JSX.Element {
  const router = useRouter();
  const create = useCreateAddress();
  const update = useUpdateAddress();
  const makeDefault = useMakeDefaultAddress();
  const states = useStates();
  const [stateId, setStateId] = useState(initial?.stateId ?? '');
  const cities = useCities(stateId === '' ? null : stateId);
  // A city staff have taken out of the catalog is not offered, so it cannot be kept: choosing another is the edit.
  const [cityId, setCityId] = useState(initial?.cityActive === true ? initial.cityId : '');
  const [fields, setFields] = useState({
    label: initial?.label ?? '',
    recipientName: initial?.recipientName ?? '',
    recipientPhone: initial === undefined ? '' : localPhone(initial.recipientPhone),
    streetLine: initial?.streetLine ?? '',
    landmark: initial?.landmark ?? '',
  });
  const [wantDefault, setWantDefault] = useState(false);
  const [tried, setTried] = useState(false);
  const set = (key: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));

  const phoneOk = fields.recipientPhone.replace(/\D/g, '').length >= 7;
  const missing =
    fields.label.trim() === '' ||
    fields.recipientName.trim() === '' ||
    !phoneOk ||
    fields.streetLine.trim() === '' ||
    stateId === '' ||
    cityId === '';

  const pending = create.isPending || update.isPending || makeDefault.isPending;
  const failure = create.error ?? update.error ?? makeDefault.error;
  const failed = create.isError || update.isError || makeDefault.isError;

  const done = () => router.push(ADDRESSES_HREF);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (missing || pending) return;
    const landmark = fields.landmark.trim() === '' ? null : fields.landmark.trim();

    if (initial === undefined) {
      create.mutate(
        {
          label: fields.label,
          recipientName: fields.recipientName,
          recipientPhone: fields.recipientPhone,
          streetLine: fields.streetLine,
          landmark,
          stateId,
          cityId,
          makeDefault: wantDefault,
        },
        { onSuccess: done },
      );
      return;
    }

    // Only what changed goes: the platform refuses an empty edit, and an unchanged number would be re-sent in a form
    // it already holds.
    const changes: UpdateAddressBody = {};
    if (fields.label.trim() !== initial.label) changes.label = fields.label;
    if (fields.recipientName.trim() !== initial.recipientName) changes.recipientName = fields.recipientName;
    if (fields.recipientPhone.trim() !== localPhone(initial.recipientPhone)) {
      changes.recipientPhone = fields.recipientPhone;
    }
    if (fields.streetLine.trim() !== initial.streetLine) changes.streetLine = fields.streetLine;
    if (landmark !== initial.landmark) changes.landmark = landmark;
    if (stateId !== initial.stateId) changes.stateId = stateId;
    if (cityId !== initial.cityId) changes.cityId = cityId;

    const finish = () => {
      if (wantDefault && !initial.isDefault) makeDefault.mutate(initial.id, { onSuccess: done });
      else done();
    };
    if (Object.keys(changes).length === 0) finish();
    else update.mutate({ id: initial.id, ...changes }, { onSuccess: finish });
  };

  return (
    <ScreenColumn>
      {header}
      <form onSubmit={submit} noValidate>
        <TextField
          label="Label"
          placeholder="e.g. Home"
          maxLength={40}
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
          label="Phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          mono={false}
          className="font-mono"
          value={fields.recipientPhone}
          onChange={set('recipientPhone')}
          invalid={tried && !phoneOk}
        />
        <TextField
          label="Address"
          autoComplete="street-address"
          value={fields.streetLine}
          onChange={set('streetLine')}
          invalid={tried && fields.streetLine.trim() === ''}
        />
        <TextField
          label="Landmark (optional)"
          placeholder="Near…"
          value={fields.landmark}
          onChange={set('landmark')}
          helper="A landmark and a phone number help a courier more than a postcode."
        />
        {states.isError && (
          <RiskBanner title="We couldn’t load the list of states.">
            <Button type="button" variant="ghost" onClick={() => void states.refetch()}>
              Try again
            </Button>
          </RiskBanner>
        )}
        <Select
          label="State"
          value={stateId}
          disabled={states.isError}
          onChange={(event) => {
            setStateId(event.target.value);
            setCityId('');
          }}
          invalid={tried && stateId === ''}
        >
          <option value="">{states.isPending ? 'Loading states…' : 'Choose a state'}</option>
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
          onChange={(event) => setCityId(event.target.value)}
          invalid={tried && cityId === ''}
        >
          <option value="">
            {stateId === '' ? 'Choose a state first' : cities.isPending ? 'Loading cities…' : 'Choose a city'}
          </option>
          {cities.data?.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
            </option>
          ))}
        </Select>
        {cities.isError && (
          <RiskBanner title="We couldn’t load the cities.">
            <Button type="button" variant="ghost" onClick={() => void cities.refetch()}>
              Try again
            </Button>
          </RiskBanner>
        )}
        {stateId !== '' && <CityRequest stateId={stateId} />}

        {initial?.isDefault === true ? (
          <NoteBanner>This is your default address.</NoteBanner>
        ) : (
          <SettingsGroup>
            <SettingsRow
              label="Make this my default address"
              sub="Chosen first when you start or accept a Trade"
              control={
                <Toggle
                  label="Make this my default address"
                  checked={wantDefault}
                  onChange={setWantDefault}
                />
              }
            />
          </SettingsGroup>
        )}

        {tried && missing && (
          <p role="alert" className="mb-[12px] text-[12px] font-semibold text-risk-on-soft">
            Fill in every field except the landmark to save this address.
          </p>
        )}
        {failed && <RiskBanner>{addressProblem(failure, 'save')}</RiskBanner>}
        <ActionStack>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save address'}
          </Button>
          <Button asChild variant="ghost" className="self-center">
            <a href={ADDRESSES_HREF}>Cancel</a>
          </Button>
        </ActionStack>
      </form>
    </ScreenColumn>
  );
}

/** "My city isn't listed": asks the team to add it. Staff decide; nothing about this address changes meanwhile. */
function CityRequest({ stateId }: { stateId: string }): React.JSX.Element {
  const request = useSubmitCityRequest();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  if (request.isSuccess) {
    return (
      <ReadyBanner title="Request sent">
        We’ve passed {request.data.cityName} to the team. Until it’s added, choose the nearest city on the
        list.
      </ReadyBanner>
    );
  }
  if (!open) {
    return (
      <Button type="button" variant="ghost" className="mb-[12px]" onClick={() => setOpen(true)}>
        My city isn’t listed
      </Button>
    );
  }
  return (
    <div className="mb-[14px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[12px]">
      <TextField
        label="City name"
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
      />
      {request.isError && <RiskBanner>{addressProblem(request.error, 'city')}</RiskBanner>}
      <Button
        type="button"
        variant="secondary"
        disabled={request.isPending || name.trim() === ''}
        onClick={() => request.mutate({ stateId, cityName: name.trim() })}
      >
        {request.isPending ? 'Sending…' : 'Ask us to add it'}
      </Button>
    </div>
  );
}

'use client';

import type { Address } from '@komtru/shared-types';
import { useAddresses, useArchiveAddress, useMakeDefaultAddress } from '@komtru/api-client/react';
import {
  Button,
  Chip,
  EmptyState,
  InfoCard,
  InfoRow,
  NoteBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  ActionStack,
  WarnBanner,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { ConfirmSheet } from '../../trade/parts';
import { Loading, LoadProblem } from '../states';
import { MAX_ADDRESSES_PER_USER, addressLine, addressProblem, localPhone } from './format';

export const ADDRESSES_HREF = '/account/addresses';
export const NEW_ADDRESS_HREF = '/account/addresses/new';
export const editAddressHref = (id: string): string => `/account/addresses/${id}`;

const PIN = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round">
    <path d="M12 21s6.5-5.6 6.5-11A6.5 6.5 0 1 0 5.5 10c0 5.4 6.5 11 6.5 11z" />
    <circle cx="12" cy="10" r="2.2" />
  </svg>
);

const Header = (): React.JSX.Element => (
  <ScreenHeader title="Saved Addresses" backHref="/account" backLabel="Back to your account" />
);

/**
 * SP-M01: where you receive items. The platform keeps up to `MAX_ADDRESSES_PER_USER` live addresses, default first;
 * an address is archived and never deleted, because a trade holds the address it was agreed with, so "Remove" says what
 * it does. The default is what the trade screens choose first (the reference's courier-cost estimate is not a thing
 * the platform does, so it is not promised).
 */
export function AddressList(): React.JSX.Element {
  const addresses = useAddresses();
  const makeDefault = useMakeDefaultAddress();
  const archive = useArchiveAddress();
  const [removing, setRemoving] = useState<Address | undefined>(undefined);

  if (addresses.isPending) {
    return (
      <ScreenColumn>
        <Header />
        <Loading label="Loading your addresses" />
      </ScreenColumn>
    );
  }
  if (addresses.data === undefined) {
    return (
      <ScreenColumn>
        <Header />
        <LoadProblem what="your addresses" onRetry={() => void addresses.refetch()} />
      </ScreenColumn>
    );
  }

  const list = addresses.data;
  const full = list.length >= MAX_ADDRESSES_PER_USER;

  return (
    <ScreenColumn>
      <Header />
      {list.length === 0 ? (
        <EmptyState
          title="No saved addresses yet"
          body="Save where you receive items, and it’s ready the next time you start or accept a Trade."
          action={
            <Button asChild>
              <a href={NEW_ADDRESS_HREF}>Add an address</a>
            </Button>
          }
        />
      ) : (
        <>
          <ul aria-label="Your addresses" className="m-0 mb-[14px] list-none p-0">
            {list.map((address) => (
              <li key={address.id} className="mb-[12px]">
                <InfoCard>
                  <InfoRow
                    icon={PIN}
                    title={address.label}
                    detail={`${addressLine(address)} · ${localPhone(address.recipientPhone)}`}
                  />
                </InfoCard>
                <div className="mt-[6px] flex flex-wrap items-center gap-[8px]">
                  {address.isDefault && <Chip tone="verified">Default · chosen first on a new Trade</Chip>}
                  <Button asChild variant="ghost">
                    <a href={editAddressHref(address.id)}>Edit {address.label}</a>
                  </Button>
                  {!address.isDefault && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={makeDefault.isPending}
                      onClick={() => makeDefault.mutate(address.id)}
                    >
                      Make {address.label} the default
                    </Button>
                  )}
                  <Button type="button" variant="ghost" onClick={() => setRemoving(address)}>
                    Remove {address.label}
                  </Button>
                </div>
                {!address.cityActive && (
                  <WarnBanner title="This city can’t take a new Trade">
                    {address.cityName} is no longer in our city list. Edit this address and choose another
                    city.
                  </WarnBanner>
                )}
              </li>
            ))}
          </ul>
          {makeDefault.isError && <RiskBanner>{addressProblem(makeDefault.error, 'default')}</RiskBanner>}
          <NoteBanner>
            When you start or accept a Trade, we choose your default address first. You can pick a different
            one each time.
          </NoteBanner>
          {full ? (
            <p className="mt-[12px] text-[11.5px] leading-[1.6] text-slate">
              You can keep {String(MAX_ADDRESSES_PER_USER)} addresses. Remove one to add another.
            </p>
          ) : (
            <ActionStack>
              <Button asChild>
                <a href={NEW_ADDRESS_HREF}>Add an address</a>
              </Button>
            </ActionStack>
          )}
        </>
      )}
      <ConfirmSheet
        open={removing !== undefined}
        title="Remove this address?"
        confirm="Remove address"
        pending={archive.isPending}
        onConfirm={() => {
          if (removing === undefined) return;
          archive.mutate(removing.id, { onSuccess: () => setRemoving(undefined) });
        }}
        onClose={() => {
          archive.reset();
          setRemoving(undefined);
        }}
      >
        <p className="mb-[12px] text-[12.5px] leading-[1.6] text-slate">
          {removing?.label} won’t be offered for new Trades. Trades already agreed keep the address they were
          agreed with.
        </p>
        {archive.isError && <RiskBanner>{addressProblem(archive.error, 'remove')}</RiskBanner>}
      </ConfirmSheet>
    </ScreenColumn>
  );
}

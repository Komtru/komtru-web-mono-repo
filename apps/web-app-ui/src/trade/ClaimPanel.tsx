'use client';

import type { TradeRole } from '@komtru/api-client';
import { useClaimTrade } from '@komtru/api-client/react';
import { ActionStack, Button, RiskBanner } from '@komtru/ui-kit';
import { useState } from 'react';
import { AddressPicker } from './AddressPicker';
import { problemMessage } from './format';

/**
 * Taking your place in a trade you were invited to. The claim needs a usable saved address, and a
 * person invited by phone or email has none yet, so the picker (with its inline add form) sits above the
 * button and the button waits for an address. A refusal is worded from its code and the picker stays
 * on screen to fix it.
 */
export function ClaimPanel({
  tradeId,
  role,
  onClaimed,
}: {
  tradeId: string;
  role: TradeRole;
  /** Called once the claim has gone through. The trade's own cache entry is already updated. */
  onClaimed?: () => void;
}): React.JSX.Element {
  const claim = useClaimTrade();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  return (
    <>
      <AddressPicker
        label={role === 'SELLER' ? 'Ships from' : 'Delivery address'}
        value={addressId}
        onChange={setAddressId}
      />
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button
          type="button"
          disabled={claim.isPending || addressId === null}
          onClick={() => {
            setProblem(undefined);
            claim.mutate(tradeId, {
              onSuccess: () => onClaimed?.(),
              onError: (error) =>
                setProblem(problemMessage(error, "We couldn't add you to this trade. Try again.")),
            });
          }}
        >
          {claim.isPending ? 'Joining…' : 'Take your place'}
        </Button>
      </ActionStack>
    </>
  );
}

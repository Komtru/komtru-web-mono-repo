'use client';

import { Dispatch } from '../delivery/Dispatch';
import { ShipOrder } from './ShipOrder';
import { useViewportTier } from './viewport';

/**
 * `/trade/[id]/dispatch`. On a phone it is the dispatch step (CWT-S08), which leads on to the ship screen. A
 * tablet and a desktop draw the checklist, the proof and the route as one workspace (DX-19, TX-12), which is the
 * ship screen arranged for the width, so Orders' Dispatch action lands on it directly.
 */
export function DispatchRoute({ id }: { id: string }): React.JSX.Element {
  return useViewportTier() === 'base' ? <Dispatch id={id} /> : <ShipOrder id={id} />;
}

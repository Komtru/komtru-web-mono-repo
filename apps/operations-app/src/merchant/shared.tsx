'use client';

// The Merchant Applications section's chrome, shared by the queue and the case.
import { ConsoleFrame } from '../shell/ConsoleFrame';

export const MERCHANT_HREF = '/merchant-applications';
export const merchantHref = (applicationId: string): string => `${MERCHANT_HREF}/${applicationId}`;

export interface MerchantFrameProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function MerchantFrame({ title, description, actions, children }: MerchantFrameProps) {
  return (
    <ConsoleFrame
      current="merchant-applications"
      title={title}
      {...(description === undefined ? {} : { description })}
      {...(actions === undefined ? {} : { actions })}
    >
      {children}
    </ConsoleFrame>
  );
}

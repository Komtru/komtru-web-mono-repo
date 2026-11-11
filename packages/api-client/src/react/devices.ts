'use client';

import { useMutation } from '@tanstack/react-query';
import { registerDevice, type RegisterDeviceBody } from '../devices.js';
import { useApiClient } from './client-context.js';

/** Announce this device and, when there is one, its push token. */
export function useRegisterDevice() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body: RegisterDeviceBody) => client.call(registerDevice, { body }),
  });
}

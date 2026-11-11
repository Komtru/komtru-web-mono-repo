// The four pieces of shipping evidence, checked the way the platform checks them
// (`apps/backend-api/src/modules/trades/domain/fulfilment.ts`), so a refusal is said beside the field before
// anything is sent. The platform stays the judge: its own field errors are shown if it still refuses.

export const WAYBILL_MESSAGE = 'Use letters, digits and - / . _ only';
export const PHONE_MESSAGE = 'Enter the driver or rider phone number';
export const PLATE_MESSAGE = 'Enter the vehicle registration plate';

/** `^[A-Za-z0-9][A-Za-z0-9 ./_-]*$`, 3 to 60 characters. */
export function checkWaybill(raw: string): string | undefined {
  const value = raw.trim();
  return value.length >= 3 && value.length <= 60 && /^[A-Za-z0-9][A-Za-z0-9 ./_-]*$/.test(value)
    ? undefined
    : WAYBILL_MESSAGE;
}

/** What the platform stores: upper case, runs of spaces collapsed. */
export const normalisePlate = (raw: string): string => raw.trim().toUpperCase().replace(/\s+/g, ' ');

export function checkPlate(raw: string): string | undefined {
  return /^[A-Z0-9][A-Z0-9 -]{2,13}$/.test(normalisePlate(raw)) ? undefined : PLATE_MESSAGE;
}

/**
 * A Nigerian mobile as typed locally (`0801 234 5678`) or in international form (`+234 801 234 5678`), or any
 * other international number with its `+`. The platform parses with a phone library and may refuse a number
 * this accepts; it never refuses one this rejects.
 */
export function checkPhone(raw: string): string | undefined {
  const digits = raw.trim().replace(/[\s\-().]/g, '');
  const ok =
    /^0[789][01]\d{8}$/.test(digits) ||
    /^(\+|00)?234[789][01]\d{8}$/.test(digits) ||
    /^\+(?!234)[1-9]\d{7,14}$/.test(digits);
  return ok ? undefined : PHONE_MESSAGE;
}

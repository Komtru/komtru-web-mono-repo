// Public identifier formats. Internal ids are UUIDs; humans see the short, readable forms below.
import { z } from 'zod';

/** Any RFC 4122 UUID, normalised to lower case. */
export const uuidSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.uuid());

/**
 * `KMT-U-7F3K9Q`: a user's stable public reference (M1 §5.2). Crockford base32, which leaves out
 * I, L, O and U so the id can be read aloud without confusion.
 */
export const publicUserIdSchema = z.string().regex(/^KMT-U-[0-9A-HJKMNP-TV-Z]{6}$/);

/**
 * Trade codes. Issued as `KMT-<7 digits>-NG`: digits read cleanly over a phone call, and seven of
 * them leave room to grow. Typed input is forgiving: case and surrounding spaces are ignored, the
 * `-NG` market suffix is optional, and the shorter codes shown in the design reference
 * (`KMT-88213`) are accepted.
 */
export const TRADE_CODE_EXAMPLE = 'KMT-7398512-NG';

export const tradeCodeSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.string().regex(/^KMT-\d{5,8}(-NG)?$/, `Trade codes look like ${TRADE_CODE_EXAMPLE}`))
  .transform((value) => (value.endsWith('-NG') ? value : `${value}-NG`));

/** Park Hub codes, e.g. `H-JIB-004` (design reference TO-PA7). */
export const hubCodeSchema = z.string().regex(/^H-[A-Z]{3}-\d{3}$/);

// The storefront slug (`merchant_profiles.storefront_slug`). Derived from the business name, and unique:
// the service walks `slugCandidates` until an insert wins, so the unique index is the arbiter and no
// read-then-write race can hand two merchants the same address.
import { randomBytes } from 'node:crypto';

const FALLBACK = 'shop';
const MAX_LENGTH = 60;

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    // An apostrophe is dropped rather than turned into a hyphen: "Ola's" is "olas", not "ola-s".
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : FALLBACK;
}

/** The plain slug, then `-2` to `-9`, then random suffixes for as long as the caller keeps asking. */
export function* slugCandidates(name: string): Generator<string, never, void> {
  const base = slugify(name);
  yield base;
  for (let n = 2; n < 10; n += 1) yield `${base}-${String(n)}`;
  for (;;) yield `${base}-${randomBytes(3).toString('hex')}`;
}

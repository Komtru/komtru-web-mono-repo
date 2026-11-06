import { redirect } from 'next/navigation';

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * The link in an invitation email that still carries the token as `?token=`. It forwards to the
 * welcome page with the token in the **fragment**, which a browser never sends to a server and
 * which the page strips from the address bar once it has read it. This request itself carried the
 * token in a query, so a link built as `/welcome#token=…` is better and avoids this hop entirely.
 */
export default async function Invite({ searchParams }: { searchParams: Search }): Promise<never> {
  const { token } = await searchParams;
  const value = Array.isArray(token) ? token[0] : token;
  redirect(value === undefined || value === '' ? '/welcome' : `/welcome#token=${encodeURIComponent(value)}`);
}

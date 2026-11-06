import { redirect } from 'next/navigation';

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * The link in the invitation email. It carries the token and nothing else, and the welcome page is
 * where acceptance happens, so this forwards there. The token moves to the welcome page's query
 * unchanged and is never logged or stored on the way.
 */
export default async function Invite({ searchParams }: { searchParams: Search }): Promise<never> {
  const { token } = await searchParams;
  const value = Array.isArray(token) ? token[0] : token;
  redirect(value === undefined || value === '' ? '/welcome' : `/welcome?token=${encodeURIComponent(value)}`);
}

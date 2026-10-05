// Enums shared by the backend and every app. Defined once here, never redeclared in an app.
import { z } from 'zod';

/** One user, three ways to sign in (design §7.3); Park Agents use LOGISTICS. */
export const SESSION_SCOPES = ['CONSUMER', 'STAFF', 'LOGISTICS'] as const;
export const sessionScopeSchema = z.enum(SESSION_SCOPES);
export type SessionScope = z.infer<typeof sessionScopeSchema>;

export const CURRENCIES = ['NGN'] as const;
export const currencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof currencySchema>;

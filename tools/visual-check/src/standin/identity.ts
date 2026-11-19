// Who the stand-in says a caller is. Its tokens are not signed and nothing here is an authorization
// boundary: the apps read `sub` (for a digest) and the stand-in reads its own claims back. The refresh
// token names the persona and the scenario, so every request is answered from its own token and two
// checks running at once share no state.
import { PERSONAS, isPersonaId, isScenarioId, type Persona, type ScenarioId } from './personas.ts';

/** The access token lives 15 minutes in the real backend; a visual check never lasts that long. */
const ACCESS_LIFETIME_SECONDS = 15 * 60;

const encodeJson = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export function accessTokenFor(persona: Persona, scenario: ScenarioId, issuedAtMs: number): string {
  const iat = Math.floor(issuedAtMs / 1000);
  const claims = {
    sub: persona.userId,
    scope: persona.scope,
    iat,
    exp: iat + ACCESS_LIFETIME_SECONDS,
    // Stand-in only: which persona and which data scenario answer this bearer. A real token has neither.
    vc_persona: persona.id,
    vc_scenario: scenario,
  };
  return `${encodeJson({ alg: 'none', typ: 'JWT' })}.${encodeJson(claims)}.standin`;
}

/** `vc.<persona>.<scenario>`. Opaque to the apps, which only store it and send it back. */
export const refreshTokenFor = (persona: Persona, scenario: ScenarioId): string =>
  `vc.${persona.id}.${scenario}`;

export interface Identity {
  persona: Persona;
  scenario: ScenarioId;
}

/** The identity a refresh token names, or `null` for anything the stand-in did not mint. */
export function readRefreshToken(token: unknown): Identity | null {
  if (typeof token !== 'string') return null;
  const [prefix, persona, scenario, ...rest] = token.split('.');
  if (prefix !== 'vc' || rest.length > 0 || persona === undefined || scenario === undefined) return null;
  if (!isPersonaId(persona) || !isScenarioId(scenario)) return null;
  return { persona: PERSONAS[persona], scenario };
}

/** The identity a bearer access token names, or `null` when it is missing or not one of ours. */
export function readBearer(header: string | undefined): Identity | null {
  if (header === undefined || !header.startsWith('Bearer ')) return null;
  const parts = header.slice('Bearer '.length).split('.');
  if (parts.length !== 3 || parts[2] !== 'standin') return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as {
      vc_persona?: unknown;
      vc_scenario?: unknown;
    };
    if (typeof claims.vc_persona !== 'string' || typeof claims.vc_scenario !== 'string') return null;
    if (!isPersonaId(claims.vc_persona) || !isScenarioId(claims.vc_scenario)) return null;
    return { persona: PERSONAS[claims.vc_persona], scenario: claims.vc_scenario };
  } catch {
    return null;
  }
}

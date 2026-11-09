// The one place that decides how this process talks TLS to Postgres.
//
// Managed Postgres is usually fronted by a CA that Node does not ship: Amazon RDS presents a chain
// rooted in the Amazon RDS CA, so a verified connection fails with `self-signed certificate in
// certificate chain` against the default trust store. The documented workaround is the
// NODE_EXTRA_CA_CERTS environment variable, but that lives in whichever shell happens to launch the
// process — forget to export it in a new terminal and the app dies with an error that names neither
// the variable nor the file. `POSTGRES_CA_CERT` puts the same answer in the same .env as the URL it
// belongs to, so it travels with the configuration instead of with the shell.
//
// Verification is never weakened here. The bundle is what makes a verified connection possible.
import { readFileSync } from 'node:fs';

export interface PostgresTlsInput {
  ssl: boolean;
  /** Path to a PEM bundle, from POSTGRES_CA_CERT. */
  caCertPath?: string | undefined;
}

/** `pg`'s `ssl` option: `false`, or TLS options with verification on. */
export type PostgresTlsOptions = false | { rejectUnauthorized: true; ca?: string };

export class PostgresCaError extends Error {
  constructor(
    readonly caCertPath: string,
    cause: unknown,
  ) {
    super(
      `POSTGRES_CA_CERT points at ${caCertPath}, which could not be read. ` +
        `For Amazon RDS, download the bundle first:\n` +
        `  mkdir -p "$(dirname ${caCertPath})" && curl -fsSL -o ${caCertPath} ` +
        `https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem\n` +
        `Leave POSTGRES_CA_CERT empty to verify against the system trust store instead.`,
      { cause },
    );
    this.name = 'PostgresCaError';
  }
}

// A pool opens connections over the process's lifetime; the bundle is read once per path, not once
// per connection. Keyed by path so a test can point at a different file.
const cache = new Map<string, string>();

export function postgresSslOptions({ ssl, caCertPath }: PostgresTlsInput): PostgresTlsOptions {
  if (!ssl) return false;
  if (!caCertPath) return { rejectUnauthorized: true };

  const cached = cache.get(caCertPath);
  if (cached !== undefined) return { rejectUnauthorized: true, ca: cached };

  let pem: string;
  try {
    pem = readFileSync(caCertPath, 'utf8');
  } catch (error) {
    throw new PostgresCaError(caCertPath, error);
  }
  cache.set(caCertPath, pem);
  return { rejectUnauthorized: true, ca: pem };
}

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PostgresCaError, postgresSslOptions } from '../../src/platform/postgres-ssl.js';

const PEM = '-----BEGIN CERTIFICATE-----\nnot-a-real-certificate\n-----END CERTIFICATE-----\n';

describe('postgresSslOptions', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const withCert = () => {
    dir = mkdtempSync(path.join(tmpdir(), 'komtru-ca-'));
    const file = path.join(dir, 'bundle.pem');
    writeFileSync(file, PEM);
    return file;
  };

  it('disables TLS when POSTGRES_SSL is off, whatever else is set', () => {
    expect(postgresSslOptions({ ssl: false })).toBe(false);
    expect(postgresSslOptions({ ssl: false, caCertPath: '/nope.pem' })).toBe(false);
  });

  it('verifies against the system store when no bundle is named', () => {
    expect(postgresSslOptions({ ssl: true })).toEqual({ rejectUnauthorized: true });
  });

  /**
   * Amazon's RDS CA is not in Node's default trust store, so a verified connection to RDS needs the
   * bundle supplied explicitly. Verification stays ON — the bundle is what makes it possible, not a
   * way around it.
   */
  it('verifies against a named bundle, keeping verification on', () => {
    expect(postgresSslOptions({ ssl: true, caCertPath: withCert() })).toEqual({
      rejectUnauthorized: true,
      ca: PEM,
    });
  });

  it('reads the bundle once, so a pool does not re-read it per connection', () => {
    const file = withCert();
    const first = postgresSslOptions({ ssl: true, caCertPath: file });
    rmSync(file);
    expect(postgresSslOptions({ ssl: true, caCertPath: file })).toEqual(first);
  });

  /**
   * The failure this replaces is `self-signed certificate in certificate chain` thrown from deep in
   * the TLS stack, which says nothing about which file is missing or how to get it.
   */
  it('names the missing file and how to fetch it, instead of failing inside TLS later', () => {
    const missing = path.join(tmpdir(), 'komtru-absent-bundle.pem');
    let error: unknown;
    try {
      postgresSslOptions({ ssl: true, caCertPath: missing });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PostgresCaError);
    expect((error as Error).message).toContain(missing);
    expect((error as Error).message).toContain('POSTGRES_CA_CERT');
    expect((error as Error).message).toContain('truststore.pki.rds.amazonaws.com');
  });
});

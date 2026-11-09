// A reference `fetchImage` that satisfies the contract, kept in the tests so the contract itself is
// proven satisfiable and T-034 has a working shape to copy. It is NOT production code: T-034 owns the
// real one (circuit breaker, metrics, https only).
import { lookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { describe } from 'vitest';
import { PROVIDER_IMAGE_MAX_BYTES } from '../../../../src/modules/identity/domain/avatar.js';
import {
  describeFetchImageContract,
  type FetchImage,
  type FetchImageOptions,
} from '../../../support/fetch-image-contract.js';

const isPrivate = (address: string): boolean =>
  /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
    address,
  ) ||
  address === '::1' ||
  /^f[cd]/i.test(address) ||
  /^fe80/i.test(address) ||
  /^::ffff:(0\.|10\.|127\.|169\.254\.|192\.168\.)/i.test(address);

const makeReference =
  (options: FetchImageOptions): FetchImage =>
  (url) =>
    new Promise((resolve, reject) => {
      // Node does not call `lookup` for an IP literal, so a literal is judged directly.
      const literal = url.hostname.replace(/^\[|\]$/g, '');
      if (isIP(literal) && isPrivate(literal) && !options.allowLoopbackHttp) {
        return reject(new Error('refused: private address'));
      }
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = send(
        url,
        {
          method: 'GET',
          // The address is judged HERE, on the answer the socket is about to use, so a hostname that
          // resolves to a private address (or flips between lookups) cannot get past an earlier check.
          lookup: (hostname, lookupOptions, callback) =>
            lookup(hostname, lookupOptions, (error, address, family) => {
              const first = Array.isArray(address) ? address[0]?.address : address;
              if (!error && first && isIP(first) && isPrivate(first) && !options.allowLoopbackHttp) {
                return callback(new Error('refused: private address'), '', 4);
              }
              callback(error, address, family);
            }),
        },
        (res) => {
          // A redirect is a new URL nobody checked: refuse it rather than follow.
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            res.destroy();
            return reject(new Error(`unexpected status ${String(res.statusCode)}`));
          }
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > PROVIDER_IMAGE_MAX_BYTES) {
              req.destroy();
              return reject(new Error('image too large'));
            }
            chunks.push(chunk);
          });
          res.on('end', () => resolve({ bytes: new Uint8Array(Buffer.concat(chunks)) }));
          res.on('error', reject);
        },
      );
      // One deadline for the whole exchange, so a trickling body cannot outlive it.
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error('timeout'));
      }, options.timeoutMs);
      req.on('close', () => clearTimeout(timer));
      req.on('error', reject);
      req.end();
    });

describe('reference fetchImage', () => {
  describeFetchImageContract('reference implementation', makeReference);
});

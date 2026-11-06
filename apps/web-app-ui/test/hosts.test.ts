import { describe, expect, it } from 'vitest';
import { HUB_APPLICATION_PATHS, PASSPORT_ROUTE_PREFIX, routeRequest, type HostRules } from '../src/hosts';

/** Production: three hosts. */
const DEPLOYED: HostRules = {
  appUrl: 'https://app.komtru.com',
  passportUrl: 'https://passport.komtru.com',
  parkUrl: 'https://park.komtru.com',
};

/** Local: one host, and the passport pages are a path on it. */
const LOCAL: HostRules = {
  appUrl: 'http://localhost:3001',
  passportUrl: 'http://localhost:3001/passport',
  parkUrl: 'http://localhost:3004',
};

const at = (host: string, pathname: string, search = '') => ({ host, pathname, search });

describe('passport.komtru.com', () => {
  it('serves the public profile routes from a host of its own', () => {
    expect(routeRequest(at('passport.komtru.com', '/techedge-ng'), DEPLOYED)).toEqual({
      kind: 'rewrite',
      pathname: '/passport/techedge-ng',
    });
  });

  it('keeps the rest of the path, which is where a seller’s listings and report live', () => {
    expect(routeRequest(at('passport.komtru.com', '/techedge-ng/listings'), DEPLOYED)).toEqual({
      kind: 'rewrite',
      pathname: '/passport/techedge-ng/listings',
    });
  });

  it('rewrites its root to the passport index rather than the app’s home', () => {
    expect(routeRequest(at('passport.komtru.com', '/'), DEPLOYED)).toEqual({
      kind: 'rewrite',
      pathname: PASSPORT_ROUTE_PREFIX,
    });
  });

  it('does not prefix a path that already carries the prefix', () => {
    // Otherwise an absolute link written by a passport page turns into /passport/passport/x.
    expect(routeRequest(at('passport.komtru.com', '/passport/techedge-ng'), DEPLOYED)).toEqual({
      kind: 'app',
    });
  });

  it('leaves the route handlers, the build output and the worker alone', () => {
    for (const pathname of ['/api/auth/login', '/_next/static/chunk.js', '/sw.js', '/favicon.ico']) {
      expect(routeRequest(at('passport.komtru.com', pathname), DEPLOYED), pathname).toEqual({ kind: 'app' });
    }
  });

  it('rewrites nothing locally, where the passport pages are already a path on this app', () => {
    expect(routeRequest(at('localhost:3001', '/techedge-ng'), LOCAL)).toEqual({ kind: 'app' });
    expect(routeRequest(at('localhost:3001', '/passport/techedge-ng'), LOCAL)).toEqual({ kind: 'app' });
  });

  it('ignores the port when a deployment serves the passport host on one', () => {
    const rules = { ...DEPLOYED, passportUrl: 'https://passport.komtru.com:8443' };
    expect(routeRequest(at('passport.komtru.com:8443', '/techedge-ng'), rules)).toEqual({
      kind: 'rewrite',
      pathname: '/passport/techedge-ng',
    });
  });
});

describe('/hub/* (design C12)', () => {
  it('keeps the application flow, which is a consumer screen in this app', () => {
    for (const pathname of HUB_APPLICATION_PATHS) {
      expect(routeRequest(at('app.komtru.com', pathname), DEPLOYED), pathname).toEqual({ kind: 'app' });
    }
    expect(routeRequest(at('app.komtru.com', '/hub/register/identity'), DEPLOYED)).toEqual({ kind: 'app' });
    expect(routeRequest(at('app.komtru.com', '/hub/application/changes'), DEPLOYED)).toEqual({ kind: 'app' });
  });

  it('sends every operating URL to the Park Agent app', () => {
    const cases: [string, string][] = [
      ['/hub/log-arrival', 'https://park.komtru.com/log-arrival'],
      ['/hub/inspect/KMT-88213', 'https://park.komtru.com/inspect/KMT-88213'],
      ['/hub/handover/KMT-88213', 'https://park.komtru.com/handover/KMT-88213'],
      ['/hub/earnings', 'https://park.komtru.com/earnings'],
      ['/hub/incident', 'https://park.komtru.com/incident'],
      ['/hub/profile', 'https://park.komtru.com/profile'],
      ['/hub/jibowu', 'https://park.komtru.com/jibowu'],
    ];
    for (const [pathname, url] of cases) {
      expect(routeRequest(at('app.komtru.com', pathname), DEPLOYED), pathname).toEqual({
        kind: 'redirect',
        url,
      });
    }
  });

  it('sends the bare prefix to the Park app’s own root', () => {
    expect(routeRequest(at('app.komtru.com', '/hub'), DEPLOYED)).toEqual({
      kind: 'redirect',
      url: 'https://park.komtru.com/',
    });
  });

  it('carries the query across, so a link with a trade code in it still works', () => {
    expect(routeRequest(at('app.komtru.com', '/hub/log-arrival', '?code=KMT-88213'), DEPLOYED)).toEqual({
      kind: 'redirect',
      url: 'https://park.komtru.com/log-arrival?code=KMT-88213',
    });
  });

  it('matches whole segments, so /hubbub is a page of this app', () => {
    expect(routeRequest(at('app.komtru.com', '/hubbub'), DEPLOYED)).toEqual({ kind: 'app' });
  });

  it('redirects locally too, where the Park app is another port', () => {
    expect(routeRequest(at('localhost:3001', '/hub/log-arrival'), LOCAL)).toEqual({
      kind: 'redirect',
      url: 'http://localhost:3004/log-arrival',
    });
  });
});

describe('everything else', () => {
  it('is this app, served as asked', () => {
    for (const pathname of ['/', '/trades', '/account', '/browse/electronics']) {
      expect(routeRequest(at('app.komtru.com', pathname), DEPLOYED), pathname).toEqual({ kind: 'app' });
    }
  });
});

// Static hosting: the console is always served apart from runtara-server, by
// its container image or a plain static host (a CDN), which serve the same
// index.html to every path and tenant. The deployment's settings come from
// `config.js`, which index.html loads before the app and the image renders
// from env vars at startup, or else from a `config.json` next to index.html.
//
// Runs before anything reads the config (see main.tsx): runtimeConfig.ts
// snapshots `window.__RUNTARA_CONFIG__` when it is first imported.
//
// Imports nothing at runtime, so loading it evaluates no other module.

import type { RuntimeConfig } from '@/shared/config/runtimeConfig';

/**
 * `mountPath` with exactly one leading and one trailing slash; `/ui/` when
 * unset.
 */
export function normalizeMountPath(mountPath: string | undefined): string {
  if (!mountPath?.trim()) return '/ui/';
  const segments = mountPath.split('/').filter(Boolean);
  return segments.length ? `/${segments.join('/')}/` : '/';
}

/** Whether `pathname` is the mount or below it. */
export function isWithinMount(pathname: string, mountPath: string): boolean {
  return pathname.startsWith(mountPath) || `${pathname}/` === mountPath;
}

/**
 * The deployment's settings from `config.js` or `config.json`, or `undefined`
 * when there are none. Keys only a build or a server can know are dropped: the
 * version stamp is the bundle's own (`VITE_RUNTARA_*`), and entitlements are
 * the tenant's, read from `GET /api/runtime/entitlements`.
 */
export function parseStaticConfig(loaded: unknown): RuntimeConfig | undefined {
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
    return undefined;
  }
  const settings = { ...(loaded as Record<string, unknown>) };
  for (const key of ['version', 'commit', 'buildNumber', 'entitlements']) {
    delete settings[key];
  }
  return { ...(settings as RuntimeConfig), hosting: 'static' };
}

/**
 * Settle the deployment's settings: those `config.js` set, or else
 * `config.json`'s. Returns `false` when the page is leaving for the mount, so
 * the caller boots nothing.
 *
 * Never throws: with neither (vite dev) the build-time `VITE_*` values stay in
 * force.
 */
export async function loadStaticConfig(): Promise<boolean> {
  // A rendered `config.js` marks itself `hosting: "static"`. One that sets
  // `authMode` without it is a test's, which runs at the page root rather than
  // under the mount; the placeholder `config.js` sets nothing.
  const rendered = window.__RUNTARA_CONFIG__;
  if (rendered?.authMode && rendered.hosting !== 'static') return true;

  let config = rendered?.authMode ? parseStaticConfig(rendered) : undefined;
  if (!config) config = await fetchConfigJson();
  if (!config) return true;

  window.__RUNTARA_CONFIG__ = config;

  // Everything the console shows is under the mount (its tenants at
  // `{mount}{tenant}/`), so a page outside it (the bare origin, where a 401
  // sends the user) goes to the mount.
  const mountPath = normalizeMountPath(config.mountPath);
  if (!isWithinMount(window.location.pathname, mountPath)) {
    window.location.replace(mountPath);
    return false;
  }
  return true;
}

async function fetchConfigJson(): Promise<RuntimeConfig | undefined> {
  try {
    const response = await fetch(new URL('config.json', document.baseURI), {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    // A static host's SPA fallback (vite dev, Cloudflare Pages) answers a
    // missing config.json with index.html and a 200.
    const type = response.headers.get('content-type') ?? '';
    if (response.ok && type.includes('application/json')) {
      return parseStaticConfig(await response.json());
    }
  } catch (error) {
    console.warn('[runtara] config.json could not be read', error);
  }
  return undefined;
}

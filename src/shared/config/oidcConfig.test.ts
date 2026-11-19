import { afterEach, describe, expect, it, vi } from 'vitest';

// The settings are read when `createOidcConfig` is called, so each case sets
// the runtime config it needs and imports the module afresh.
async function oidcWith(runtime: {
  isOidcAuth: boolean;
  oidc: Record<string, string | boolean | undefined>;
}) {
  vi.resetModules();
  vi.doMock('@/shared/config/runtimeConfig', () => ({
    isOidcAuth: runtime.isOidcAuth,
    config: { oidc: runtime.oidc },
  }));
  vi.doMock('@/shared/config/appBase', () => ({
    appBaseUrl: 'https://console.example/ui/acme/',
    mountReturnPath: '/ui/',
    tenantIdFromUrl: 'acme',
  }));
  return import('./oidcConfig');
}

afterEach(() => {
  vi.doUnmock('@/shared/config/runtimeConfig');
  vi.doUnmock('@/shared/config/appBase');
});

const complete = {
  authority: 'https://id.example',
  clientId: 'console',
  audience: 'https://api.example',
  organizations: true,
};

describe('createOidcConfig', () => {
  it('can be imported without OIDC settings: nothing is worked out until asked', async () => {
    const module = await oidcWith({ isOidcAuth: true, oidc: {} });

    expect(typeof module.createOidcConfig).toBe('function');
  });

  it('refuses to boot an OIDC deployment that is missing a setting, and says which are needed', async () => {
    const { createOidcConfig } = await oidcWith({
      isOidcAuth: true,
      oidc: { ...complete, audience: undefined },
    });

    expect(() => createOidcConfig()).toThrow(
      /Missing required OIDC configuration.*RUNTARA_UI_OIDC_/
    );
  });

  it('signs in at the identity provider and returns to the mount every tenant shares', async () => {
    const { createOidcConfig } = await oidcWith({
      isOidcAuth: true,
      oidc: complete,
    });

    const settings = createOidcConfig();

    expect(settings.authority).toBe('https://id.example');
    expect(settings.client_id).toBe('console');
    expect(settings.redirect_uri).toBe('https://console.example/ui/');
    expect(settings.metadata.authorization_endpoint).toBe(
      'https://id.example/authorize'
    );
    expect(settings.extraQueryParams).toEqual({
      audience: 'https://api.example',
      organization: 'acme',
    });
    expect(settings.automaticSilentRenew).toBe(true);
  });

  it('names no organization where the provider does not model tenants as one', async () => {
    const { createOidcConfig } = await oidcWith({
      isOidcAuth: true,
      oidc: { ...complete, organizations: false },
    });

    expect(createOidcConfig().extraQueryParams).toEqual({
      audience: 'https://api.example',
    });
  });

  it('needs no settings where sign-in is not by OIDC, and points nowhere outside the console', async () => {
    const { createOidcConfig } = await oidcWith({
      isOidcAuth: false,
      oidc: {},
    });

    const settings = createOidcConfig();

    expect(settings.authority).toBe(
      `${window.location.origin}/__runtara_no_auth__`
    );
    expect(
      settings.metadata.token_endpoint.startsWith(window.location.origin)
    ).toBe(true);
    expect(settings.automaticSilentRenew).toBe(false);
  });
});

import { afterAll, describe, expect, it, vi } from 'vitest';

import { stubSealWasmFetch, testOffer } from '@/test/seal-wasm';
import { sealSecrets } from './seal-wasm';

describe('sealing with seal’s WASM module', () => {
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('fails when the module does not load, and loads on a later call', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('forced WASM load failure');
    });
    await expect(
      sealSecrets(testOffer(['token']), { token: 'synthetic-token' })
    ).rejects.toThrow();

    stubSealWasmFetch();
    await expect(
      sealSecrets(testOffer(['token']), { token: 'synthetic-token' })
    ).resolves.toBeTruthy();
  });

  it('returns an envelope for the offer’s key that holds nothing readable', async () => {
    stubSealWasmFetch();
    const offer = testOffer(['token', 'xh_52226f3182e4796bc3fc36112afd62c5']);
    const envelope = await sealSecrets(offer, {
      token: 'synthetic-token',
      xh_52226f3182e4796bc3fc36112afd62c5: 'synthetic-header',
    });

    expect(Object.keys(envelope).sort()).toEqual([
      'ct',
      'enc',
      'keyset',
      'kid',
      'v',
    ]);
    expect(envelope.keyset).toBe(offer.keyset);
    expect(envelope.kid).toBe(offer.kid);
    const sent = JSON.stringify(envelope);
    expect(sent).not.toContain('synthetic-token');
    expect(sent).not.toContain('synthetic-header');
  });

  it('seals differently each time', async () => {
    stubSealWasmFetch();
    const offer = testOffer(['token']);
    const first = await sealSecrets(offer, { token: 'synthetic-token' });
    const second = await sealSecrets(offer, { token: 'synthetic-token' });
    expect(first.ct).not.toBe(second.ct);
  });

  it('refuses an offer it cannot seal under, naming no value', async () => {
    stubSealWasmFetch();
    const offer = { ...testOffer(['token']), policy: { unknown: true } };
    await expect(
      sealSecrets(offer, { token: 'synthetic-token' })
    ).rejects.toSatisfy(
      (error) => !String((error as Error).message).includes('synthetic-token')
    );
  });
});

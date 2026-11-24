import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

import type { SealOffer } from '@/shared/lib/seal-wasm';

const wasmBytes = readFileSync(
  path.resolve(process.cwd(), 'node_modules/seal-wasm/web/seal_format_bg.wasm')
);

/** Serves seal's WASM module to the loader, which fetches it by URL. */
export function stubSealWasmFetch() {
  const originalFetch = globalThis.fetch.bind(globalThis);
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const target =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (target.endsWith('seal_format_bg.wasm')) {
        return new Response(wasmBytes, {
          headers: { 'Content-Type': 'application/wasm' },
        });
      }
      return originalFetch(input, init);
    }
  );
}

/** An offer as the server makes one, to a key nobody holds, for `fields`. */
export function testOffer(fields: string[]): SealOffer {
  const publicKey = generateKeyPairSync('x25519')
    .publicKey.export({ type: 'spki', format: 'der' })
    .subarray(-32);
  return {
    public_key: publicKey.toString('base64url'),
    kid: 'k-1-test',
    keyset: 'local',
    item: '0f78f802-7835-43ab-8b03-b32b1ae23981',
    field: 'intake',
    policy: {
      intake: {
        not_after: 1795504709,
        outputs: Object.fromEntries(
          fields.map((field) => [
            field,
            'SvwW39l-7oda_5F43SMrl8EdUIU9iv3DA8vGCLyaneI',
          ])
        ),
      },
    },
  };
}

import initSeal, { seal } from 'seal-wasm/web';
import sealWasmUrl from 'seal-wasm/web/seal_format_bg.wasm?url';

/** seal's offer, as the server gives it. Passed to the sealer as it is. */
export interface SealOffer {
  public_key: string;
  kid: string;
  keyset: string;
  item: string;
  field: string;
  policy: unknown;
}

/** A sealed value. Only seal can open it. */
export type SealedEnvelope = Record<string, unknown>;

let initPromise: Promise<unknown> | null = null;

/** Loads seal's sealer. A failed load is tried again on the next call. */
export function ensureSealerInitialized(): Promise<unknown> {
  initPromise ??= initSeal({ module_or_path: sealWasmUrl }).catch((error) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

/**
 * Seals `secrets` under `offer` as one JSON object, and returns the envelope.
 *
 * The object is sealed from bytes that are overwritten afterwards. Throws if
 * the sealer does not load or refuses the offer; an error of seal's names
 * what is not valid and never includes a value.
 */
export async function sealSecrets(
  offer: SealOffer,
  secrets: Record<string, string>
): Promise<SealedEnvelope> {
  await ensureSealerInitialized();
  const bytes = new TextEncoder().encode(JSON.stringify(secrets));
  try {
    return JSON.parse(
      seal(
        offer.public_key,
        offer.kid,
        offer.keyset,
        offer.item,
        offer.field,
        bytes,
        JSON.stringify(offer.policy)
      )
    ) as SealedEnvelope;
  } finally {
    bytes.fill(0);
  }
}

import type { ConnectionOfferResponse } from '@/generated/RuntaraRuntimeApi';
import {
  sealSecrets,
  type SealedEnvelope,
  type SealOffer,
} from '@/shared/lib/seal-wasm';
import {
  MAX_ENTERED_SECRETS,
  SecretEntryError,
  type EnteredSecrets,
} from './enter-secrets';

/** Whether a save was refused because its offer no longer stands. */
function isOfferStale(error: unknown): boolean {
  const response = (
    error as { response?: { status?: number; data?: { error?: string } } }
  )?.response;
  return response?.status === 409 && response.data?.error === 'OFFER_STALE';
}

/** A failed save's error must not keep the envelope it sent. */
function withoutSentBody(error: unknown): unknown {
  const config = (error as { config?: { data?: unknown } } | null)?.config;
  if (config && 'data' in config) delete config.data;
  return error;
}

async function sealUnder(
  offered: ConnectionOfferResponse,
  secrets: EnteredSecrets
): Promise<SealedEnvelope> {
  if (!offered.offer) {
    throw new SecretEntryError(
      'The server gave nothing to seal the secrets under. Nothing was saved.'
    );
  }
  // The name the offer gives each secret in the object that is sealed.
  const named: Record<string, string> = {};
  for (const [name, value] of Object.entries(secrets)) {
    const field = offered.fields?.[name];
    if (!field) {
      throw new SecretEntryError(
        `The server did not expect a secret in "${name}". Nothing was saved.`
      );
    }
    named[field] = value;
  }
  try {
    return await sealSecrets(offered.offer as SealOffer, named);
  } catch (error) {
    // seal's errors name what is not valid and never include a value.
    const reason = error instanceof Error ? error.message : String(error);
    throw new SecretEntryError(
      /too large/i.test(reason)
        ? 'These secrets are too large to save together. Enter fewer or shorter ones in one save.'
        : `The secrets could not be sealed in this browser, so nothing was saved: ${reason}`
    );
  }
}

/**
 * Saves a request that enters `secrets`: asks for an offer with the request,
 * seals the secrets under it, and saves the same request with the envelope.
 * A request that enters none is saved as it is.
 *
 * `body` already holds a marker in place of each secret (see
 * `enterSecrets`), and is the one value both calls are given. A secret is
 * never sent readable: if the offer or the sealer fails, the save fails.
 *
 * An offer that went stale before the save is replaced once, without asking.
 */
export async function saveSealed<TBody extends object, TSaved>({
  body,
  secrets,
  requestOffer,
  save,
}: {
  body: TBody;
  secrets: EnteredSecrets;
  requestOffer: (body: TBody) => Promise<ConnectionOfferResponse>;
  save: (
    body: TBody,
    sealed?: { envelope: SealedEnvelope; connectionId: string }
  ) => Promise<TSaved>;
}): Promise<TSaved> {
  const entered = Object.keys(secrets).length;
  if (entered === 0) return save(body);
  if (entered > MAX_ENTERED_SECRETS) {
    throw new SecretEntryError(
      `One save can enter at most ${MAX_ENTERED_SECRETS} secrets, and this one enters ${entered}. Save them in parts.`
    );
  }
  for (let attempt = 0; ; attempt += 1) {
    const offered = await requestOffer(body);
    const envelope = await sealUnder(offered, secrets);
    try {
      return await save(body, {
        envelope,
        connectionId: offered.connectionId,
      });
    } catch (error) {
      if (!isOfferStale(error)) throw withoutSentBody(error);
      if (attempt > 0) {
        throw new SecretEntryError(
          'The secrets could not be saved: the server stopped taking them twice in a row. Try again.'
        );
      }
    }
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveSealed } from './sealed-save';
import { SecretEntryError } from './enter-secrets';

const sealSecrets = vi.hoisted(() => vi.fn());
vi.mock('@/shared/lib/seal-wasm', () => ({ sealSecrets }));

const body = {
  title: 'Orders',
  connectionParameters: { token: { $entered: true } },
};
const secrets = { token: 'synthetic-token' };
const offered = {
  success: true,
  connectionId: 'conn-1',
  offer: { public_key: 'pk' },
  fields: { token: 'token' },
};

function refusal(status: number, error: string) {
  return {
    response: { status, data: { error } },
    config: { data: JSON.stringify({ sealedSecrets: { ct: 'sealed' } }) },
  };
}

describe('saveSealed', () => {
  beforeEach(() => {
    sealSecrets.mockReset();
    sealSecrets.mockResolvedValue({ ct: 'sealed' });
  });

  it('saves a request that enters no secret as it is, with no offer', async () => {
    const requestOffer = vi.fn();
    const save = vi.fn().mockResolvedValue('saved');
    await expect(
      saveSealed({ body, secrets: {}, requestOffer, save })
    ).resolves.toBe('saved');
    expect(requestOffer).not.toHaveBeenCalled();
    expect(sealSecrets).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledExactlyOnceWith(body);
  });

  it('gives the offer and the save the one request, and seals under the offer’s names', async () => {
    const requestOffer = vi.fn().mockResolvedValue({
      ...offered,
      fields: { token: 'xh_made_for_it' },
    });
    const save = vi.fn().mockResolvedValue('saved');
    await saveSealed({ body, secrets, requestOffer, save });

    expect(requestOffer.mock.calls[0][0]).toBe(body);
    expect(save.mock.calls[0][0]).toBe(body);
    expect(save.mock.calls[0][1]).toEqual({
      envelope: { ct: 'sealed' },
      connectionId: 'conn-1',
    });
    expect(sealSecrets).toHaveBeenCalledExactlyOnceWith(
      { public_key: 'pk' },
      { xh_made_for_it: 'synthetic-token' }
    );
  });

  it('sends no save when the sealer does not load', async () => {
    sealSecrets.mockRejectedValue(new Error('module did not load'));
    const save = vi.fn();
    await expect(
      saveSealed({
        body,
        secrets,
        requestOffer: vi.fn().mockResolvedValue(offered),
        save,
      })
    ).rejects.toBeInstanceOf(SecretEntryError);
    expect(save).not.toHaveBeenCalled();
  });

  it('sends no save when the offer fails', async () => {
    const save = vi.fn();
    const failed = refusal(400, 'Connection title cannot be empty');
    await expect(
      saveSealed({
        body,
        secrets,
        requestOffer: vi.fn().mockRejectedValue(failed),
        save,
      })
    ).rejects.toBe(failed);
    expect(sealSecrets).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('sends no save when the server makes no offer, or expects another secret', async () => {
    const save = vi.fn();
    for (const answer of [
      { ...offered, offer: null },
      { ...offered, fields: {} },
    ]) {
      await expect(
        saveSealed({
          body,
          secrets,
          requestOffer: vi.fn().mockResolvedValue(answer),
          save,
        })
      ).rejects.toBeInstanceOf(SecretEntryError);
    }
    expect(sealSecrets).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('says so before asking when a save enters more than 16 secrets', async () => {
    const requestOffer = vi.fn();
    const save = vi.fn();
    const many = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`secret_${index}`, 'value'])
    );
    await expect(
      saveSealed({ body, secrets: many, requestOffer, save })
    ).rejects.toThrow(/at most 16 secrets/);
    expect(requestOffer).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('replaces a stale offer once, sealing again, without asking', async () => {
    const requestOffer = vi
      .fn()
      .mockResolvedValueOnce(offered)
      .mockResolvedValueOnce({ ...offered, connectionId: 'conn-2' });
    const save = vi
      .fn()
      .mockRejectedValueOnce(refusal(409, 'OFFER_STALE'))
      .mockResolvedValueOnce('saved');
    await expect(
      saveSealed({ body, secrets, requestOffer, save })
    ).resolves.toBe('saved');
    expect(requestOffer).toHaveBeenCalledTimes(2);
    expect(sealSecrets).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1].connectionId).toBe('conn-2');
  });

  it('shows a second stale offer instead of trying a third time', async () => {
    const requestOffer = vi.fn().mockResolvedValue(offered);
    const save = vi.fn().mockRejectedValue(refusal(409, 'OFFER_STALE'));
    const failure = await saveSealed({
      body,
      secrets,
      requestOffer,
      save,
    }).catch((error) => error);
    expect(failure).toBeInstanceOf(SecretEntryError);
    // Not a conflict for the edit page to recover from.
    expect((failure as { response?: unknown }).response).toBeUndefined();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 409 that is not a stale offer, and drops the envelope it sent', async () => {
    const conflict = refusal(409, 'Connection was modified by another user');
    const requestOffer = vi.fn().mockResolvedValue(offered);
    const save = vi.fn().mockRejectedValue(conflict);
    await expect(
      saveSealed({ body, secrets, requestOffer, save })
    ).rejects.toBe(conflict);
    expect(requestOffer).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(conflict.config).not.toHaveProperty('data');
  });
});

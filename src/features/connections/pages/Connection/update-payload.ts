import type { FormDefinition } from '@/shared/forms';
import type { UpdateConnectionInput } from '@/features/connections/queries';
import {
  buildConnectionParameterPatch,
  type EditProjection,
} from '@/features/connections/components/Forms/DynamicConnectionForm/adapter';
import {
  enterPatchSecrets,
  type EnteredSecrets,
} from '@/features/connections/sealing/enter-secrets';

/**
 * The update a save of the edit form sends, and the secrets it enters. Each
 * of those holds a marker in the patch where its value was: the values are
 * sealed as the update is saved (`updateConnection`), never sent readable.
 */
export function buildConnectionUpdateInput({
  id,
  integrationId,
  sealedFields,
  data,
  dirtyFieldNames,
  clearSecrets,
  definition,
  projection,
}: {
  id: string;
  integrationId: string | null | undefined;
  /** The connection type's `sealedFields`: what is sent sealed. */
  sealedFields: readonly string[];
  data: Record<string, unknown>;
  dirtyFieldNames: readonly string[];
  clearSecrets: readonly string[];
  definition: FormDefinition;
  projection: EditProjection;
}): { update: UpdateConnectionInput; secrets: EnteredSecrets } {
  if (!projection.version) {
    throw new Error('Connection edit version is unavailable');
  }
  const {
    title,
    rateLimitEnabled,
    requestsPerSecond,
    burstSize,
    maxRetries,
    maxWaitMs,
    retryOnLimit,
    isDefaultFileStorage,
    defaultFor,
    ...parameters
  } = data;
  const dirtyFields = new Set(dirtyFieldNames);
  const parameterDirtyFields = new Set(
    dirtyFieldNames.filter((name) => name in definition.fields)
  );
  const {
    patch: { set, write, clear },
    secrets,
  } = enterPatchSecrets(
    integrationId,
    sealedFields,
    buildConnectionParameterPatch(
      definition,
      parameters,
      parameterDirtyFields,
      clearSecrets
    )
  );
  const parameterPatch =
    Object.keys(set).length > 0 ||
    Object.keys(write).length > 0 ||
    clear.length > 0
      ? { set, write, clear }
      : undefined;
  const rateLimitChanged = [
    'rateLimitEnabled',
    'requestsPerSecond',
    'burstSize',
    'maxRetries',
    'maxWaitMs',
    'retryOnLimit',
  ].some((name) => dirtyFields.has(name));
  const rateLimitConfig = rateLimitChanged
    ? rateLimitEnabled
      ? {
          requestsPerSecond: Number(requestsPerSecond),
          burstSize: Number(burstSize),
          maxRetries: Number(maxRetries),
          maxWaitMs: Number(maxWaitMs),
          retryOnLimit: Boolean(retryOnLimit),
        }
      : null
    : undefined;

  const update: UpdateConnectionInput = {
    id,
    version: projection.version,
    title: dirtyFields.has('title') ? (title as string | undefined) : undefined,
    parameterPatch,
    rateLimitConfig,
    isDefaultFileStorage:
      dirtyFields.has('isDefaultFileStorage') &&
      isDefaultFileStorage !== undefined
        ? Boolean(isDefaultFileStorage)
        : undefined,
    defaultFor: dirtyFields.has('defaultFor')
      ? Array.isArray(defaultFor)
        ? (defaultFor as string[])
        : []
      : undefined,
  };
  return { update, secrets };
}

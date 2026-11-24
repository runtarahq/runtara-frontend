import * as RuntimeAPI from '@/generated/RuntaraRuntimeApi.ts';
import { RuntimeREST } from '@/shared/queries';
import { createAuthHeaders } from '@/shared/queries/utils';
import type { EnteredSecrets } from '../sealing/enter-secrets';
import { saveSealed } from '../sealing/sealed-save';

export async function getConnections(token: string) {
  try {
    // Fetch connections and connection types from Runtime API
    const [connectionsResult, connectionTypesResult] = await Promise.all([
      RuntimeREST.api.listConnectionsHandler(
        { includeRateLimitStats: true },
        createAuthHeaders(token)
      ),
      RuntimeREST.api.listConnectionTypesHandler(createAuthHeaders(token)),
    ]);

    const connections = connectionsResult.data.connections || [];
    const connectionTypes = connectionTypesResult.data.connectionTypes || [];

    // Create a map for quick lookup
    const connectionTypesMap = new Map(
      connectionTypes.map((ct) => [ct.integrationId, ct])
    );

    // Merge connection type data into connections
    const enrichedConnections = connections.map((connection) => {
      const connectionType = connection.integrationId
        ? connectionTypesMap.get(connection.integrationId) || null
        : null;
      return {
        ...connection,
        connectionType,
      };
    });

    return enrichedConnections;
  } catch (error) {
    console.error('Error fetching connections:', error);
    throw error;
  }
}

export async function getConnectionById(token: string, id: string) {
  try {
    const result = await RuntimeREST.api.getConnectionHandler(
      id,
      createAuthHeaders(token)
    );

    const connection = result.data.connection;

    // Fetch connection type data to enrich the connection
    if (connection?.integrationId) {
      try {
        const connectionTypesResult =
          await RuntimeREST.api.listConnectionTypesHandler(
            createAuthHeaders(token)
          );

        const connectionTypes =
          connectionTypesResult.data.connectionTypes || [];

        const connectionType = connectionTypes.find(
          (ct) => ct.integrationId === connection.integrationId
        );

        return {
          ...connection,
          connectionType: connectionType || null,
        };
      } catch (error) {
        console.error(
          '[getConnectionById] Error fetching connection type data:',
          error
        );
        return { ...connection, connectionType: null };
      }
    }

    return { ...connection, connectionType: null };
  } catch (error) {
    console.error('[getConnectionById] Error fetching connection:', error);
    throw error;
  }
}

export async function getConnectionsByOperator(
  token: string,
  operatorName: string
) {
  // Use the dedicated endpoint that filters connections by operator
  const result = await RuntimeREST.api.getConnectionsByOperatorHandler(
    operatorName,
    undefined,
    createAuthHeaders(token)
  );

  return result.data.connections || [];
}

/** What to seal a new connection's secrets under: asked with the request
 *  that will create it, a marker in place of each secret. */
export async function offerForCreate(
  token: string,
  request: RuntimeAPI.CreateConnectionRequest
): Promise<RuntimeAPI.ConnectionOfferResponse> {
  const result = await RuntimeREST.api.offerForCreateHandler(
    request,
    createAuthHeaders(token)
  );
  return result.data;
}

/** What to seal the secrets an update enters under: asked with the request
 *  that will update the connection. */
export async function offerForUpdate(
  token: string,
  id: string,
  request: RuntimeAPI.UpdateConnectionRequest
): Promise<RuntimeAPI.ConnectionOfferResponse> {
  const result = await RuntimeREST.api.offerForUpdateHandler(
    id,
    request,
    createAuthHeaders(token)
  );
  return result.data;
}

/**
 * Creates a connection. `connection` holds a marker in place of each secret
 * (`enterSecrets`), and `secrets` their values: sealed here, under an offer
 * made for this request, and never sent readable.
 */
export async function createConnection(
  token: string,
  connection: RuntimeAPI.CreateConnectionRequest,
  secrets: EnteredSecrets = {}
): Promise<string> {
  return saveSealed({
    body: connection,
    secrets,
    requestOffer: (body) => offerForCreate(token, body),
    save: async (body, sealed) => {
      const result = await RuntimeREST.api.createConnectionHandler(
        sealed
          ? {
              ...body,
              connectionId: sealed.connectionId,
              sealedSecrets: sealed.envelope,
            }
          : body,
        createAuthHeaders(token)
      );
      return result.data.connectionId;
    },
  });
}

export interface UpdateConnectionInput {
  id: string;
  version: string;
  title?: string;
  parameterPatch?: {
    set: Record<string, unknown>;
    write: Record<string, unknown>;
    clear: string[];
  };
  rateLimitConfig?: RuntimeAPI.RateLimitConfigDto | null;
  isDefaultFileStorage?: boolean;
  defaultFor?: string[];
}

/**
 * Updates a connection. A secret the update enters holds a marker in the
 * patch (`enterPatchSecrets`), and `secrets` has its value: sealed here, under
 * an offer made for this request, and never sent readable.
 */
export async function updateConnection(
  token: string,
  connection: UpdateConnectionInput,
  secrets: EnteredSecrets = {}
) {
  const {
    id,
    version,
    title,
    parameterPatch,
    rateLimitConfig,
    isDefaultFileStorage,
    defaultFor,
  } = connection;

  const requestBody: RuntimeAPI.UpdateConnectionRequest = {
    version,
    title,
    connectionParameterPatch: parameterPatch,
    rateLimitConfig,
    isDefaultFileStorage,
    defaultFor,
  };

  await saveSealed({
    body: requestBody,
    secrets,
    requestOffer: (body) => offerForUpdate(token, id, body),
    save: (body, sealed) =>
      RuntimeREST.api.updateConnectionHandler(
        id,
        sealed ? { ...body, sealedSecrets: sealed.envelope } : body,
        createAuthHeaders(token)
      ),
  });
}

export async function removeConnection(token: string, connectionId: string) {
  await RuntimeREST.api.deleteConnectionHandler(
    connectionId,
    createAuthHeaders(token)
  );
}

export async function getOAuthAuthorizeUrl(
  token: string | null | undefined,
  connectionId: string
): Promise<string> {
  // Use the shared header builder: it omits Authorization when there is no
  // token (local / trust_proxy auth modes), matching every other runtime call.
  // With credentials: the answer sets the flow's cookie, which binds it to
  // this browser and must come back with the provider's redirect to the API's
  // host, wherever the console is served from.
  const result = await RuntimeREST.instance.get(
    `/api/runtime/connections/${connectionId}/oauth/authorize`,
    { ...createAuthHeaders(token), withCredentials: true }
  );
  return result.data.authorizationUrl;
}

/** An authorization a flow started without a browser obtained, waiting for a
 *  member to confirm it. No secrets. */
export interface PendingConfirmation {
  id: string;
  account?: { id?: string; display?: string } | null;
  startedBy: string;
  authorizedAt?: string | null;
  pendingUntil: string;
}

export async function getPendingConfirmation(
  token: string | null | undefined,
  connectionId: string
): Promise<PendingConfirmation | null> {
  const result = await RuntimeREST.instance.get(
    `/api/runtime/connections/${connectionId}/oauth/pending`,
    createAuthHeaders(token)
  );
  return (result.data?.pending as PendingConfirmation | null) ?? null;
}

/** Confirm (or reject) the pending authorization `pendingId`: the one the
 *  member reviewed. A later one that replaced it is refused (409). */
export async function decidePendingConfirmation(
  token: string | null | undefined,
  connectionId: string,
  pendingId: string,
  decision: 'confirm' | 'reject'
): Promise<void> {
  await RuntimeREST.instance.post(
    `/api/runtime/connections/${connectionId}/oauth/${decision}`,
    { pendingId },
    createAuthHeaders(token)
  );
}

export async function getConnectionTypes(token: string) {
  const result = await RuntimeREST.api.listConnectionTypesHandler(
    createAuthHeaders(token)
  );

  return result.data.connectionTypes || [];
}

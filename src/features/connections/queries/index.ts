import * as RuntimeAPI from '@/generated/RuntaraRuntimeApi.ts';
import { RuntimeREST } from '@/shared/queries';

export async function getConnections() {
  try {
    // Fetch connections and connection types from Runtime API
    const [connectionsResult, connectionTypesResult] = await Promise.all([
      RuntimeREST.api.listConnectionsHandler({ includeRateLimitStats: true }),
      RuntimeREST.api.listConnectionTypesHandler(),
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

export async function getConnectionById(id: string) {
  try {
    const result = await RuntimeREST.api.getConnectionHandler(id);

    const connection = result.data.connection;

    // Fetch connection type data to enrich the connection
    if (connection?.integrationId) {
      try {
        const connectionTypesResult =
          await RuntimeREST.api.listConnectionTypesHandler();

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

export async function getConnectionsByOperator(operatorName: string) {
  // Use the dedicated endpoint that filters connections by operator
  const result = await RuntimeREST.api.getConnectionsByOperatorHandler(
    operatorName,
    undefined
  );

  return result.data.connections || [];
}

export async function createConnection(
  connection: RuntimeAPI.CreateConnectionRequest
): Promise<string> {
  const result = await RuntimeREST.api.createConnectionHandler(connection);
  return result.data.connectionId;
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

export async function updateConnection(connection: UpdateConnectionInput) {
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

  await RuntimeREST.api.updateConnectionHandler(id, requestBody);
}

export async function removeConnection(connectionId: string) {
  await RuntimeREST.api.deleteConnectionHandler(connectionId);
}

export async function getOAuthAuthorizeUrl(
  connectionId: string
): Promise<string> {
  // With credentials: the answer sets the flow's cookie, which binds it to
  // this browser and must come back with the provider's redirect to the API's
  // host, wherever the console is served from.
  const result = await RuntimeREST.api.authorizeHandler(connectionId, {
    withCredentials: true,
  });
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
  connectionId: string
): Promise<PendingConfirmation | null> {
  // Through the client's HTTP instance, as the two calls below: the pinned
  // release's schema does not have the pending-confirmation routes yet.
  const result = await RuntimeREST.instance.get<{
    pending?: PendingConfirmation | null;
  }>(`/api/runtime/connections/${connectionId}/oauth/pending`);
  return result.data?.pending ?? null;
}

/** Confirm (or reject) the pending authorization `pendingId`: the one the
 *  member reviewed. A later one that replaced it is refused (409). */
export async function decidePendingConfirmation(
  connectionId: string,
  pendingId: string,
  decision: 'confirm' | 'reject'
): Promise<void> {
  await RuntimeREST.instance.post<void>(
    `/api/runtime/connections/${connectionId}/oauth/${decision}`,
    { pendingId }
  );
}

export async function getConnectionTypes() {
  const result = await RuntimeREST.api.listConnectionTypesHandler();

  return result.data.connectionTypes || [];
}

/** A value a step may take from a connection (a model, say), with its label. */
export interface ConnectionResourceOption {
  value: string;
  label: string;
}

/**
 * The values of `resourceName` that a connection offers (the models of an AI
 * provider, say). Values that are not strings are left out: a step field
 * holds a string.
 */
export async function getConnectionResourceOptions(
  connectionId: string,
  resourceName: string
): Promise<ConnectionResourceOption[]> {
  const result = await RuntimeREST.api.resolveConnectionResourceHandler(
    connectionId,
    { resourceName }
  );
  return (result.data.items ?? [])
    .filter((item) => typeof item.value === 'string')
    .map((item) => ({ value: item.value as string, label: item.label }));
}

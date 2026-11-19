import { RuntimeREST } from '@/shared/queries';
import { CreateApiKeyRequest } from '@/generated/RuntaraRuntimeApi';

export async function listApiKeys() {
  const result = await RuntimeREST.api.listApiKeys();
  return result.data;
}

export async function createApiKey(data: CreateApiKeyRequest) {
  const result = await RuntimeREST.api.createApiKey(data);
  return result.data;
}

export async function revokeApiKey(id: string) {
  const result = await RuntimeREST.api.revokeApiKey(id);
  return result.data;
}

import initRustValidation, {
  agentCatalogLoaded,
  analyzeFormJson,
  getAgentJson,
  getAgentsJson,
  getStepTypeSchemaJson,
  getStepTypesJson,
  initAgentCatalog,
  normalizeSchemaFieldsFormJson,
  validateExecutionGraphJson,
  validateSchemaFieldsJson,
  validateWorkflowStartInputsJson,
} from 'runtara-validation-wasm';
import rustValidationWasmUrl from 'runtara-validation-wasm/runtara_validation_bg.wasm?url';
import { runtimeFetch } from '@/shared/queries/runtime-fetch';

export {
  analyzeFormJson,
  getAgentJson,
  getAgentsJson,
  getStepTypeSchemaJson,
  getStepTypesJson,
  normalizeSchemaFieldsFormJson,
  validateExecutionGraphJson,
  validateSchemaFieldsJson,
  validateWorkflowStartInputsJson,
};

let initPromise: Promise<unknown> | null = null;
let agentCatalogPromise: Promise<void> | null = null;

async function loadAgentCatalogIntoWasm(): Promise<void> {
  if (agentCatalogLoaded()) {
    return;
  }
  const headers = { accept: 'application/json' };
  const response = await runtimeFetch('/agents', {
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    throw new Error(
      `/agents returned HTTP ${response.status} ${response.statusText}`
    );
  }
  const body = (await response.json()) as { agents?: unknown };
  const summaries = Array.isArray(body?.agents) ? body.agents : [];
  const agents = await Promise.all(
    summaries.map(async (summary) => {
      const id =
        summary && typeof summary === 'object' && 'id' in summary
          ? (summary as { id?: unknown }).id
          : undefined;
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error('Agent catalog summary is missing a valid id');
      }
      const detailPath = `/agents/${encodeURIComponent(id)}`;
      const detailResponse = await runtimeFetch(detailPath, {
        credentials: 'include',
        headers,
      });
      if (!detailResponse.ok) {
        throw new Error(
          `${detailPath} returned HTTP ${detailResponse.status} ${detailResponse.statusText}`
        );
      }
      return detailResponse.json();
    })
  );
  const result = JSON.parse(initAgentCatalog(JSON.stringify(agents))) as {
    success?: boolean;
    error?: string;
  };
  if (!result.success) {
    throw new Error(
      `Validator rejected agent catalog payload: ${result.error ?? 'unknown error'}`
    );
  }
}

/** Initialize the domain-neutral Rust validation bundle. */
export function ensureRustValidationInitialized(): Promise<unknown> {
  initPromise ??= initRustValidation({
    module_or_path: rustValidationWasmUrl,
  }).catch((error) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

/**
 * Starts loading the validator ahead of its first use, where one is likely:
 * the workflow editor and the schema-driven forms call this when they mount.
 * It is 4 MB, so the app does not fetch it at start for pages that never
 * validate. A failed preload is only logged; the first real use tries again
 * and reports for itself.
 */
export function preloadRustValidation(): void {
  ensureRustValidationInitialized().catch((error) => {
    console.warn('[validation] WASM preload failed', error);
  });
}

/** Initialize workflow metadata after the shared validator is available. */
export async function ensureWorkflowValidationInitialized(): Promise<void> {
  await ensureRustValidationInitialized();
  agentCatalogPromise ??= loadAgentCatalogIntoWasm().catch((error) => {
    agentCatalogPromise = null;
    throw error;
  });
  return agentCatalogPromise;
}

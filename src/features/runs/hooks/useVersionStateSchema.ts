import { useCustomQuery } from '@/shared/hooks/api';
import { RuntimeREST } from '@/shared/queries';
import { queryKeys } from '@/shared/queries/query-keys';
import type { StateField } from '@/features/runs/components/StateValue';

/** The state schema of a workflow version: field labels, formats and order. */
export function useVersionStateSchema(workflowId: string, version: number) {
  const { data, error } = useCustomQuery({
    queryKey: queryKeys.workflows.schemas(workflowId, version),
    queryFn: async () =>
      (await RuntimeREST.api.getVersionSchemasHandler(workflowId, version))
        .data,
    enabled: Boolean(workflowId) && version > 0,
    placeholderData: undefined,
  });
  return {
    schema: (data?.stateSchema ?? {}) as Record<string, StateField>,
    error,
  };
}

import type {
  ExecutionGraphDto,
  ExecutionGraphStepDto,
} from '@/features/workflows/types/execution-graph';

export type ExecutionGraphStep = ExecutionGraphStepDto;

/**
 * The graph `composeExecutionGraph` returns: the DSL's, with an entry point,
 * and its steps as the DSL defines them (`DslStep`).
 */
export type ExecutionGraph = ExecutionGraphDto & {
  steps?: Record<string, ExecutionGraphStep>;
  entryPoint: string;
};

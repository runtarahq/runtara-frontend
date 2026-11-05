import type {
  ExecutionGraphStepDto,
  ExecutionGraphTransitionDto,
} from '@/features/workflows/types/execution-graph';
import type { Note } from '@/generated/RuntaraRuntimeApi';

export type ExecutionGraphTransition = Required<ExecutionGraphTransitionDto>;

export type ExecutionGraphStep = ExecutionGraphStepDto &
  Required<
    Pick<
      ExecutionGraphStepDto,
      'id' | 'inputMapping' | 'name' | 'stepType' | 'renderingParameters'
    >
  > & { subgraph?: ExecutionGraph };

export interface ExecutionGraph {
  steps?: Record<string, ExecutionGraphStep>;
  executionPlan?: ExecutionGraphTransition[];
  entryPoint: string;
  notes?: Note[];
  // Static variables defined at workflow version level
  variables?: Record<string, any>;
}

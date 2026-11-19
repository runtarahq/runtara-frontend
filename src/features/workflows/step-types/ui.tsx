import type { ComponentType } from 'react';
import { Icons } from '@/shared/components/icons';
import type { StepType } from '../types/execution-graph';
import { AiAgentStepField } from '../components/WorkflowEditor/NodeForm/AiAgentStepField';
import { DelayStepField } from '../components/WorkflowEditor/NodeForm/DelayStepField';
import { ErrorStepField } from '../components/WorkflowEditor/NodeForm/ErrorStepField';
import { FilterStepField } from '../components/WorkflowEditor/NodeForm/FilterStepField';
import { FinishStepField } from '../components/WorkflowEditor/NodeForm/FinishStepField';
import { GetStateStepField } from '../components/WorkflowEditor/NodeForm/GetStateStepField';
import { GroupByStepField } from '../components/WorkflowEditor/NodeForm/GroupByStepField';
import { LogStepField } from '../components/WorkflowEditor/NodeForm/LogStepField';
import { SetStateStepField } from '../components/WorkflowEditor/NodeForm/SetStateStepField';
import { SplitStepField } from '../components/WorkflowEditor/NodeForm/SplitStepField';
import { WaitForInstancesStepField } from '../components/WorkflowEditor/NodeForm/WaitForInstancesStepField';
import { WaitForSignalStepField } from '../components/WorkflowEditor/NodeForm/WaitForSignalStepField';
import { WhileStepField } from '../components/WorkflowEditor/NodeForm/WhileStepField';

/** What a step type's own form takes: the form field it edits. */
export type StepFormFieldProps = { name: string } & Record<string, unknown>;

/**
 * The components of a step type: the other half of `./catalog.ts`, kept apart
 * so that code with no React in it (the DSL converters, the store) can read
 * the catalog without loading the forms.
 */
export interface StepTypeUi {
  /** Its icon, in the step picker and on its card. */
  Icon: ComponentType<{ className?: string }>;
  /**
   * The form of its main tab. `null` for a step configured by its input
   * mapping alone, which gets the generic mapping editor.
   */
  FormField: ComponentType<StepFormFieldProps> | null;
}

export const STEP_TYPE_UI: { [T in StepType]: StepTypeUi } = {
  Finish: { Icon: Icons.finish, FormField: FinishStepField },
  Agent: { Icon: Icons.agent, FormField: null },
  Conditional: { Icon: Icons.split, FormField: null },
  Split: { Icon: Icons.asterisk, FormField: SplitStepField },
  Switch: { Icon: Icons.squareMenu, FormField: null },
  EmbedWorkflow: { Icon: Icons.rocket, FormField: null },
  While: { Icon: Icons.gear, FormField: WhileStepField },
  Log: { Icon: Icons.gear, FormField: LogStepField },
  Error: { Icon: Icons.warning, FormField: ErrorStepField },
  Filter: { Icon: Icons.filter, FormField: FilterStepField },
  GroupBy: { Icon: Icons.groupby, FormField: GroupByStepField },
  Delay: { Icon: Icons.wait, FormField: DelayStepField },
  WaitForSignal: { Icon: Icons.wait, FormField: WaitForSignalStepField },
  WaitForInstances: {
    Icon: Icons.merge,
    FormField: WaitForInstancesStepField,
  },
  SetState: { Icon: Icons.edit, FormField: SetStateStepField },
  GetState: { Icon: Icons.eye, FormField: GetStateStepField },
  AiAgent: { Icon: Icons.sparkles, FormField: AiAgentStepField },
};

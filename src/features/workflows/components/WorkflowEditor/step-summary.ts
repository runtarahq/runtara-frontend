import {
  stepTypeTraits,
  stepTakesAgent,
} from '@/features/workflows/step-types/catalog';
import { humanizeKey } from './step-details';

/** One-line step summaries for the canvas cards. */
export interface StepSummaryData {
  stepType?: string;
  agentId?: string;
  capabilityId?: string;
  description?: string;
}

/**
 * What a step does, in one line: its description, or a summary by type.
 * Agent steps read "Object Model · Update instance": the agent's and the
 * capability's display names when known, humanized ids otherwise.
 */
export function stepDescription(
  data: StepSummaryData,
  agentName?: string,
  capabilityName?: string
): string | undefined {
  if (data.description) return data.description;
  if (stepTakesAgent(data.stepType)) {
    const agent =
      agentName || (data.agentId ? humanizeKey(data.agentId) : 'Agent');
    const capability =
      capabilityName ||
      (data.capabilityId ? humanizeKey(data.capabilityId) : '');
    return capability ? `${agent} · ${capability}` : agent;
  }
  // What the step type does, when the catalog says (step-types/catalog.ts).
  return stepTypeTraits(data.stepType)?.summary;
}

/** `WaitForSignal` → "Wait for signal", `AiAgent` → "AI agent". */
export function stepTypeLabel(stepType: string): string {
  return stepTypeTraits(stepType)?.label ?? humanizeKey(stepType);
}

export function stepBadgeVariant(stepType: string) {
  return stepTypeTraits(stepType)?.badge ?? ('muted' as const);
}

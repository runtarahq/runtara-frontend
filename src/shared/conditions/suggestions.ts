/**
 * Autocomplete suggestion for condition references. Structurally compatible
 * with the canonical VariableSuggestion from
 * features/workflows .../InputMappingValueField/VariableSuggestions — the
 * editor no longer composes suggestions itself (its old forked composer
 * carried hardcoded guessed item.* field names not driven by any schema);
 * call sites compose via composeConditionSuggestions and pass them in.
 */
export interface ConditionSuggestion {
  label: string;
  value: string;
  description?: string;
  group: string;
  type?: string;
  stepName?: string; // Step name for display
  stepId?: string; // Step ID for reference
}

export type VariableSuggestion = ConditionSuggestion;

export function filterSuggestions(
  suggestions: VariableSuggestion[],
  query: string
): VariableSuggestion[] {
  if (!query) {
    return suggestions;
  }
  const lowerQuery = query.toLowerCase();
  return suggestions.filter((suggestion) => {
    const lowerLabel = suggestion.label.toLowerCase();
    const lowerDescription = suggestion.description?.toLowerCase() || '';
    return (
      lowerLabel.includes(lowerQuery) || lowerDescription.includes(lowerQuery)
    );
  });
}

/** Preferred display order; unknown groups append in insertion order. */
export const GROUP_ORDER = [
  'Current Item',
  'Loop Context',
  'Split Scope',
  'Wait Scope',
  'Workflow Inputs',
  'Variables',
  'Step Outputs',
];

export function groupSuggestions(
  suggestions: VariableSuggestion[]
): Map<string, VariableSuggestion[]> {
  const grouped = new Map<string, VariableSuggestion[]>();
  for (const group of GROUP_ORDER) {
    grouped.set(group, []);
  }
  for (const suggestion of suggestions) {
    const bucket = grouped.get(suggestion.group);
    if (bucket) {
      bucket.push(suggestion);
    } else {
      grouped.set(suggestion.group, [suggestion]);
    }
  }
  return grouped;
}

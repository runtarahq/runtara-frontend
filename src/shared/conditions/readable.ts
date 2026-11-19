import { Condition, ConditionArgument } from './types';
import { isConditionArgument } from './arguments';
import { VariableSuggestion } from './suggestions';

// Helper to format reference value for display
// Converts "steps['uuid'].outputs.field" to "StepName → field"
export const formatReferenceForDisplay = (
  value: string,
  suggestions: VariableSuggestion[]
): string => {
  // A suggestion the user could have picked carries the friendly parts.
  const suggestion = suggestions.find((s) => s.value === value);
  if (suggestion) {
    return suggestion.stepName
      ? `${suggestion.stepName} → ${suggestion.label}`
      : suggestion.label;
  }
  // Fallback for hand-typed paths: steps['id'].outputs.field and sibling
  // fields directly under steps['id'] (e.g. hasFailures, route).
  const stepMatch = value.match(/steps\['([^']+)'\]\.?(.*)$/);
  if (stepMatch) {
    const stepId = stepMatch[1];
    let fieldPath = stepMatch[2] || 'outputs';
    if (fieldPath.startsWith('outputs.')) {
      fieldPath = fieldPath.slice('outputs.'.length);
    }
    const stepName =
      suggestions.find((s) => s.stepId === stepId)?.stepName ||
      `Step ${stepId.slice(0, 8)}...`;
    return `${stepName} → ${fieldPath}`;
  }
  // For workflow inputs, just return the value as-is
  return value;
};

export const renderConditionReadable = (condition?: Condition): string => {
  // Handle undefined condition
  if (!condition) {
    return '';
  }

  const { op, arguments: args } = condition;

  const renderArg = (arg: string | Condition | ConditionArgument): string => {
    if (typeof arg === 'string') {
      return arg;
    }

    // Handle ConditionArgument with valueType
    if (isConditionArgument(arg)) {
      return arg.value;
    }

    // Handle condition with undefined op
    if (!arg.op) {
      return '';
    }

    return `(${renderConditionReadable(arg)})`;
  };

  switch (op) {
    case 'AND':
      return args?.map(renderArg)?.join(' AND ') || '';
    case 'OR':
      return args?.map(renderArg)?.join(' OR ') || '';
    case 'NOT':
      return args && args[0] ? `NOT ${renderArg(args[0])}` : 'NOT';
    case 'EQ':
      return `${args && args[0] ? renderArg(args[0]) : ''} = ${args && args[1] ? renderArg(args[1]) : ''}`;
    case 'NE':
      return `${args && args[0] ? renderArg(args[0]) : ''} != ${args && args[1] ? renderArg(args[1]) : ''}`;
    case 'GT':
      return `${args && args[0] ? renderArg(args[0]) : ''} > ${args && args[1] ? renderArg(args[1]) : ''}`;
    case 'GTE':
      return `${args && args[0] ? renderArg(args[0]) : ''} >= ${args && args[1] ? renderArg(args[1]) : ''}`;
    case 'LT':
      return `${args && args[0] ? renderArg(args[0]) : ''} < ${args && args[1] ? renderArg(args[1]) : ''}`;
    case 'LTE':
      return `${args && args[0] ? renderArg(args[0]) : ''} <= ${args && args[1] ? renderArg(args[1]) : ''}`;
    case 'IN':
      return `${args && args[0] ? renderArg(args[0]) : ''} IN ${args && args[1] ? renderArg(args[1]) : ''}`;
    case 'NOT_IN':
      return `${args && args[0] ? renderArg(args[0]) : ''} NOT IN ${args && args[1] ? renderArg(args[1]) : ''}`;
    case 'STARTS_WITH':
      return `${args && args[0] ? renderArg(args[0]) : ''} STARTS WITH ${args && args[1] ? renderArg(args[1]) : ''}`;
    case 'ENDS_WITH':
      return `${args && args[0] ? renderArg(args[0]) : ''} ENDS WITH ${args && args[1] ? renderArg(args[1]) : ''}`;
    case 'CONTAINS':
      return `${args && args[0] ? renderArg(args[0]) : ''} CONTAINS ${args && args[1] ? renderArg(args[1]) : ''}`;
    case 'IS_EMPTY':
      return `${args && args[0] ? renderArg(args[0]) : ''} IS EMPTY`;
    case 'IS_NOT_EMPTY':
      return `${args && args[0] ? renderArg(args[0]) : ''} IS NOT EMPTY`;
    case 'IS_DEFINED':
      return `${args && args[0] ? renderArg(args[0]) : ''} IS DEFINED`;
    case 'LENGTH':
      return `LENGTH(${args && args[0] ? renderArg(args[0]) : ''})`;
    default:
      // Handle undefined op
      if (!op) {
        return '';
      }
      return `${op}(${args?.map(renderArg)?.join(', ') || ''})`;
  }
};

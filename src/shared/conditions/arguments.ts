import {
  Condition,
  ImmediateValueType,
  ConditionArgument,
  ArgumentValueType,
} from './types';

// Get color class based on argument value type
export const getArgumentValueTypeColor = (type: ArgumentValueType): string => {
  switch (type) {
    case 'reference':
      return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300';
    case 'immediate':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300';
    case 'operation':
      return 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

// Get icon/symbol representation
export const getArgumentValueTypeSymbol = (type: ArgumentValueType): string => {
  switch (type) {
    case 'reference':
      return '{}';
    case 'immediate':
      return '=';
    case 'operation':
      return '</>';
    default:
      return '?';
  }
};

// Helper to check if an argument is a ConditionArgument with valueType
export const isConditionArgument = (arg: any): arg is ConditionArgument => {
  return (
    typeof arg === 'object' &&
    arg !== null &&
    'valueType' in arg &&
    'value' in arg &&
    !('op' in arg)
  );
};

// Helper to get the display value from an argument. Stored definitions carry
// typed JSON immediates (boolean, number, array) — render them as text.
export const getArgumentDisplayValue = (
  arg: Condition | string | ConditionArgument
): string => {
  if (typeof arg === 'string') return arg;
  if (isConditionArgument(arg)) {
    const value = arg.value as unknown;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.join(', ');
    if (value === null || value === undefined) return '';
    return String(value);
  }
  return ''; // For Condition, handled separately
};

// Helper to get the immediate type from an argument
export const getArgumentImmediateType = (
  arg: Condition | string | ConditionArgument
): ImmediateValueType => {
  if (isConditionArgument(arg) && arg.immediateType) {
    return arg.immediateType;
  }
  // Try to infer type from value
  if (typeof arg === 'string' || isConditionArgument(arg)) {
    const value = typeof arg === 'string' ? arg : (arg.value as unknown);
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (value === 'true' || value === 'false') return 'boolean';
    if (typeof value === 'string' && value !== '' && !isNaN(Number(value))) {
      return 'number';
    }
  }
  return 'string';
};

// Helper to get the value type from an argument
export const getArgumentValueType = (
  arg: Condition | string | ConditionArgument
): ArgumentValueType => {
  if (typeof arg === 'object' && arg !== null && 'op' in arg)
    return 'operation';
  if (isConditionArgument(arg)) return arg.valueType;
  return 'immediate'; // Default for plain strings
};

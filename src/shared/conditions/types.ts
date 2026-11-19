// --- TYPES & CONSTANTS ---
export type Arity = 'UNARY' | 'BINARY' | 'VARIADIC';

export interface Operator {
  key: string;
  label: string;
  arity: Arity;
}

export const OPERATORS: Operator[] = [
  { key: 'AND', label: 'Logical AND', arity: 'VARIADIC' },
  { key: 'OR', label: 'Logical OR', arity: 'VARIADIC' },
  { key: 'NOT', label: 'Logical NOT', arity: 'UNARY' },
  { key: 'EQ', label: 'Equals', arity: 'BINARY' },
  { key: 'NE', label: 'Not Equals', arity: 'BINARY' },
  { key: 'GT', label: 'Greater Than', arity: 'BINARY' },
  { key: 'GTE', label: 'Greater or Equal', arity: 'BINARY' },
  { key: 'LT', label: 'Less Than', arity: 'BINARY' },
  { key: 'LTE', label: 'Less or Equal', arity: 'BINARY' },
  { key: 'IN', label: 'In List', arity: 'BINARY' },
  { key: 'NOT_IN', label: 'Not In List', arity: 'BINARY' },
  { key: 'STARTS_WITH', label: 'Starts With', arity: 'BINARY' },
  { key: 'ENDS_WITH', label: 'Ends With', arity: 'BINARY' },
  { key: 'CONTAINS', label: 'Contains', arity: 'BINARY' },
  { key: 'IS_EMPTY', label: 'Is Empty', arity: 'UNARY' },
  { key: 'IS_NOT_EMPTY', label: 'Is Not Empty', arity: 'UNARY' },
  { key: 'IS_DEFINED', label: 'Is Defined', arity: 'UNARY' },
  { key: 'LENGTH', label: 'Length', arity: 'UNARY' },
];

export interface Condition {
  type: 'operation';
  op: string;
  arguments: (Condition | string | ConditionArgument)[];
}

// Immediate value types for type selection
export type ImmediateValueType = 'string' | 'number' | 'boolean';

export const IMMEDIATE_TYPE_OPTIONS: {
  value: ImmediateValueType;
  label: string;
}[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
];

// Argument with value type metadata (for reference vs immediate values).
// `value` is typed JSON, not just string: stored definitions round-trip
// booleans, numbers, and arrays (IN/NOT_IN lists) verbatim.
export interface ConditionArgument {
  valueType: 'immediate' | 'reference';
  value: any;
  immediateType?: ImmediateValueType; // Type hint for immediate values
}

// Type for selecting argument value type (immediate, reference, or operation)
export type ArgumentValueType = 'immediate' | 'reference' | 'operation';

export interface ArgumentValueTypeOption {
  value: ArgumentValueType;
  label: string;
  description: string;
}

export const ARGUMENT_VALUE_TYPE_OPTIONS: ArgumentValueTypeOption[] = [
  {
    value: 'immediate',
    label: 'Immediate',
    description: 'Literal value (string, number, boolean)',
  },
  {
    value: 'reference',
    label: 'Reference',
    description: 'Reference to data path (e.g., steps.step1.outputs.result)',
  },
  {
    value: 'operation',
    label: 'Operation',
    description: 'Nested condition expression',
  },
];

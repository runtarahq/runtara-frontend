import { useState, useRef, useEffect } from 'react';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import { Trash2 } from 'lucide-react';
import { convertConditionArguments } from '@/shared/utils/condition-type-conversion';
import { carryConditionArgs, type ConditionArity } from './condition-args';
import {
  OPERATORS,
  Condition,
  ImmediateValueType,
  ConditionArgument,
  ArgumentValueType,
} from './types';
import {
  getArgumentDisplayValue,
  getArgumentImmediateType,
  getArgumentValueType,
} from './arguments';
import { ArgumentValueTypeSelector } from './ArgumentValueTypeSelector';
import { ConditionSuggestion, VariableSuggestion } from './suggestions';
import { ConditionVariablePickerModal } from './VariablePickerModal';
import { renderConditionReadable } from './readable';
import { ReferencePill, ImmediateValueInput } from './ArgumentInputs';

// --- BUILDER COMPONENT ---
export interface ConditionEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  /**
   * Reference suggestions for the picker — compose with
   * composeConditionSuggestions (features/workflows VariableSuggestions) so
   * every surface shares the one canonical, schema-driven pipeline.
   */
  suggestions?: ConditionSuggestion[];
}

export const ConditionEditor = ({
  value,
  onChange,
  disabled = false,
  suggestions = [],
}: ConditionEditorProps) => {
  // Parse condition value from string
  const parseConditionValue = (val?: string): Condition | undefined => {
    if (!val) return undefined;
    try {
      const parsed = JSON.parse(val);
      // Validate that the parsed object has the required properties
      if (
        parsed &&
        typeof parsed === 'object' &&
        'op' in parsed &&
        parsed.op !== undefined &&
        'arguments' in parsed
      ) {
        return parsed as Condition;
      } else {
        console.error('Invalid condition format:', parsed);
        return undefined;
      }
    } catch (e) {
      console.error('Failed to parse condition value:', e);
      return undefined;
    }
  };

  const [condition, setCondition] = useState<Condition | undefined>(
    parseConditionValue(value)
  );

  // Track the last value we synced from props to avoid unnecessary updates
  const lastSyncedValue = useRef<string | undefined>(value);

  // Update condition when value prop changes (e.g., when form data loads)
  // Only update if the string value actually changed
  // A value cleared to nothing clears the condition too; it used to keep the
  // old one on screen (ED-24). A value that fails to parse still leaves it.
  useEffect(() => {
    if (value !== lastSyncedValue.current) {
      const parsed = parseConditionValue(value);
      if (parsed || value === undefined || value === '') {
        lastSyncedValue.current = value;
        setCondition(parsed);
      }
    }
  }, [value]);

  const handleConditionChange = (newCondition: Condition) => {
    setCondition(newCondition);
    if (onChange) {
      const jsonValue = JSON.stringify(newCondition);
      // Update the ref so we don't re-parse this value when it comes back from parent
      lastSyncedValue.current = jsonValue;
      onChange(jsonValue);
    }
  };

  const readableExpression = condition
    ? renderConditionReadable(condition)
    : '';

  return (
    <div className="w-full">
      <ConditionBuilder
        value={condition}
        onChange={handleConditionChange}
        disabled={disabled}
        suggestions={suggestions}
      />
      {/* Expression preview */}
      {readableExpression && (
        <div className="mt-3 break-words rounded bg-muted px-2 py-1.5 font-mono text-2xs text-muted-foreground">
          {readableExpression}
        </div>
      )}
    </div>
  );
};

export const ConditionBuilder = ({
  value,
  onChange,
  disabled = false,
  suggestions = [],
  inlineControls,
}: {
  value?: Condition;
  onChange?: (condition: Condition) => void;
  disabled?: boolean;
  suggestions?: ConditionSuggestion[];
  inlineControls?: React.ReactNode;
}) => {
  const initialOp = value?.op || 'EQ';
  const initialArgs = value?.arguments || ['', ''];
  const [op, setOp] = useState<string>(initialOp);
  const [args, setArgs] =
    useState<(string | Condition | ConditionArgument)[]>(initialArgs);

  // State for variable picker modal - track which argument index is being edited
  const [pickerOpenForIndex, setPickerOpenForIndex] = useState<number | null>(
    null
  );

  // Track the last synced value to avoid unnecessary state updates
  const lastSyncedValueRef = useRef<string | null>(null);

  // Update state when value prop changes (e.g., when form data loads)
  // Use JSON comparison to only sync when actual content changes, not just object reference
  useEffect(() => {
    if (value) {
      const valueStr = JSON.stringify(value);
      // Only update if the value actually changed from what we last synced
      if (lastSyncedValueRef.current !== valueStr) {
        lastSyncedValueRef.current = valueStr;
        setOp(value.op);
        setArgs(value.arguments);
      }
    } else if (lastSyncedValueRef.current !== null) {
      // The synced value was cleared: clear with it (ED-24).
      lastSyncedValueRef.current = null;
      setOp('EQ');
      setArgs(['', '']);
    }
  }, [value]);

  // Find the operator or default to the first one if not found
  const operator = OPERATORS.find((o) => o.key === op) || OPERATORS[0];

  const updateArgs = (newArgs: (string | Condition | ConditionArgument)[]) => {
    setArgs(newArgs);
    if (onChange) {
      // Apply type conversion to arguments before passing to parent
      const convertedArgs = convertConditionArguments(op, newArgs);
      const newCondition: Condition = {
        type: 'operation',
        op,
        arguments: convertedArgs,
      };
      // Update the ref to prevent the useEffect from overwriting user changes
      lastSyncedValueRef.current = JSON.stringify(newCondition);
      onChange(newCondition);
    }
  };

  const handleArgChange = (
    index: number,
    value: string | Condition | ConditionArgument
  ) => {
    const newArgs = [...args];
    newArgs[index] = value;
    updateArgs(newArgs);
  };

  const handleArgValueChange = (index: number, newValue: string) => {
    const currentArg = args[index];
    const currentValueType = getArgumentValueType(currentArg);
    const currentImmediateType = getArgumentImmediateType(currentArg);

    // If it's a reference type, wrap the value in a ConditionArgument
    if (currentValueType === 'reference') {
      handleArgChange(index, { valueType: 'reference', value: newValue });
    } else {
      // For immediate, preserve the immediate type
      handleArgChange(index, {
        valueType: 'immediate',
        value: newValue,
        immediateType: currentImmediateType,
      });
    }
  };

  const handleImmediateTypeChange = (
    index: number,
    newImmediateType: ImmediateValueType
  ) => {
    const currentArg = args[index];
    const currentValue = getArgumentDisplayValue(currentArg);

    // Convert value if needed when changing type
    let convertedValue = currentValue;
    if (newImmediateType === 'boolean') {
      convertedValue =
        currentValue === 'true' || currentValue === '1' ? 'true' : 'false';
    } else if (newImmediateType === 'number') {
      const num = parseFloat(currentValue);
      convertedValue = isNaN(num) ? '' : String(num);
    }

    handleArgChange(index, {
      valueType: 'immediate',
      value: convertedValue,
      immediateType: newImmediateType,
    });
  };

  const handleValueTypeChange = (
    index: number,
    newValueType: ArgumentValueType
  ) => {
    const currentArg = args[index];
    const currentValue = getArgumentDisplayValue(currentArg);

    if (newValueType === 'operation') {
      // Convert to nested condition
      handleArgChange(index, {
        type: 'operation',
        op: 'EQ',
        arguments: ['', ''],
      });
    } else if (newValueType === 'reference') {
      // Convert to reference - open the picker modal
      setPickerOpenForIndex(index);
    } else {
      // Convert to immediate with default string type
      handleArgChange(index, {
        valueType: 'immediate',
        value: currentValue,
        immediateType: 'string',
      });
    }
  };

  const handleVariableSelect = (
    index: number,
    variable: VariableSuggestion
  ) => {
    handleArgChange(index, { valueType: 'reference', value: variable.value });
    setPickerOpenForIndex(null);
  };

  const handleRemoveReference = (index: number) => {
    // When removing reference, switch to immediate mode
    handleArgChange(index, {
      valueType: 'immediate',
      value: '',
      immediateType: 'string',
    });
  };

  const handleAddArgument = () => {
    updateArgs([
      ...args,
      { valueType: 'immediate', value: '', immediateType: 'string' },
    ]);
  };

  const handleRemoveArgument = (index: number) => {
    const newArgs = args.filter((_, i) => i !== index);
    updateArgs(newArgs);
  };

  const handleOperatorChange = (value: string) => {
    const newOp = value;
    // Find the operator or default to the first one if not found
    const newOperator = OPERATORS.find((o) => o.key === newOp) || OPERATORS[0];
    const newArity = newOperator.arity;
    // Carry the operands across. Changing the operator says something about
    // the comparison, never about the values being compared — rebuilding the
    // list from arity alone wiped both sides of EQ->NE and discarded every
    // nested condition on AND->OR.
    const newArgs: (string | Condition | ConditionArgument)[] =
      carryConditionArgs(args, newArity as ConditionArity);
    setOp(newOp);
    setArgs(newArgs);
    if (onChange) {
      const convertedArgs = convertConditionArguments(newOp, newArgs);
      const newCondition: Condition = {
        type: 'operation',
        op: newOp,
        arguments: convertedArgs,
      };
      // Update the ref to prevent the useEffect from overwriting user changes
      lastSyncedValueRef.current = JSON.stringify(newCondition);
      onChange(newCondition);
    }
  };

  const isCondition = (
    val: string | Condition | ConditionArgument
  ): val is Condition => {
    return (
      typeof val === 'object' &&
      val !== null &&
      'op' in val &&
      val.op !== undefined
    );
  };

  // Check if this is a variadic operator (can add/remove arguments)
  const isVariadicOperator = operator.arity === 'VARIADIC';

  // Handler to convert an operation argument back to immediate value
  const handleClearOperationArgument = (index: number) => {
    handleArgChange(index, {
      valueType: 'immediate',
      value: '',
      immediateType: 'string',
    });
  };

  // Determine if this is the root level or nested
  const isNested = value !== undefined;

  return (
    <div className={isNested ? 'ml-1 border-l-2 border-border pl-3' : ''}>
      {/* Compact operator select with optional inline controls */}
      <div className="flex items-center gap-1">
        <Select
          value={op}
          onValueChange={handleOperatorChange}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 w-auto min-w-[80px] border-input px-2 text-xs font-semibold">
            <SelectValue placeholder="Op" />
          </SelectTrigger>
          <SelectContent>
            <div className="px-2 py-1 text-3xs font-semibold text-muted-foreground">
              Logic
            </div>
            {OPERATORS.filter((o) => ['AND', 'OR', 'NOT'].includes(o.key)).map(
              (o) => (
                <SelectItem key={o.key} value={o.key} className="text-xs">
                  {o.key}
                </SelectItem>
              )
            )}
            <div className="mt-1 px-2 py-1 text-3xs font-semibold text-muted-foreground">
              Compare
            </div>
            {OPERATORS.filter((o) =>
              ['EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE'].includes(o.key)
            ).map((o) => (
              <SelectItem key={o.key} value={o.key} className="text-xs">
                {o.key} ({o.label})
              </SelectItem>
            ))}
            <div className="mt-1 px-2 py-1 text-3xs font-semibold text-muted-foreground">
              Check
            </div>
            {OPERATORS.filter((o) =>
              ['IS_EMPTY', 'IS_NOT_EMPTY', 'IS_DEFINED', 'LENGTH'].includes(
                o.key
              )
            ).map((o) => (
              <SelectItem key={o.key} value={o.key} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
            <div className="mt-1 px-2 py-1 text-3xs font-semibold text-muted-foreground">
              List/String
            </div>
            {OPERATORS.filter((o) =>
              ['IN', 'NOT_IN', 'CONTAINS'].includes(o.key)
            ).map((o) => (
              <SelectItem key={o.key} value={o.key} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {inlineControls}
      </div>

      {/* Arguments with tighter spacing */}
      <div className="mt-2 flex flex-col gap-1.5">
        {args.map((arg, index) => {
          const currentValueType = getArgumentValueType(arg);
          const displayValue = getArgumentDisplayValue(arg);
          const immediateType = getArgumentImmediateType(arg);

          return (
            <div key={index} className="flex items-start gap-1.5">
              {isCondition(arg) ? (
                // Nested operation - render with inline controls
                <ConditionBuilder
                  value={arg}
                  onChange={(nested) => handleArgChange(index, nested)}
                  disabled={disabled}
                  suggestions={suggestions}
                  inlineControls={
                    <>
                      <ArgumentValueTypeSelector
                        value="operation"
                        onChange={(newType) =>
                          handleValueTypeChange(index, newType)
                        }
                        disabled={disabled}
                      />
                      {isVariadicOperator && !disabled ? (
                        <Button
                          type="button"
                          variant="secondaryDestructive"
                          size="icon"
                          className="size-6"
                          onClick={() => handleRemoveArgument(index)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      ) : (
                        !disabled && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="secondaryDestructive"
                                  size="icon"
                                  className="size-6"
                                  onClick={() =>
                                    handleClearOperationArgument(index)
                                  }
                                >
                                  <Trash2 className="size-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Clear nested condition</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )
                      )}
                    </>
                  }
                />
              ) : currentValueType === 'reference' ? (
                // Reference mode - show compact pill
                <div className="flex flex-1 items-center gap-1.5">
                  {displayValue ? (
                    <ReferencePill
                      value={displayValue}
                      onRemove={() => handleRemoveReference(index)}
                      onClick={() => setPickerOpenForIndex(index)}
                      disabled={disabled}
                      suggestions={suggestions}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPickerOpenForIndex(index)}
                      disabled={disabled}
                      className="flex h-7 items-center rounded border border-dashed border-input px-2 text-xs text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:bg-muted/50 disabled:opacity-50"
                    >
                      Select variable...
                    </button>
                  )}
                  <ArgumentValueTypeSelector
                    value={currentValueType}
                    onChange={(newType) =>
                      handleValueTypeChange(index, newType)
                    }
                    disabled={disabled}
                  />
                  {isVariadicOperator && !disabled && (
                    <Button
                      type="button"
                      variant="secondaryDestructive"
                      size="icon"
                      className="size-6"
                      onClick={() => handleRemoveArgument(index)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  )}
                </div>
              ) : (
                // Immediate mode - compact input
                <div className="flex flex-1 items-center gap-1.5">
                  <ImmediateValueInput
                    value={displayValue}
                    onChange={(value) => handleArgValueChange(index, value)}
                    immediateType={immediateType}
                    onImmediateTypeChange={(type) =>
                      handleImmediateTypeChange(index, type)
                    }
                    placeholder={`Arg ${index + 1}`}
                    disabled={disabled}
                  />
                  <ArgumentValueTypeSelector
                    value={currentValueType}
                    onChange={(newType) =>
                      handleValueTypeChange(index, newType)
                    }
                    disabled={disabled}
                  />
                  {isVariadicOperator && !disabled && (
                    <Button
                      type="button"
                      variant="secondaryDestructive"
                      size="icon"
                      className="size-6"
                      onClick={() => handleRemoveArgument(index)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Compact "+ Add" button with dashed border */}
        {operator.arity === 'VARIADIC' && !disabled && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleAddArgument();
            }}
            className="self-start rounded border border-dashed border-input px-2 py-1 text-2xs text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:bg-muted/50"
            disabled={disabled}
          >
            + Add
          </button>
        )}
      </div>

      {/* Variable Picker Modal */}
      <ConditionVariablePickerModal
        open={pickerOpenForIndex !== null}
        onOpenChange={(open) => {
          if (!open) setPickerOpenForIndex(null);
        }}
        onSelect={(variable) => {
          if (pickerOpenForIndex !== null) {
            handleVariableSelect(pickerOpenForIndex, variable);
          }
        }}
        suggestions={suggestions}
      />
    </div>
  );
};

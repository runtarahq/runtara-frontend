import { useContext, useEffect, useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { NodeFormContext } from './NodeFormContext';
import { Label } from '@/shared/components/ui/label';
import { ConditionEditor } from '@/shared/components/ui/condition-editor';
import { composeConditionSuggestions } from './InputMappingValueField/VariableSuggestions';
import { SourceMappingValueField } from './SourceMappingValueField';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';

type FilterStepFieldProps = {
  name: string;
};

export function FilterStepField({ name }: FilterStepFieldProps) {
  const form = useFormContext();
  const {
    previousSteps,
    nodeId,
    inputSchemaFields,
    variables,
    isInsideWhileLoop,
    isInsideSplit,
    isInsideWaitScope,
    splitItemSchemaFields,
  } = useContext(NodeFormContext);

  // Filter conditions evaluate per array element: include the item scope.
  const conditionSuggestions = useMemo(
    () =>
      composeConditionSuggestions({
        previousSteps,
        inputSchemaFields,
        variables,
        isInsideWhileLoop,
        isInsideSplit,
        isInsideWaitScope,
        splitItemSchemaFields,
        includeItemScope: true,
      }),
    [
      previousSteps,
      inputSchemaFields,
      variables,
      isInsideWhileLoop,
      isInsideSplit,
      isInsideWaitScope,
      splitItemSchemaFields,
    ]
  );
  const stepType = useWatch({ name: 'stepType', control: form.control });
  const filterCondition = useWatch({
    name: 'filterCondition',
    control: form.control,
  });

  const defaultCondition = useMemo(
    () => ({
      type: 'operation',
      op: 'EQ',
      arguments: [
        { valueType: 'immediate', value: '', immediateType: 'string' },
        { valueType: 'immediate', value: '', immediateType: 'string' },
      ],
    }),
    []
  );

  // Build array source suggestions from previous steps
  const arraySuggestions = useMemo(() => {
    const suggestions: { label: string; value: string }[] = [];

    previousSteps.forEach((step) => {
      step.outputs.forEach((output) => {
        if (output.type === 'array') {
          suggestions.push({
            label: `${step.name}${output.name ? ` → ${output.name}` : ''}`,
            value: output.path,
          });
        }
      });

      suggestions.push({
        label: `${step.name} → outputs`,
        value: `steps['${step.id}'].outputs`,
      });
      suggestions.push({
        label: `${step.name} → outputs.items`,
        value: `steps['${step.id}'].outputs.items`,
      });
    });

    suggestions.push({
      label: 'data.items (workflow input)',
      value: 'data.items',
    });

    return suggestions;
  }, [previousSteps]);

  // A step being added already has an id but is not on the canvas yet. Only
  // a step on the canvas is in edit mode; testing the id skipped the default
  // for every new step, which then showed a condition the form did not have
  // (ED-9).
  const onCanvas = useWorkflowStore((state) =>
    Boolean(nodeId && state.nodes.some((n) => n.id === nodeId))
  );

  // Initialize default condition for new Filter steps
  useEffect(() => {
    if (stepType !== 'Filter') return;
    if (onCanvas) return; // Don't reset in edit mode
    // Again if a form reset clears it: the editor never sets it to nothing.
    if (!filterCondition) form.setValue('filterCondition', defaultCondition);
  }, [stepType, onCanvas, filterCondition, form, defaultCondition]);

  if (stepType !== 'Filter') {
    return null;
  }

  const handleConditionChange = (value: string) => {
    try {
      const condition = JSON.parse(value);
      form.setValue('filterCondition', condition, { shouldDirty: true });
    } catch (e) {
      console.error('Failed to parse condition:', e);
    }
  };

  const conditionValue = filterCondition
    ? JSON.stringify(filterCondition)
    : JSON.stringify(defaultCondition);

  return (
    <div className="space-y-6">
      <SourceMappingValueField
        name={name}
        label="Array Source"
        description="Select the array to filter. Items matching the condition will be kept."
        suggestions={arraySuggestions}
        placeholder="e.g., steps['fetch'].outputs.items"
      />

      {/* Filter Condition */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Filter Condition</Label>
        <p className="text-xs text-muted-foreground">
          Items matching this condition will be kept. Use{' '}
          <code className="rounded bg-muted px-1">item.*</code> to reference
          properties of each array element.
        </p>
        <ConditionEditor
          value={conditionValue}
          onChange={handleConditionChange}
          suggestions={conditionSuggestions}
        />
      </div>
    </div>
  );
}

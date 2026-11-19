import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { Instance, Schema } from '@/generated/RuntaraRuntimeApi';
import {
  useCreateObjectInstanceDto,
  useUpdateObjectInstanceDto,
} from '@/features/objects/hooks/useObjectRecords.ts';
import {
  initialInstanceValues,
  instanceFormDefinition,
  instanceProperties,
} from '@/features/objects/utils/instance-form';
import { Button } from '@/shared/components/ui/button';
import { FormRenderer, type FormAnalysisResult } from '@/shared/forms';

interface ObjectInstanceDtoFormProps {
  objectSchemaDto: Schema;
  record?: Instance;
  onSuccess: () => void;
  connectionId?: string | null;
}

export function ObjectInstanceDtoForm({
  objectSchemaDto,
  record,
  onSuccess,
  connectionId,
}: ObjectInstanceDtoFormProps) {
  const createRecord = useCreateObjectInstanceDto(connectionId);
  const updateRecord = useUpdateObjectInstanceDto(connectionId);
  const isEditing = !!record;

  const definition = useMemo(
    () => instanceFormDefinition(objectSchemaDto.columns),
    [objectSchemaDto.columns]
  );
  const [values, setValues] = useState(() =>
    initialInstanceValues(objectSchemaDto.columns, record)
  );
  // Another type or record is another form.
  useEffect(() => {
    setValues(initialInstanceValues(objectSchemaDto.columns, record));
  }, [objectSchemaDto, record]);

  const [analysis, setAnalysis] = useState<FormAnalysisResult | null>(null);
  const [submitAttempt, setSubmitAttempt] = useState(0);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!objectSchemaDto.columns || !objectSchemaDto.id) {
      toast.error('Schema is not properly defined');
      return;
    }
    if (!connectionId) {
      toast.error('Select a database connection first');
      return;
    }
    if (!analysis?.valid) {
      // Shows each field's problem and focuses the first.
      setSubmitAttempt((attempt) => attempt + 1);
      return;
    }
    const request = instanceProperties(objectSchemaDto.columns, values);
    if ('error' in request) {
      toast.error(request.error);
      return;
    }

    try {
      if (isEditing && record?.id) {
        await updateRecord.mutateAsync({
          schemaId: objectSchemaDto.id,
          instanceId: record.id,
          data: { properties: request.properties },
        });
        toast.success('Instance updated successfully');
      } else {
        await createRecord.mutateAsync({
          schemaId: objectSchemaDto.id,
          data: {
            schemaId: objectSchemaDto.id,
            properties: request.properties,
          },
        });
        toast.success('Instance created successfully');
      }
      onSuccess();
    } catch (error) {
      toast.error((error as Error)?.message || 'An error occurred');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-6 rounded-lg bg-card px-4 py-5 sm:px-6"
    >
      <FormRenderer
        definition={definition}
        value={values}
        onChange={setValues}
        onAnalysisChange={setAnalysis}
        submitAttempt={submitAttempt}
      />

      <div className="flex flex-col gap-3 border-t border-border/40 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          * Required fields must be filled
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            onClick={onSuccess}
            className="rounded-full"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="px-4"
            disabled={
              createRecord.isPending ||
              updateRecord.isPending ||
              analysis?.wasmAvailable === false
            }
          >
            {isEditing ? 'Update Instance' : 'Create Instance'}
          </Button>
        </div>
      </div>
    </form>
  );
}

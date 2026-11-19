import type { ColumnDefinition } from '@/generated/RuntaraRuntimeApi';

/** The fields a record can be filtered by: the system's, then the type's. */
export function filterSchemaDefinition(
  columns: ColumnDefinition[] | undefined
): Record<string, { name?: string; dataType?: string }> {
  const definition: Record<string, { name?: string; dataType?: string }> = {
    id: { name: 'ID', dataType: 'STRING' },
    createdAt: { name: 'Created At', dataType: 'DATE' },
    updatedAt: { name: 'Updated At', dataType: 'DATE' },
  };
  for (const column of columns ?? []) {
    definition[column.name] = {
      name: column.name,
      dataType: column.type?.toUpperCase() || 'STRING',
    };
  }
  return definition;
}

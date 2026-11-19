import { Fragment, type ReactNode } from 'react';
import { useController } from 'react-hook-form';

import { cn } from '@/lib/utils';
import { CheckboxInput } from '@/shared/components/checkbox-input';
import { SelectInput } from '@/shared/components/select-input';
import { TextInput } from '@/shared/components/text-input';

/**
 * One entry of a hand-written field list: a form whose fields are mostly its
 * own components, laid out on a grid. A form described by a schema uses
 * `FormRenderer` instead.
 *
 * `text`, `select`, `checkbox` and `hidden` are drawn here. Anything else
 * draws itself, through `renderFormField` (a field of the form) or
 * `renderComponent` (a part of the layout that is not one field).
 */
export type FieldConfig = {
  type?: 'text' | 'select' | 'checkbox' | 'hidden' | 'custom';
  name?: string;
  label?: string;
  description?: string;
  placeholder?: string;
  options?: { label: string; value: string }[];
  /** The value the form starts with; read by the form, not by the list. */
  initialValue?: unknown;
  /** `full` spans the grid; otherwise the field takes one column. */
  colSpan?: 'full';
  renderFormField?: (config: Record<string, unknown>) => ReactNode;
  renderComponent?: (config: Record<string, unknown>) => ReactNode;
};

function BuiltInField({ config }: { config: FieldConfig & { name: string } }) {
  const { name, type, label = '', description, placeholder, options } = config;
  const { field } = useController({ name });

  switch (type) {
    case 'hidden':
      return <input type="hidden" {...field} value={field.value || ''} />;
    case 'text':
      return (
        <TextInput
          label={label}
          name={name}
          type="text"
          placeholder={placeholder}
          onChange={field.onChange}
          description={description}
        />
      );
    case 'select':
      return (
        <SelectInput
          label={label}
          name={name}
          options={options ?? []}
          onChange={field.onChange}
          description={description}
        />
      );
    case 'checkbox':
      return (
        <CheckboxInput label={label} name={name} description={description} />
      );
    default:
      return null;
  }
}

function renderField(config: FieldConfig): ReactNode {
  if (config.renderComponent) return config.renderComponent(config);
  if (config.renderFormField) return config.renderFormField(config);
  if (!config.name) return null;
  return <BuiltInField config={{ ...config, name: config.name }} />;
}

export function FieldList({
  fields,
  className,
}: {
  fields: FieldConfig[];
  /** Replaces the two-column grid when it names its own `grid-cols-*`. */
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-3 py-3',
        !className?.includes('grid-cols') && 'grid-cols-2',
        className
      )}
    >
      {fields.map((config, index) => {
        const key = config.name || config.label || `field-${index}`;

        // A hidden field holds a value and takes no cell of the grid.
        if (config.type === 'hidden') {
          return (
            <Fragment key={key}>
              {config.renderFormField
                ? config.renderFormField(config)
                : renderField(config)}
            </Fragment>
          );
        }

        const content = renderField(config);
        if (!content) return null;

        return (
          <div
            key={key}
            className={
              config.colSpan === 'full' ? 'col-span-full' : 'col-span-1'
            }
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

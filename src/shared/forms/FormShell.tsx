import type { ReactNode } from 'react';
import type {
  FieldErrors,
  FieldValues,
  Path,
  UseFormReturn,
} from 'react-hook-form';

import { Form } from '@/shared/components/ui/form';
import { reportFirstFormError } from './form-errors';

interface FormShellProps<TInput extends FieldValues, TOutput> {
  form: UseFormReturn<TInput, unknown, TOutput>;
  onSubmit: (data: TOutput) => void | Promise<void>;
  /**
   * Called when validation blocks the submit. By default the first failing
   * field is reported and focused: without that, `handleSubmit` drops the
   * failure and the submit button appears to do nothing.
   */
  onInvalid?: (errors: FieldErrors<TInput>) => void;
  className?: string;
  children: ReactNode;
}

/**
 * The `<form>` of a react-hook-form: provides the form to its fields, submits
 * through validation, and says why when validation refuses.
 */
export function FormShell<TInput extends FieldValues, TOutput = TInput>({
  form,
  onSubmit,
  onInvalid,
  className,
  children,
}: FormShellProps<TInput, TOutput>) {
  const handleInvalid = (errors: FieldErrors<TInput>) => {
    if (onInvalid) {
      onInvalid(errors);
      return;
    }
    reportFirstFormError(
      { setFocus: (path) => form.setFocus(path as Path<TInput>) },
      errors
    );
  };

  return (
    <Form {...form}>
      <form
        className={className}
        onSubmit={form.handleSubmit(onSubmit, handleInvalid)}
      >
        {children}
      </form>
    </Form>
  );
}

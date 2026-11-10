import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { ConfigurationField } from './ConfigurationField';

function Harness() {
  // Like TriggerForm: the loaded trigger arrives through `values`, in a reset
  // after the first render.
  const form = useForm({
    defaultValues: { triggerType: 'CRON', configuration: {} } as Record<
      string,
      unknown
    >,
    values: {
      triggerType: 'APPLICATION',
      applicationName: 'shop',
      eventType: 'order',
      configuration: {
        applicationName: 'shop',
        eventType: 'order',
        custom_key: 'custom_val',
      },
    },
  });
  return (
    <FormProvider {...form}>
      <ConfigurationField label="Configuration" />
    </FormProvider>
  );
}

describe('ConfigurationField (TR-1)', () => {
  it("loads an existing trigger's custom pairs", async () => {
    render(
      <StrictMode>
        <Harness />
      </StrictMode>
    );
    expect(await screen.findByPlaceholderText('Key')).toHaveValue('custom_key');
    expect(screen.getByPlaceholderText('Value')).toHaveValue('custom_val');
  });
});

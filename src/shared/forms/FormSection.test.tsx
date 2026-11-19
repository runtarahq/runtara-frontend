import { fireEvent, render, screen } from '@testing-library/react';
import { Gauge } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { FormSection } from './FormSection';

describe('FormSection', () => {
  it('lays untitled fields out with no frame', () => {
    const { container } = render(
      <FormSection fieldsClassName="grid gap-2">
        <input aria-label="first" />
      </FormSection>
    );

    expect(container.firstElementChild).toHaveClass('grid', 'gap-2');
    expect(container.querySelector('section, details, h3')).toBeNull();
  });

  it('titles a plain group and describes it', () => {
    const { container } = render(
      <FormSection title="Credentials" description="How the console signs in">
        <input aria-label="key" />
      </FormSection>
    );

    expect(
      screen.getByRole('heading', { name: 'Credentials' })
    ).toBeInTheDocument();
    expect(screen.getByText('How the console signs in')).toBeInTheDocument();
    expect(container.querySelector('section')).not.toBeNull();
    expect(screen.queryByText('Optional')).not.toBeInTheDocument();
  });

  it('sets a banded title beside its icon and marks it optional', () => {
    const { container } = render(
      <FormSection variant="banded" title="Rate Limiting" icon={Gauge} optional>
        <input aria-label="limit" />
      </FormSection>
    );

    const heading = screen.getByRole('heading', { name: 'Rate Limiting' });
    expect(heading.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Optional')).toBeInTheDocument();
    expect(container.querySelector('section, details')).toBeNull();
  });

  it('keeps a collapsible section closed until its title is used', () => {
    const { container } = render(
      <FormSection collapsible title="Advanced">
        <input aria-label="retries" />
      </FormSection>
    );
    const details = container.querySelector('details')!;

    expect(details.open).toBe(false);

    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(details.open).toBe(true);
  });

  it('opens a collapsible section when what is inside becomes active, and leaves it open', () => {
    const view = (forceOpen: boolean) => (
      <FormSection collapsible title="Advanced" forceOpen={forceOpen}>
        <input aria-label="retries" />
      </FormSection>
    );
    const { container, rerender } = render(view(false));
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);

    rerender(view(true));
    expect(details.open).toBe(true);

    rerender(view(false));
    expect(details.open).toBe(true);
  });
});

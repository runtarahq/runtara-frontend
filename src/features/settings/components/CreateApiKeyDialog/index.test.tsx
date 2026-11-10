import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

let pending = false;
vi.mock('../../hooks/useApiKeys', () => ({
  useCreateApiKey: () => ({ mutate: vi.fn(), isPending: pending }),
}));

import { CreateApiKeyDialog } from './index';

function renderDialog(onClose: () => void) {
  render(<CreateApiKeyDialog open onClose={onClose} />);
  return screen.getByRole('dialog');
}

describe('CreateApiKeyDialog (ST-1)', () => {
  it('stays open on Escape while the key is being created', () => {
    pending = true;
    const onClose = vi.fn();
    const dialog = renderDialog(onClose);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape otherwise', () => {
    pending = false;
    const onClose = vi.fn();
    const dialog = renderDialog(onClose);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

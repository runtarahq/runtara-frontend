import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnsavedChangesDialog } from './unsaved-changes-dialog';
import { ConfirmationDialog } from './confirmation-dialog';

describe('UnsavedChangesDialog', () => {
  it.each(['pointer', 'keyboard'] as const)(
    'confirms once without cancelling on a %s click',
    async (input) => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      render(
        <UnsavedChangesDialog open onConfirm={onConfirm} onCancel={onCancel} />
      );
      const button = screen.getByRole('button', { name: 'Discard Changes' });
      if (input === 'pointer') await user.click(button);
      else {
        button.focus();
        await user.keyboard('{Enter}');
      }
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
    }
  );

  it('cancels once with either the cancel button or Escape', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <UnsavedChangesDialog open onConfirm={onConfirm} onCancel={onCancel} />
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    onCancel.mockClear();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('retains the outer modal pointer lock until the last modal closes', async () => {
    function NestedDialogs() {
      const [outerOpen, setOuterOpen] = useState(true);
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <>
          <ConfirmationDialog
            open={outerOpen}
            title="Outer dialog"
            onClose={() => setOuterOpen(false)}
            onConfirm={() => setOuterOpen(false)}
          >
            <button onClick={() => setInnerOpen(true)}>
              Open inner dialog
            </button>
          </ConfirmationDialog>
          <UnsavedChangesDialog
            open={innerOpen}
            onCancel={() => setInnerOpen(false)}
            onConfirm={() => setInnerOpen(false)}
          />
        </>
      );
    }
    render(<NestedDialogs />);
    fireEvent.click(screen.getByRole('button', { name: 'Open inner dialog' }));
    expect(document.body.style.pointerEvents).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    await waitFor(() =>
      expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument()
    );
    expect(document.body.style.pointerEvents).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(''));
  });
});

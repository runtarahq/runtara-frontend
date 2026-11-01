import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  PendingConfirmationNotice,
  describeStarter,
} from './PendingConfirmationNotice';

const inTenMinutes = () => new Date(Date.now() + 10 * 60_000).toISOString();

describe('PendingConfirmationNotice', () => {
  it('shows the account and who started the flow, and confirms it', () => {
    const onDecide = vi.fn();
    render(
      <PendingConfirmationNotice
        provider="HubSpot"
        pending={{
          id: 'p1',
          account: { id: '123', display: 'acme.hubspot.com (ops@acme.test)' },
          startedBy: 'api_key:user-1',
          pendingUntil: inTenMinutes(),
        }}
        deciding={null}
        onDecide={onDecide}
      />
    );
    expect(
      screen.getByText('acme.hubspot.com (ops@acme.test)')
    ).toBeInTheDocument();
    expect(screen.getByText(/an API key of user-1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onDecide).toHaveBeenCalledWith('confirm');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onDecide).toHaveBeenCalledWith('reject');
  });

  it('cannot be confirmed once its time is over, only rejected', () => {
    render(
      <PendingConfirmationNotice
        provider="QuickBooks Online"
        pending={{
          id: 'p1',
          account: null,
          startedBy: 'mcp:user-1',
          pendingUntil: '2020-01-01T00:00:00Z',
        }}
        deciding={null}
        onDecide={vi.fn()}
      />
    );
    expect(screen.getByText(/does not say which/)).toBeInTheDocument();
    expect(screen.getByText(/time to confirm it is over/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('names who started a flow', () => {
    expect(describeStarter('member:auth0|42')).toBe('auth0|42');
    expect(describeStarter('mcp:auth0|42')).toBe('an MCP client of auth0|42');
    expect(describeStarter('unknown')).toBe('unknown');
  });
});

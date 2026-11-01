import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { toast } from 'sonner';
import { OAuthPopupClosedError, useOAuthPopup } from './useOAuthPopup';

vi.mock('sonner', () => ({
  toast: { loading: vi.fn(() => 'wait-toast'), dismiss: vi.fn() },
}));

type FakePopup = { closed: boolean; close: ReturnType<typeof vi.fn> };

function mockPopup(): FakePopup {
  return { closed: false, close: vi.fn() };
}

// Delivers to the other channels of the same name at once. Node's own
// BroadcastChannel, under jsdom, does not deliver here on every Node version.
class FakeBroadcastChannel {
  static open = new Set<FakeBroadcastChannel>();
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(readonly name: string) {
    FakeBroadcastChannel.open.add(this);
  }

  postMessage(data: unknown) {
    for (const other of FakeBroadcastChannel.open) {
      if (other !== this && other.name === this.name)
        other.onmessage?.({ data });
    }
  }

  close() {
    FakeBroadcastChannel.open.delete(this);
  }
}

describe('useOAuthPopup', () => {
  let openSpy: { mockRestore: () => void } | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    openSpy?.mockRestore();
    vi.unstubAllGlobals();
    FakeBroadcastChannel.open.clear();
    vi.mocked(toast.loading).mockClear();
    vi.mocked(toast.dismiss).mockClear();
  });

  it('waits for the result after the popup looks closed, then gives up', async () => {
    const popup = mockPopup();
    openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as Window);

    const { result } = renderHook(() => useOAuthPopup());
    const promise = result.current.openOAuthPopup(
      'https://provider.example/auth'
    );
    const assertion = expect(promise).rejects.toBeInstanceOf(
      OAuthPopupClosedError
    );

    // User closes the consent window.
    popup.closed = true;
    // The poll interval detects the close, then the grace window elapses:
    // the hook says it is waiting rather than failing.
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1500);
    expect(toast.loading).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120000);
    await assertion;
    expect(toast.dismiss).toHaveBeenCalledWith('wait-toast');
  });

  it('resolves on a broadcast that comes after the popup looked closed', async () => {
    // A provider page with Cross-Origin-Opener-Policy cuts the popup off: the
    // browser reports it closed while the user is still signing in.
    const popup = mockPopup();
    openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as Window);

    const { result } = renderHook(() => useOAuthPopup());
    const promise = result.current.openOAuthPopup(
      'https://provider.example/auth',
      'conn-1'
    );
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(5000);

    const landing = new BroadcastChannel('runtara-oauth');
    landing.postMessage({
      type: 'oauth-complete',
      success: true,
      connectionId: 'conn-1',
    });
    landing.close();

    await expect(promise).resolves.toEqual({
      connectionId: 'conn-1',
      success: true,
    });
    expect(toast.dismiss).toHaveBeenCalledWith('wait-toast');
  });

  it('stops waiting when the user cancels', async () => {
    const popup = mockPopup();
    openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as Window);

    const { result } = renderHook(() => useOAuthPopup());
    const promise = result.current.openOAuthPopup(
      'https://provider.example/auth'
    );
    const assertion = expect(promise).rejects.toBeInstanceOf(
      OAuthPopupClosedError
    );
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(2000);

    const options = vi.mocked(toast.loading).mock.calls[0][1] as unknown as {
      action: { onClick: () => void };
    };
    options.action.onClick();

    await assertion;
  });

  it('resolves on a success message even if the popup closes right after', async () => {
    const popup = mockPopup();
    openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as Window);

    const { result } = renderHook(() => useOAuthPopup());
    const promise = result.current.openOAuthPopup(
      'https://provider.example/auth'
    );

    // Completion posts back and the popup closes at about the same time.
    popup.closed = true;
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'oauth-complete', success: true, connectionId: 'conn-1' },
      })
    );

    await expect(promise).resolves.toEqual({
      connectionId: 'conn-1',
      success: true,
    });
    // The grace window must not turn a success into a closed-rejection.
    await vi.advanceTimersByTimeAsync(2000);
  });

  it('resolves on the landing page broadcast when the opener link is gone', async () => {
    const popup = mockPopup();
    openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as Window);

    const { result } = renderHook(() => useOAuthPopup());
    const promise = result.current.openOAuthPopup(
      'https://provider.example/auth',
      'conn-1'
    );

    const landing = new BroadcastChannel('runtara-oauth');
    landing.postMessage({
      type: 'oauth-complete',
      success: true,
      connectionId: 'conn-1',
    });
    landing.close();

    await expect(promise).resolves.toEqual({
      connectionId: 'conn-1',
      success: true,
    });
  });

  it('reports an authorization that waits for confirmation', async () => {
    const popup = mockPopup();
    openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as Window);

    const { result } = renderHook(() => useOAuthPopup());
    const promise = result.current.openOAuthPopup(
      'https://provider.example/auth',
      'conn-1'
    );
    const landing = new BroadcastChannel('runtara-oauth');
    landing.postMessage({
      type: 'oauth-complete',
      success: true,
      pending: true,
      connectionId: 'conn-1',
    });
    landing.close();

    await expect(promise).resolves.toEqual({
      connectionId: 'conn-1',
      success: true,
      pending: true,
    });
  });

  it('explains a flow finished in another browser', async () => {
    const popup = mockPopup();
    openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as Window);

    const { result } = renderHook(() => useOAuthPopup());
    const promise = result.current.openOAuthPopup(
      'https://provider.example/auth',
      'conn-1'
    );
    const assertion = expect(promise).rejects.toThrow(
      'finish the authorization in the browser you started it in'
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'oauth-complete',
          success: false,
          error: 'browser_mismatch',
        },
      })
    );
    await assertion;
  });

  it("ignores another connection's success and reports a failure's code", async () => {
    const popup = mockPopup();
    openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as Window);

    const { result } = renderHook(() => useOAuthPopup());
    const promise = result.current.openOAuthPopup(
      'https://provider.example/auth',
      'conn-1'
    );
    const assertion = expect(promise).rejects.toThrow('access was denied');

    const send = (data: unknown) =>
      window.dispatchEvent(
        new MessageEvent('message', { origin: window.location.origin, data })
      );
    send({ type: 'oauth-complete', success: true, connectionId: 'conn-2' });
    send({ type: 'oauth-complete', success: false, error: 'access_denied' });

    await assertion;
  });

  it('ignores messages from another origin', async () => {
    const popup = mockPopup();
    openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as Window);

    const { result } = renderHook(() => useOAuthPopup());
    const promise = result.current.openOAuthPopup(
      'https://provider.example/auth'
    );
    const assertion = expect(promise).rejects.toBeInstanceOf(
      OAuthPopupClosedError
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example',
        data: { type: 'oauth-complete', success: true, connectionId: 'x' },
      })
    );
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(2000 + 120000);

    await assertion;
  });

  it('rejects immediately when the popup is blocked', async () => {
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHook(() => useOAuthPopup());
    await expect(
      result.current.openOAuthPopup('https://provider.example/auth')
    ).rejects.toThrow(/allow popups/i);
  });
});

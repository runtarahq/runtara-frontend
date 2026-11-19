import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MatchNav, ModeSwitch, SearchBox } from './ExplorerToolbar';
import {
  cachedSearch,
  cachedSize,
  isEmptyValue,
  otherSectionsHint,
} from './payload-cache';
import type { PayloadSection } from './types';
import { useFullValues } from './use-full-values';

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

beforeEach(() => vi.clearAllMocks());

const section = (id: string, value: unknown): PayloadSection => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
  value,
});

describe('payload caches', () => {
  it('walks a payload once per query, and once for its size', () => {
    const value = { order: { id: 7, note: 'rush order' } };

    const first = cachedSearch(value, 'rush');
    expect(first.matches).toHaveLength(1);
    expect(cachedSearch(value, 'rush')).toBe(first);
    expect(cachedSearch(value, 'order')).not.toBe(first);
    expect(cachedSearch({ ...value }, 'rush')).not.toBe(first);

    expect(cachedSize(value)).toBe(cachedSize(value));
    expect(cachedSize('text').bytes).toBeGreaterThan(0);
  });

  it('keeps only the last few queries of a payload', () => {
    const value = { a: 'aaa' };
    const first = cachedSearch(value, 'q0');
    for (let i = 1; i <= 8; i++) cachedSearch(value, `q${i}`);

    expect(cachedSearch(value, 'q0')).not.toBe(first);
  });

  it('counts null and undefined as empty, and nothing else', () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue({})).toBe(false);
  });

  it('says where else a search found something', () => {
    const sections = [
      section('input', { a: 'x' }),
      section('output', { b: 'needle', c: 'needle' }),
      section('state', { d: 'y' }),
    ];
    const searches = Object.fromEntries(
      sections.map((s) => [s.id, cachedSearch(s.value, 'needle')])
    );

    expect(otherSectionsHint(sections, searches, 'input')).toBe(
      'Found 2 in output.'
    );
    expect(otherSectionsHint(sections, searches, 'output')).toBe(
      'Nothing here matches the search.'
    );
  });
});

describe('useFullValues', () => {
  it('shows a section’s full value once loaded, until the section itself changes', async () => {
    const elided = { big: '…' };
    const load = vi.fn().mockResolvedValue({ big: 'everything' });
    const { result, rerender } = renderHook(
      ({ sections }) => useFullValues(sections, load),
      { initialProps: { sections: [section('output', elided)] } }
    );
    expect(result.current.valueOf(section('output', elided))).toBe(elided);

    await act(async () => {
      await result.current.ensureFull(section('output', elided));
    });
    expect(result.current.fullValues.output).toEqual({ big: 'everything' });

    // A second request for the same section does not fetch again.
    await act(async () => {
      await result.current.ensureFull(section('output', elided));
    });
    expect(load).toHaveBeenCalledTimes(1);

    // A poll brought a new value: the loaded one is for the old (SH-6).
    const next = { big: '… newer' };
    rerender({ sections: [section('output', next)] });
    expect('output' in result.current.fullValues).toBe(false);
    expect(result.current.valueOf(section('output', next))).toBe(next);
  });

  it('tracks each section’s load on its own', async () => {
    const pending: Record<string, (value: unknown) => void> = {};
    const load = vi.fn(
      (id: string) => new Promise((resolve) => (pending[id] = resolve))
    );
    const sections = [section('input', {}), section('output', {})];
    const { result } = renderHook(() => useFullValues(sections, load));

    act(() => {
      void result.current.ensureFull(sections[0]);
      void result.current.ensureFull(sections[1]);
    });
    expect([...result.current.loadingFull].sort()).toEqual(['input', 'output']);

    await act(async () => pending.input({}));
    // One finishing leaves the other's indicator alone (SH-7).
    expect([...result.current.loadingFull]).toEqual(['output']);
  });

  it('reports a failed load and has no value to give', async () => {
    const load = vi.fn().mockRejectedValue(new Error('gone'));
    const sections = [section('output', {})];
    const { result } = renderHook(() => useFullValues(sections, load));

    let full: unknown = 'unset';
    await act(async () => {
      full = await result.current.ensureFull(sections[0]);
    });

    expect(full).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith(
      'Could not load the full output: gone'
    );
    expect(result.current.loadingFull.size).toBe(0);
  });

  it('has nothing to load without a loader', async () => {
    const sections = [section('output', {})];
    const { result } = renderHook(() => useFullValues(sections));

    await expect(
      result.current.ensureFull(sections[0])
    ).resolves.toBeUndefined();
  });
});

describe('explorer toolbar', () => {
  it('names the sections a search covers, and clears what was typed', () => {
    const onInput = vi.fn();
    const onClear = vi.fn();
    render(
      <SearchBox
        inputRef={createRef()}
        input="abc"
        onInput={onInput}
        onKeyDown={vi.fn()}
        onClear={onClear}
        sectionLabels={['Input', 'Output']}
        compact={false}
      />
    );

    const box = screen.getByLabelText('Search keys and values');
    expect(box).toHaveAttribute(
      'placeholder',
      'Search keys and values in input, output'
    );
    fireEvent.change(box, { target: { value: 'abcd' } });
    expect(onInput).toHaveBeenCalledWith('abcd');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('says where the selection is among the matches and steps between them', () => {
    const onGo = vi.fn();
    const { rerender } = render(
      <MatchNav matchCount={12} matchIndex={13} capped onGo={onGo} />
    );

    expect(screen.getByText('2 of 12+')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(onGo.mock.calls).toEqual([[1], [-1]]);

    rerender(
      <MatchNav matchCount={0} matchIndex={0} capped={false} onGo={onGo} />
    );
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
  });

  it('switches between the tree and the JSON', () => {
    const onMode = vi.fn();
    render(<ModeSwitch mode="tree" onMode={onMode} compact={false} />);

    expect(screen.getByRole('button', { name: 'Tree' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(onMode).toHaveBeenCalledWith('json');
  });
});

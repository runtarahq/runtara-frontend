import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const reads = new Map<string, (data: unknown) => void>();
vi.mock('@/shared/utils/file-utils', () => ({
  validateFileSize: () => ({ valid: true }),
  parseFileDataFromString: () => null,
  fileToFileData: (file: File) =>
    new Promise((resolve) => reads.set(file.name, resolve)),
}));

import { FileInput } from './file-input';

describe('FileInput (SH-8)', () => {
  it('keeps the last file chosen when an earlier read finishes later', async () => {
    const onChange = vi.fn();
    const { container } = render(<FileInput onChange={onChange} />);
    const input = container.querySelector('input[type="file"]')!;
    const pick = (name: string) =>
      fireEvent.change(input, {
        target: { files: [new File(['x'], name)] },
      });

    pick('first.txt');
    pick('second.txt');
    await act(async () => {
      reads.get('second.txt')!({ filename: 'second.txt' });
      reads.get('first.txt')!({ filename: 'first.txt' });
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain('second.txt');
  });
});

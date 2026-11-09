/**
 * The value an auto-typed immediate stores for what is typed. Text becomes a
 * boolean or a number only when that loses nothing: `1.` stays text while a
 * decimal is being typed, and so do `007` and `1e3`, which a number would
 * reprint differently.
 */
export function parseAutoImmediate(input: string): string | number | boolean {
  if (input === 'true') return true;
  if (input === 'false') return false;
  const asNumber = Number(input);
  if (input !== '' && Number.isFinite(asNumber) && String(asNumber) === input)
    return asNumber;
  return input;
}

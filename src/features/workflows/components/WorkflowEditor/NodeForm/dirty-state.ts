/**
 * Whether a react-hook-form `dirtyFields` tree marks any field as changed.
 *
 * Use this instead of `formState.isDirty`. `isDirty` deep-compares the whole
 * form against its defaults, so a Controller that registers an optional field
 * (e.g. a mapping row's `typeHint`) adds an `undefined` key and flips it to
 * true with no value changed. `dirtyFields` compares per field, where a
 * missing key and an `undefined` value are equal.
 */
export function hasDirtyFields(dirtyFields: unknown): boolean {
  if (dirtyFields === true) return true;
  if (Array.isArray(dirtyFields)) return dirtyFields.some(hasDirtyFields);
  if (dirtyFields && typeof dirtyFields === 'object') {
    return Object.values(dirtyFields).some(hasDirtyFields);
  }
  return false;
}

/**
 * setValue options for a change the user made. Without `shouldDirty`, RHF
 * leaves `dirtyFields` alone, so the panel would close without asking and
 * drop the edit. Seeds and resets must not use this.
 */
export const USER_EDIT = { shouldDirty: true } as const;

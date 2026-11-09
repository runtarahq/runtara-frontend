/**
 * One save per row at a time (OB-1).
 *
 * A flush while the row's save is in flight must not send the same values a
 * second time: for a draft that is a second POST and a duplicate record. It is
 * queued instead, and `end` reports it so the caller saves once more, sending
 * only what changed meanwhile.
 */
export function createRowSaveQueue() {
  const inFlight = new Set<string>();
  const queued = new Set<string>();

  return {
    /** Claim the row; false when its save is in flight and this one waits. */
    begin(rowId: string): boolean {
      if (inFlight.has(rowId)) {
        queued.add(rowId);
        return false;
      }
      inFlight.add(rowId);
      return true;
    },
    /** Release the row; true when a flush waited and should now run. */
    end(rowId: string): boolean {
      inFlight.delete(rowId);
      return queued.delete(rowId);
    },
  };
}

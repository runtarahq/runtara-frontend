/**
 * Which breakpoint hit a `breakpoint_hit` event is, for acting on each once.
 *
 * Not the step id alone: a new run pausing at the same step (EX-1) and a loop
 * reaching it again (EX-2) are new hits that each need their own Continue.
 * The event's database id tells hits apart, and the run id keeps two runs'
 * ids apart; without an id, the step, scope and time do.
 */
export function breakpointKey(
  instanceId: string | null | undefined,
  event: {
    id?: number | null;
    createdAt?: string | null;
    payload?: { step_id?: string; scope_id?: string | null } | null;
  }
): string {
  const hit =
    event.id != null
      ? `event:${event.id}`
      : `step:${event.payload?.step_id ?? ''}|${event.payload?.scope_id ?? ''}|${event.createdAt ?? ''}`;
  return `${instanceId ?? ''}:${hit}`;
}

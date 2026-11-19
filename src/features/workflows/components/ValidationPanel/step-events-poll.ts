const POLL_MS = 2000;
/** How many times a finished run with no events yet is asked for them. */
const SETTLE_FETCHES = 6;

/**
 * How often to ask for a run's step events, or `false` to stop.
 *
 * While the run is live, every two seconds. Once it has ended there is
 * normally nothing more to come, but its events reach the server a moment
 * after its status does: a run seen as finished before any event was listed
 * is asked a few more times, so it does not sit at "No events yet" with its
 * events written. A run that recorded none stops being asked.
 */
export function stepEventsPollInterval({
  runIsActive,
  stepsLoaded,
  fetches,
}: {
  runIsActive: boolean;
  stepsLoaded: number;
  /** How many times the events have been fetched so far. */
  fetches: number;
}): number | false {
  if (runIsActive) return POLL_MS;
  if (stepsLoaded === 0 && fetches < SETTLE_FETCHES) return POLL_MS;
  return false;
}

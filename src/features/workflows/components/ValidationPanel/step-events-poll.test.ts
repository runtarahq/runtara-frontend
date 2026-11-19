import { describe, expect, it } from 'vitest';

import { stepEventsPollInterval } from './step-events-poll';

describe('stepEventsPollInterval', () => {
  it('asks every two seconds while the run is live', () => {
    expect(
      stepEventsPollInterval({ runIsActive: true, stepsLoaded: 3, fetches: 40 })
    ).toBe(2000);
  });

  it('stops once a finished run has its events', () => {
    expect(
      stepEventsPollInterval({ runIsActive: false, stepsLoaded: 3, fetches: 1 })
    ).toBe(false);
  });

  it('asks a finished run with no events yet a few more times: they arrive after its status', () => {
    expect(
      stepEventsPollInterval({ runIsActive: false, stepsLoaded: 0, fetches: 1 })
    ).toBe(2000);
    expect(
      stepEventsPollInterval({ runIsActive: false, stepsLoaded: 0, fetches: 5 })
    ).toBe(2000);
  });

  it('gives up on a finished run that recorded none', () => {
    expect(
      stepEventsPollInterval({ runIsActive: false, stepsLoaded: 0, fetches: 6 })
    ).toBe(false);
  });
});

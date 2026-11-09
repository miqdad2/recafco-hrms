import { ClockService } from '../../src/common/clock.service';

/** Deterministic server clock for tests: `now()` returns exactly what the test set. */
export class FixedClock extends ClockService {
  private current: Date;

  constructor(initial: string | Date) {
    super();
    this.current = new Date(initial);
  }

  set(instant: string | Date): void {
    this.current = new Date(instant);
  }

  override now(): Date {
    return new Date(this.current.getTime());
  }
}

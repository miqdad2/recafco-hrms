import { Injectable } from '@nestjs/common';

/**
 * The trusted server clock. Injected (rather than calling `new Date()` inline) so the
 * payroll-critical receipt timestamp is deterministic under test. Production always uses this
 * implementation; tests override the provider with a fixed clock.
 */
@Injectable()
export class ClockService {
  now(): Date {
    return new Date();
  }
}

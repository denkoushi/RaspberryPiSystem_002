import { logger } from '../../lib/logger.js';
import { rebuildProductionSchedulePartNameLookup } from './production-schedule-part-name-lookup.js';

/** One active rebuild and at most one pending pass, shared by all callers. */
export class ProductionSchedulePartNameLookupRebuilder {
  private active: Promise<void> | null = null;
  private pending = false;

  constructor(private readonly run: () => Promise<void> = rebuildProductionSchedulePartNameLookup) {}

  request(): Promise<void> {
    this.pending = true;
    if (!this.active) {
      // Defer work so even a synchronous failure cannot escape into the caller.
      this.active = Promise.resolve().then(async () => {
        try {
          while (this.pending) {
            this.pending = false;
            try {
              await this.run();
            } catch (err) {
              logger.warn({ err }, '[ProductionSchedulePartNameLookup] Rebuild failed');
            }
          }
        } finally {
          this.active = null;
        }
      });
    }
    return this.active;
  }
}

const rebuilder = new ProductionSchedulePartNameLookupRebuilder();
export const requestProductionSchedulePartNameLookupRebuild = () => rebuilder.request();

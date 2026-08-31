import { DomainError } from "@/lib/api/domain-error";
import type { ApiErrorCode } from "@/lib/api/domain-error";

/**
 * Stops one expensive job from being started twice over.
 *
 * The case this exists for is the double click: an administrator presses
 * "translate into the other languages", nothing visibly happens for a few
 * seconds, and they press it again. Without this the second press starts a
 * second run of up to 108 vendor calls for a job already in progress.
 *
 * The key is per entity, deliberately. Two different dishes translated at the
 * same time are two unrelated jobs and must not queue behind each other; the
 * same dish twice is the mistake.
 *
 * ponytail: per-instance, so it catches the double click that actually happens
 * — the same person, the same session, the same replica — without a lock
 * table. A replay spread across replicas is what the rate limit is for.
 */
export class InFlightGuard {
  private readonly active = new Set<string>();

  constructor(
    private readonly code: ApiErrorCode,
    private readonly message: string,
  ) {}

  /** Test seam and health check: how many jobs are running right now. */
  get size(): number {
    return this.active.size;
  }

  async run<TResult>(key: string, work: () => Promise<TResult>): Promise<TResult> {
    if (this.active.has(key)) {
      throw new DomainError(this.code, this.message, { httpStatus: 409 });
    }
    this.active.add(key);
    try {
      return await work();
    } finally {
      // Released on every path. A job that throws must not leave the entity
      // locked out until the process restarts.
      this.active.delete(key);
    }
  }
}

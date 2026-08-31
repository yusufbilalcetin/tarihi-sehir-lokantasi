/**
 * Turns changing API snapshots into a single "something new arrived" signal.
 * The first successful snapshot is deliberately silent and IDs remain known
 * even if a later response temporarily omits them.
 */
export class NewEntityTracker {
  private seen: Set<string> | null = null;

  update(ids: Iterable<string>): boolean {
    const next = new Set(ids);
    if (this.seen === null) {
      this.seen = next;
      return false;
    }

    let foundNew = false;
    for (const id of next) {
      if (!this.seen.has(id)) foundNew = true;
      this.seen.add(id);
    }
    return foundNew;
  }
}

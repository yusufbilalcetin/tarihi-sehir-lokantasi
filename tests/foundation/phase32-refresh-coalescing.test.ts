import assert from "node:assert/strict";
import test from "node:test";

import { createCoalescer } from "../../lib/hooks/use-api-resource";

/**
 * Phase 32, section D3: ten realtime events, or a tab regaining focus, used to
 * mean ten requests the server ran to completion and nine responses nobody
 * read. What must survive the collapsing is freshness — a caller that refreshes
 * after its own write may never be answered by a request that started before it.
 */

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("a burst of triggers becomes one run in flight plus one trailing run", async () => {
  const gates = [deferred(), deferred()];
  let started = 0;
  const coalescer = createCoalescer(() => gates[started++]?.promise ?? Promise.resolve());

  const first = coalescer.trigger();
  assert.equal(started, 1, "the first trigger runs immediately");

  const burst = [coalescer.trigger(), coalescer.trigger(), coalescer.trigger()];
  assert.equal(started, 1, "nothing else starts while a run is in flight");

  gates[0].resolve();
  await first;
  await Promise.resolve();
  assert.equal(started, 2, "the whole burst collapses into exactly one more run");

  gates[1].resolve();
  await Promise.all(burst);
  assert.equal(started, 2, "and no further run is queued once the burst drains");
});

test("a caller awaiting a refresh waits for a run that began after its call", async () => {
  const gates = [deferred(), deferred()];
  let started = 0;
  const finished: number[] = [];
  const coalescer = createCoalescer(() => {
    const index = started++;
    return gates[index].promise.then(() => {
      finished.push(index);
    });
  });

  const stale = coalescer.trigger();
  // Stands in for "I just wrote something, now show me the truth".
  const afterWrite = coalescer.trigger();

  gates[0].resolve();
  await stale;
  assert.deepEqual(finished, [0], "the run already in flight settles first");

  let resolvedEarly = true;
  void afterWrite.then(() => {
    resolvedEarly = finished.length < 2;
  });
  gates[1].resolve();
  await afterWrite;
  assert.deepEqual(finished, [0, 1]);
  assert.equal(resolvedEarly, false, "the post-write caller resolved on the stale run");
});

test("triggers spaced out in time each get their own run", async () => {
  let started = 0;
  const coalescer = createCoalescer(async () => {
    started++;
  });
  await coalescer.trigger();
  await coalescer.trigger();
  assert.equal(started, 2);
});

test("a failing run does not wedge the queue", async () => {
  let started = 0;
  const coalescer = createCoalescer(async () => {
    started++;
    if (started === 1) throw new Error("network");
  });
  await assert.rejects(() => coalescer.trigger(), /network/);
  await coalescer.trigger();
  assert.equal(started, 2, "the next trigger still runs after a failure");
});

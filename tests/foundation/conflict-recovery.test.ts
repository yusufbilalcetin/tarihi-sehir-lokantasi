import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * A 409 from this API always means the same thing: the screen acted on state
 * that has already moved on. Showing the message is half the job — without a
 * re-read the operator is left staring at the stale view that caused it and
 * will simply press the button again.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

test("a conflicted cash-drawer mutation re-reads the drawer", () => {
  const source = read("components/cashier/shift-panel.tsx");
  assert.match(source, /error\.status === 409/);
  assert.match(source, /if \(error instanceof ApiClientError && error\.status === 409\) \{\s*\n\s*await onChanged\(\);/);
});

test("a conflicted collection re-reads both the bills and the drawer", () => {
  const source = read("components/cashier/cashier-dashboard.tsx");
  const branch = /error\.status === 409\) \{[\s\S]*?\}/.exec(source)?.[0] ?? "";
  assert.match(branch, /await refetch\(\)/);
  assert.match(branch, /await refetchShift\(\)/);
});

test("conflicts are surfaced with the server's own message, never a raw code", () => {
  for (const file of [
    "components/cashier/shift-panel.tsx",
    "components/cashier/cashier-dashboard.tsx",
  ]) {
    const source = read(file);
    // The typed client carries a Turkish message; the UI must print that.
    assert.match(source, /ApiClientError/);
    // A bare business code must never reach a toast.
    assert.doesNotMatch(source, /toast\.error\([^)]*error\.code/);
  }
});

test("the till never opens a shift on its own", () => {
  // An automatic open on mount is what turns a normal drawer state into a
  // duplicate-shift conflict, so the mutation must stay behind an explicit act.
  const source = read("components/cashier/cashier-dashboard.tsx");
  const effects = [...source.matchAll(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g)].map(
    (match) => match[0],
  );
  for (const effect of effects) {
    assert.doesNotMatch(effect, /cashierShiftApi\.open/, "a mount effect must not open a shift");
    assert.doesNotMatch(effect, /paymentApi\.collect/, "a mount effect must not take money");
  }
});

test("every cash mutation is guarded against a double submit", () => {
  const source = read("components/cashier/shift-panel.tsx");
  // One in-flight guard covers every mutation routed through `submit`.
  assert.match(source, /if \(busy\) return false;/);
  assert.match(source, /setBusy\(true\)/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The reported bug: opening the till showed the cashier
 * "a0e468f8-b8ae-8225-baac-88fd398c56d2" where "Ana Kasa" belonged.
 *
 * The cause is a Base UI contract, not a typo. `Select.Root` documents it:
 * "Data structure of the items rendered in the select popup. When specified,
 * `<Select.Value>` renders the label of the selected item instead of the raw
 * value." Without that map the trigger prints the value itself — which, for a
 * select whose value is a database id, is the id.
 *
 * The invariant these hold is the general one: a select's value and the words
 * shown for it are different things. Any select whose options are labelled
 * differently from their values must supply the map.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

/** Every production file that renders a select trigger's selected value. */
const SELECT_FILES = [
  "components/cashier/shift-panel.tsx",
  "components/admin/cash-day-report-view.tsx",
  "components/admin/cash-registers-manager.tsx",
  "components/admin/printers-manager.tsx",
  "components/admin/erp-operations-manager.tsx",
  "components/admin/erp-workspace-manager.tsx",
];

test("every select that shows a selected value supplies its labels", () => {
  for (const path of SELECT_FILES) {
    const source = read(path);
    const triggers = (source.match(/<SelectValue\b/g) ?? []).length;
    const maps = (source.match(/\bitems=\{/g) ?? []).length;
    assert.ok(triggers > 0, `${path} no longer renders a select value`);
    assert.equal(
      maps,
      triggers,
      `${path} has ${triggers} select value(s) but ${maps} label map(s): a trigger will print its raw value`,
    );
  }
});

test("the cashier register select shows the name and submits the id", () => {
  const source = read("components/cashier/shift-panel.tsx");

  // The label map is built from the register data, never spelled out: a
  // restaurant may define several tills.
  assert.match(source, /registers\.map\(\(register\) => \[register\.id, register\.name\]\)/);
  assert.doesNotMatch(source, /"Ana Kasa"/, "a register name is hardcoded");

  // The id remains the value, the selection state and the submitted payload.
  assert.match(source, /value=\{registerId\}/);
  assert.match(source, /setRegisterId\(value \?\? ""\)/);
  assert.match(source, /cashRegisterId: registerId/, "the shift payload stopped sending the register id");
  assert.doesNotMatch(
    source,
    /cashRegisterId: [a-zA-Z]*[Nn]ame/,
    "the shift payload started sending a name instead of an id",
  );

  // A selection that is not in the list falls back to the placeholder, not to
  // the raw value.
  assert.match(source, /placeholder="Kasa seçin"/);
});

test("label maps are derived from data, never from a UUID-shaped guess", () => {
  for (const path of SELECT_FILES) {
    const source = read(path);
    // No call site may paper over the defect by detecting and hiding ids.
    assert.doesNotMatch(
      source,
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      `${path} contains a literal UUID`,
    );
    assert.doesNotMatch(source, /\{8\}-\[0-9a-f\]/, `${path} tries to pattern-match ids away`);
  }
});

test("the shared select wrapper stays a plain Base UI root", () => {
  // The fix is per call site precisely so the primitive keeps no entity
  // knowledge: it must not learn to look anything up on its own.
  const wrapper = read("components/ui/select.tsx");
  assert.match(wrapper, /const Select = SelectPrimitive\.Root/);
  for (const forbidden of ["fetch(", "useApiResource", "uuid"]) {
    assert.ok(!wrapper.includes(forbidden), `the select primitive gained ${forbidden}`);
  }
});

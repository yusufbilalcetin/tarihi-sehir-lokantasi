import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createProductBodySchema } from "@/lib/validation/admin-menu";

/**
 * The reported bug: typing a price with kuruş (64.25) into the admin product
 * dialog did nothing at all. The number input carried step="1", so the browser
 * refused the value before React ever saw a submit — no request, no error, no
 * hint. Meanwhile the server's own schema accepts two decimals, and the menu
 * already holds prices like 75.50, so the panel could not enter a price the
 * rest of the system uses.
 *
 * The guard pins the two halves together: any money input must admit the
 * precision the server accepts.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

test("the server accepts a price with kuruş", () => {
  const parsed = createProductBodySchema.safeParse({
    categoryId: "30092f1a-710f-47f7-8d53-7b5dded74298",
    name: "Kuruşlu ürün",
    price: "64.25",
  });
  assert.equal(parsed.success, true, "two decimals must be valid server-side");
});

test("no money input rounds the operator to whole lira", () => {
  const offenders: string[] = [];
  for (const file of walk(path.join(process.cwd(), "components"))) {
    const source = readFileSync(file, "utf8");
    // A money field is a number input sitting next to the ₺ marker.
    for (const line of source.split(/\r?\n/)) {
      if (!line.includes('type="number"') || !line.includes("₺")) continue;
      if (/step="(1|\d+)"/.test(line)) {
        offenders.push(`${path.relative(process.cwd(), file)}: ${/step="[^"]*"/.exec(line)?.[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "a money input refuses the kuruş the server accepts");
});

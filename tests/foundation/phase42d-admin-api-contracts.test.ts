import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createCategoryBodySchema, updateCategoryBodySchema } from "../../lib/validation/admin-menu";

/**
 * Phase 42D — the admin API surface, guarded where TypeScript cannot look.
 *
 * The client sends `body: Record<string, unknown>`, so a payload key the server
 * does not accept is invisible at compile time and arrives as a 400 in front of
 * a manager. Route files are equally opaque: two files can claim the same URL
 * and only the router decides who wins.
 */

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

/* ------------------------------------------------ route collisions ------- */

test("no dynamic API route is shadowed by a static sibling", () => {
  // `/api/admin/erp/inventory/export` matched BOTH `[module]/export` and
  // `inventory/[itemId]`. A static segment outranks a dynamic one, so the CSV
  // export resolved to the item-detail route and answered 400 "invalid UUID".
  const collisions: string[] = [];
  const walk = (dir: string) => {
    const entries = readdirSync(path.join(process.cwd(), dir), { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const dynamic = dirs.filter((d) => d.startsWith("[") && !d.startsWith("[..."));
    const statics = dirs.filter((d) => !d.startsWith("["));
    // A dynamic segment beside static siblings is fine on its own; the danger
    // is when the dynamic branch owns a child whose name equals a real request
    // that would instead be captured by the static sibling's own dynamic child.
    for (const dyn of dynamic) {
      for (const child of readdirSync(path.join(process.cwd(), dir, dyn), { withFileTypes: true })) {
        if (!child.isDirectory() || child.name.startsWith("[")) continue;
        for (const stat of statics) {
          const statDir = path.join(process.cwd(), dir, stat);
          const statChildren = readdirSync(statDir, { withFileTypes: true })
            .filter((e) => e.isDirectory() && e.name.startsWith("["));
          if (statChildren.length > 0) {
            collisions.push(`${dir}/${stat}/${statChildren[0].name} swallows ${dir}/${dyn}/${child.name}`);
          }
        }
      }
    }
    for (const d of dirs) walk(`${dir}/${d}`);
  };
  walk("app/api");
  assert.deepEqual(collisions, [], "a static route segment shadows a dynamic one");
});

test("the ERP CSV export lives where nothing can shadow it", () => {
  assert.ok(existsSync(path.join(process.cwd(), "app/api/admin/erp/export/[module]/route.ts")));
  assert.ok(
    !existsSync(path.join(process.cwd(), "app/api/admin/erp/[module]/export/route.ts")),
    "the export route moved back under [module], where `inventory` shadows it again",
  );
  // ...and the client asks for the path that actually exists.
  assert.match(read("components/admin/erp-workspace-manager.tsx"), /\/api\/admin\/erp\/export\/\$\{module\}/);
});

/* ------------------------------------------------ client contracts ------- */

test("a category payload the admin screen sends is a payload the server accepts", () => {
  // The screen sends imageUrl on create and update; both schemas are .strict(),
  // and neither listed it, so every category save answered 400 — while the
  // table, the service and the repository all supported the column.
  const sent = { name: "Ana Yemekler", imageUrl: "https://example.test/a.png", isActive: true, sortOrder: 2 };
  assert.equal(updateCategoryBodySchema.safeParse(sent).success, true, "update rejects the payload the UI sends");
  assert.equal(createCategoryBodySchema.safeParse(sent).success, true, "create rejects the payload the UI sends");
  // Null clears the cover, which is how the UI removes an image.
  assert.equal(updateCategoryBodySchema.safeParse({ imageUrl: null }).success, true);
  // Strictness is the point of the schema and must survive the fix.
  assert.equal(updateCategoryBodySchema.safeParse({ name: "x", bogus: 1 }).success, false);
  assert.equal(updateCategoryBodySchema.safeParse({}).success, false, "an empty update must still be rejected");
});

test("every literal payload the admin client sends is accepted by its schema", async () => {
  // Extracted from source rather than hand-listed, so a new call site that
  // invents a field fails here instead of in front of a user.
  const { updateProductBodySchema } = await import("../../lib/validation/admin-menu");
  const managers = ["categories-manager", "products-manager", "staff-manager", "tables-manager"];
  const seen: string[] = [];
  for (const name of managers) {
    const source = read(`components/admin/${name}.tsx`);
    for (const match of source.matchAll(/adminApi\.(update|create)(Category|Product)\([^,]*,?\s*\{([^}]*)\}/g)) {
      const keys = [...match[3].matchAll(/(\w+)\s*:/g)].map((k) => k[1]);
      if (keys.length === 0) continue;
      const schema = match[2] === "Category"
        ? (match[1] === "update" ? updateCategoryBodySchema : createCategoryBodySchema)
        : updateProductBodySchema;
      const shape = Object.keys((schema as unknown as { shape: object }).shape ?? {});
      for (const key of keys) {
        seen.push(key);
        assert.ok(shape.includes(key), `${name}: sends "${key}" but the schema does not accept it`);
      }
    }
  }
  assert.ok(seen.includes("imageUrl"), "the extraction stopped finding the field that caused the bug");
});

/* ------------------------------------------------ button semantics ------- */

test("a Button that navigates uses anchor semantics", () => {
  // Base UI warns when a native button element is rendered as an anchor.
  // Navigation gets nativeButton={false}; a real action keeps a real button.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(next); continue; }
      if (!next.endsWith(".tsx")) continue;
      const source = readFileSync(path.join(process.cwd(), next), "utf8");
      let cursor = source.indexOf("<Button");
      while (cursor !== -1) {
        const window = source.slice(cursor, cursor + 320);
        // The render prop carries its own `/>`, so the nested element has to be
        // flattened before the opening tag's own `>` can be found.
        const flattened = window.replace(/render=\{<[\s\S]*?\/>\}/g, "render={JSX}");
        const end = flattened.indexOf(">");
        const tag = end === -1 ? flattened : flattened.slice(0, end + 1);
        const navigates = /render=\{<(?:Link|a)\b/.test(window);
        if (navigates && !/nativeButton=\{false\}/.test(tag)) {
          offenders.push(`${next}: ${tag.replace(/\s+/g, " ").slice(0, 80)}`);
        }
        cursor = source.indexOf("<Button", cursor + 7);
      }
    }
  };
  walk("components");
  assert.deepEqual(offenders, [], "a navigating Button still renders as a native button");
});

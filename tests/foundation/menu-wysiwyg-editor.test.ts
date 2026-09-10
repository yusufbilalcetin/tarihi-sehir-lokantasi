import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * The administrator edits the menu on the menu.
 *
 * These are source guards, not pixel snapshots: what they hold is the shape of
 * the code that produces the screen. The one thing that must never come back
 * is a second copy of the customer menu — a preview panel, an iframe or a new
 * tab — because the moment there are two of them they start to disagree.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const editor = read("components/admin/customer-menu-editor.tsx");
const dialogs = [
  read("components/admin/menu-editor-dialogs.tsx"),
  read("components/admin/catalog-translation-editor.tsx"),
].join("\n");
const draft = read("components/admin/use-menu-draft.ts");
const sections = read("components/menu/menu-sections.tsx");
const experience = read("components/menu/menu-experience.tsx");
const categoryJump = read("components/menu/category-jump.tsx");

const ADMIN_MENU_SOURCES = [editor, dialogs, draft];

/* ------------------------------------------------ one menu, two modes ---- */

test("the editor is the customer menu, not a drawing of it", () => {
  // Both trees render the same component; neither owns section markup.
  assert.match(experience, /<MenuSections/);
  assert.match(editor, /<MenuSections/);
  assert.match(sections, /<ProductCard/);
  assert.match(sections, /<HighlightCard/);

  // The editor decorates through render props rather than re-implementing.
  assert.match(editor, /renderProductAction=/);
  assert.match(editor, /renderCategoryAction=/);
  assert.doesNotMatch(editor, /<ProductCard/, "the editor grew its own dish card");
  assert.doesNotMatch(editor, /<HighlightCard/, "the editor grew its own rail card");
});

test("the small phone-sized preview column is gone for good", () => {
  const adminDir = new URL("../../components/admin/", import.meta.url);
  const files = readdirSync(adminDir);
  assert.equal(
    files.includes("customer-menu-preview.tsx"),
    false,
    "the preview component came back",
  );
  for (const source of ADMIN_MENU_SOURCES) {
    assert.doesNotMatch(source, /max-w-\[390px\]/, "a phone-width preview column came back");
    assert.doesNotMatch(source, /Müşteri Menü Önizlemesi/, "the preview panel came back");
  }
});

test("no new tab and no iframe, anywhere in the editor", () => {
  for (const source of ADMIN_MENU_SOURCES) {
    assert.doesNotMatch(source, /window\.open/, "the editor opens a new tab");
    assert.doesNotMatch(source, /<iframe|createElement\("iframe"\)/, "the editor uses an iframe");
  }
  // One canonical route owns the editor; legacy URLs only redirect to it.
  const manager = read("components/admin/menu-manager.tsx");
  assert.match(manager, /<CustomerMenuEditor/);
  assert.doesNotMatch(manager, /window\.open|<iframe/);
  for (const route of ["categories", "products"]) {
    const page = read(`app/admin/${route}/page.tsx`);
    assert.match(page, /redirect\("\/admin\/menu"\)/);
    assert.doesNotMatch(page, /CustomerMenuEditor|ManagerModule/);
  }
});

/* ------------------------------------------------------- direct edit ----- */

test("touching a dish opens that dish", () => {
  // The card's own open and add handlers both lead to the product editor;
  // neither adds anything to a cart.
  assert.match(editor, /onOpenProduct=\{\(product\) => openProductEditor\(product\.id\)\}/);
  assert.match(editor, /onAddProduct=\{\(product\) => openProductEditor\(product\.id\)\}/);
  assert.match(editor, /<ProductEditDialog/);
});

test("new categories and products start from the editor toolbar", () => {
  assert.match(editor, /aria-label="Yeni kategori"/);
  assert.match(editor, /onClick=\{\(\) => void createCategory\(\)\}/);
  assert.match(editor, /aria-label="Yeni ürün"/);
  assert.match(editor, /onClick=\{\(\) => void createProduct\(\)\}/);
});

test("the product panel carries what a restaurant actually edits", () => {
  for (const label of [
    "Ürün Adı",
    "Fiyat",
    "Kategori",
    "Porsiyon / Gramaj",
    "Açıklama",
    "Etiketler",
    "Alerjenler",
    "Müşteri Menüsünde Göster",
    "Satışta",
    "Şefin Önerisi",
    "Fotoğrafı Değiştir",
  ]) {
    assert.ok(dialogs.includes(label), `the product panel lost "${label}"`);
  }
  // And none of the database's own bookkeeping.
  for (const internal of ["restaurantId", "createdAt", "updatedAt", "version", "slug"]) {
    assert.doesNotMatch(
      dialogs,
      new RegExp(`label="[^"]*${internal}`, "i"),
      `${internal} is exposed as a field`,
    );
  }
});

test("a draft carries only what changed", () => {
  // Re-sending an unchanged name makes the server recompute the slug, and two
  // dishes sharing a name then collide on a unique index.
  assert.match(dialogs, /const next: ProductDraft = \{\};/);
  assert.match(dialogs, /if \(name\.trim\(\) !== product\.name\) next\.name = name\.trim\(\);/);
  assert.match(dialogs, /const next: CategoryDraft = \{\};/);
  assert.match(dialogs, /if \(Object\.keys\(next\)\.length > 0\) onStage\(next\);/);

  // And the server answers a real collision plainly instead of failing.
  const service = read("lib/services/admin-menu-service.ts");
  assert.match(service, /Bu adda bir ürün zaten var\./);
  assert.match(service, /Bu adda bir kategori zaten var\./);
  assert.match(service, /candidate\.code === "23505"/);
});

/* --------------------------------------------------- category popover ---- */

test("the category popover reorders in admin mode and only there", () => {
  // One popover, two modes: the controls are an optional render prop.
  assert.match(categoryJump, /renderItemActions\?:/);
  assert.match(editor, /renderItemActions=\{\(category, index, total\)/);
  assert.match(editor, /yukarı taşı/);
  assert.match(editor, /aşağı taşı/);

  // The guest's menu passes none, so a guest can never be shown them.
  const jump = experience.slice(experience.indexOf("<CategoryJump"));
  assert.doesNotMatch(jump.slice(0, 200), /renderItemActions/);
});

test("reordering is drafted, then written in one transaction", () => {
  assert.match(draft, /setCategoryOrder\(\(current\) => \{/);
  assert.match(draft, /adminApi\.reorderMenu\(\{/);
  // Never a stream of pairwise swaps.
  assert.doesNotMatch(draft, /updateCategory\([^)]*sortOrder/);
});

/* ------------------------------------------------- customer stays pure --- */

test("the guest's menu shows no editing surface, ever", () => {
  const publicSources = [experience, sections, categoryJump, read("components/menu/product-card.tsx")];
  for (const source of publicSources) {
    for (const label of [
      "Düzenleme Modu",
      "Değişiklikleri Kaydet",
      "Gizlileri Göster",
      "Geri Al",
      "Kategoriyi Düzenle",
    ]) {
      assert.ok(!source.includes(label), `an editing label reached the guest's menu: ${label}`);
    }
  }
  // The public tree imports no admin module.
  for (const source of publicSources) {
    assert.doesNotMatch(source, /@\/components\/admin\//, "the customer menu imports admin code");
    assert.doesNotMatch(source, /adminApi/, "the customer menu reaches an admin endpoint");
  }
});

/* ----------------------------------------------------------- mobile ------ */

test("the editor is built for a phone first", () => {
  // A phone gets a sheet from the bottom edge; a desktop gets a window.
  assert.match(dialogs, /const isDesktop = useIsDesktop\(\);/);
  assert.match(dialogs, /side="bottom"/);
  assert.match(dialogs, /max-h-\[92dvh\]/);
  // The actions clear the home indicator and the keyboard.
  assert.match(dialogs, /env\(safe-area-inset-bottom\)/);
  assert.match(dialogs, /overflow-y-auto/);
  // Text inputs are large enough that iOS does not zoom the page.
  assert.match(dialogs, /text-base/);
  assert.match(dialogs, /inputMode="decimal"/);
});

test("every editing control is a real touch target", () => {
  // 44px: the reorder controls, the edit affordances and the toolbar actions.
  assert.match(editor, /size-11/);
  assert.match(editor, /min-h-11/);
  assert.match(dialogs, /min-h-11/);
});

test("the sticky stack is measured, never guessed", () => {
  // Three bars stack in the editor and every offset derives from these two.
  assert.match(editor, /\[--admin-topbar:4rem\] \[--menu-editor-bar:3rem\]/);
  assert.match(editor, /top-\[var\(--admin-topbar\)\]/);
  assert.match(editor, /top-\[calc\(var\(--admin-topbar\)\+var\(--menu-editor-bar\)\)\]/);
  assert.match(
    editor,
    /top-\[calc\(var\(--admin-topbar\)\+var\(--menu-editor-bar\)\+var\(--menu-header-height\)\)\]/,
  );
  // The public menu knows nothing about the admin bar.
  assert.doesNotMatch(categoryJump, /--admin-topbar|--menu-editor-bar/);
  assert.doesNotMatch(read("app/globals.css"), /--menu-editor-bar/);
});

test("the editor names the screen instead of inventing a table", () => {
  assert.match(editor, /Menü Düzenleme/);
  // Comments discuss the placeholder this replaced, so only the code is read.
  const code = editor.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert.doesNotMatch(code, /Masa --|Masa \{|tableName/, "the editor faked a table");
});

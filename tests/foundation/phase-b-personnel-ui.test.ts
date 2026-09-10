import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("Phase B routes keep one module heading and portal their real actions", () => {
  const moduleSource = read("components/admin/erp-workspace-module.tsx");
  const staffModule = read("components/admin/staff-module.tsx");
  const personnel = read("components/admin/personnel-workspace-manager.tsx");
  const staff = read("components/admin/staff-manager.tsx");

  assert.match(moduleSource, /<AdminModuleWindow[\s\S]*<PersonnelWorkspaceManager/);
  assert.match(staffModule, /title="Personel Listesi"/);
  assert.equal((personnel.match(/<h1\b/g) ?? []).length, 0);
  assert.equal((staff.match(/<h1\b/g) ?? []).length, 0);
  assert.match(personnel, /<AdminPageHeader/);
  assert.match(staff, /<AdminPageHeader/);
});

test("staff list has semantic desktop rows and a separate narrow-screen representation", () => {
  const source = read("components/admin/staff-manager.tsx");
  assert.match(source, /<table[\s\S]*<th scope="col"[\s\S]*<tbody/);
  assert.match(source, /hidden overflow-x-auto md:block/);
  assert.match(source, /divide-y divide-border md:hidden/);
  assert.match(source, /PersonnelActionMenu[\s\S]*işlemleri/);
  assert.doesNotMatch(source, /bg-olive|text-burgundy|border-copper/);
});

test("Phase B status and row actions carry text and keyboard-capable menu semantics", () => {
  const source = read("components/admin/personnel-ui.tsx");
  assert.match(source, /<Menu\.Root>/);
  assert.match(source, /<Menu\.Trigger[\s\S]*aria-label=\{label\}/);
  assert.match(source, /<Menu\.Item/);
  assert.match(source, /\{label\}/);
});

test("personnel workspaces preserve real mutations and only the supported export", () => {
  const source = read("components/admin/personnel-workspace-manager.tsx");
  for (const command of ["CORRECT_ATTENDANCE", "CREATE_SCHEDULE", "SET_SCHEDULE_STATUS", "UPSERT_PAYROLL"]) {
    assert.match(source, new RegExp(`command: "${command}"`));
  }
  assert.match(source, /export\/attendance/);
  assert.doesNotMatch(source, /export\/(?:schedules|payroll)/);
});

test("weekly schedule bounds its seven-day overflow inside the schedule panel", () => {
  const source = read("components/admin/personnel-workspace-manager.tsx");
  assert.match(source, /max-w-full overflow-x-auto overscroll-x-contain/);
  for (const day of ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"]) {
    assert.match(source, new RegExp(`"${day}"`));
  }
  assert.match(source, /md:hidden/);
});

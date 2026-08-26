import assert from "node:assert/strict";
import test from "node:test";

import { escapeCsvCell, toCsv } from "../../lib/domain/csv";

test("ordinary values are quoted, not altered", () => {
  assert.equal(escapeCsvCell("Kuru Fasulye"), '"Kuru Fasulye"');
  assert.equal(escapeCsvCell(1250), '"1250"');
  assert.equal(escapeCsvCell(null), '""');
  assert.equal(escapeCsvCell(undefined), '""');
});

test("embedded quotes and separators survive a round trip", () => {
  assert.equal(escapeCsvCell('Ürün "özel"'), '"Ürün ""özel"""');
  assert.equal(escapeCsvCell("Fasulye, Pilav"), '"Fasulye, Pilav"');
  assert.equal(escapeCsvCell("İki\nSatır"), '"İki\nSatır"');
});

test("a cell that a spreadsheet would execute is neutralised", () => {
  // A product renamed to a formula must never run when the file is opened.
  for (const dangerous of [
    "=1+1",
    "+SUM(A1:A9)",
    "-2+3",
    "@SUM(A1)",
    '=HYPERLINK("http://evil.example","tıkla")',
  ]) {
    const cell = escapeCsvCell(dangerous);
    assert.equal(cell.startsWith(`"'`), true, `${dangerous} was not neutralised`);
    assert.equal(cell.includes(dangerous.replaceAll('"', '""')), true, "the text is preserved");
  }
});

test("a leading tab or carriage return is neutralised too", () => {
  assert.equal(escapeCsvCell("\t=1+1").startsWith(`"'`), true);
  assert.equal(escapeCsvCell("\r=1+1").startsWith(`"'`), true);
});

test("a value that merely contains a trigger is left alone", () => {
  // Only a leading trigger matters; a hyphen inside a name is ordinary text.
  assert.equal(escapeCsvCell("Ayran-2"), '"Ayran-2"');
  assert.equal(escapeCsvCell("info@restoran.com"), '"info@restoran.com"');
});

test("the product export carries the columns the report promises", () => {
  const csv = toCsv(
    ["Ürün", "Kategori", "Adet", "Brüt", "İptal", "Void", "Net"],
    [
      ["Kuru Fasulye", "Ana Yemek", 4850, "1212500.00", 12, 3, "1212500.00"],
      ["=Pilav", "Ana Yemek", 4210, "631500.00", 0, 0, "631500.00"],
    ],
  );

  const lines = csv.split("\r\n");
  assert.equal(lines[0]?.includes('"Ürün","Kategori","Adet"'), true);
  assert.equal(lines[1]?.startsWith('"Kuru Fasulye"'), true);
  assert.equal(lines[2]?.startsWith(`"'=Pilav"`), true, "the export is injection safe");
  // A BOM keeps Turkish characters readable in Excel.
  assert.equal(csv.startsWith("﻿"), true);
});

test("an empty result still produces a valid header row", () => {
  const csv = toCsv(["Ürün", "Adet"], []);
  assert.equal(csv, '﻿"Ürün","Adet"\r\n');
});

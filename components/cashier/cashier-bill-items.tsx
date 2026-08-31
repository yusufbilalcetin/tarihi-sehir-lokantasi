"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import type { Order } from "@/types";

/**
 * What the guest is paying for.
 *
 * A four-column table needs about 544px to stay readable, so on a phone it was
 * a horizontal scroller inside the one panel a cashier has to read carefully
 * before taking money. Technically it never overflowed the page; practically it
 * meant sliding a table sideways to check a line against a bill in your hand.
 *
 * The phone gets rows instead — quantity and product on one line, the line
 * total right-aligned under it — and the table survives from `sm` up, where
 * there is genuinely room for four columns.
 */
export function CashierBillItems({ items }: { readonly items: Order["items"] }) {
  return (
    <>
      {/* ---------------------------------- phone ---------------------------- */}
      <ul className="divide-y divide-border sm:hidden" aria-label="Sipariş kalemleri">
        {items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                <span className="tabular-nums text-burgundy">{item.quantity}×</span>{" "}
                {item.productName}
              </p>
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {formatCurrency(item.unitPrice)} / adet
              </p>
              {item.note ? (
                <p className="mt-0.5 text-xs text-burgundy">Not: {item.note}</p>
              ) : null}
            </div>
            <p className="shrink-0 text-sm font-bold tabular-nums text-foreground">
              {formatCurrency(item.quantity * item.unitPrice)}
            </p>
          </li>
        ))}
      </ul>

      {/* ------------------------------ tablet and up ------------------------ */}
      <Table className="mt-2 hidden sm:table">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-0">Ürün</TableHead>
            <TableHead className="w-20 text-center">Adet</TableHead>
            <TableHead className="w-28 text-right">Birim</TableHead>
            <TableHead className="w-28 pr-0 text-right">Tutar</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="pl-0 whitespace-normal">
                <span className="font-semibold text-foreground">{item.productName}</span>
                {item.note ? (
                  <span className="mt-0.5 block text-xs text-burgundy">Not: {item.note}</span>
                ) : null}
              </TableCell>
              <TableCell className="text-center font-bold tabular-nums">{item.quantity}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatCurrency(item.unitPrice)}
              </TableCell>
              <TableCell className="pr-0 text-right font-bold tabular-nums">
                {formatCurrency(item.quantity * item.unitPrice)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

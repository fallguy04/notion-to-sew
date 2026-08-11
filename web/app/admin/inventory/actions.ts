"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { ok, fail, explain, type ActionResult } from "@/lib/action-result";
import {
  addProduct,
  restockProduct,
  updateProduct,
  setStockCount,
  importProducts,
  addExpense,
  type ImportRow,
} from "@/lib/mutations";
import { getStockHistory, getProduct } from "@/lib/queries";
import { money, today as shopToday } from "@/lib/format";

const num = (v: FormDataEntryValue | null, fallback = 0) => {
  const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : fallback;
};
const optNum = (v: FormDataEntryValue | null) => {
  const n = num(v, 0);
  return n > 0 ? n : null;
};

function touch(sku?: string) {
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/pos");
  revalidatePath("/kiosk");
  revalidatePath("/admin");
  if (sku) revalidatePath(`/admin/inventory/${sku}`);
}

export async function createProductAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const sku = String(form.get("sku") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    if (!sku) return fail("An item number is required.");
    if (!name) return fail("A name is required.");

    const existing = await getProduct(sku);
    if (existing) {
      // The single most expensive mistake in the old data: four different books
      // all filed under the SKU "Book", ringing up at the first one's price.
      return fail(
        `${sku} already exists — it's "${existing.name}". Restock that instead, or give this one its own item number.`,
      );
    }

    const stock = Math.round(num(form.get("stock")));
    const cost = optNum(form.get("cost"));

    await addProduct({
      sku,
      name,
      price: num(form.get("price")),
      stock,
      wholesalePrice: optNum(form.get("wholesale_price")),
      cost,
      vendor: String(form.get("vendor") ?? "").trim(),
      category: String(form.get("category") ?? "").trim(),
    });

    let extra = "";
    if (form.get("log_expense") === "on" && cost && stock > 0) {
      const total = cost * stock;
      await addExpense({
        spentOn: String(form.get("expense_date") ?? "") || shopToday(),
        category: "Inventory Purchase",
        amount: total,
        description: `Opening stock for ${name} (${sku})`,
      });
      revalidatePath("/admin/financials");
      extra = ` and logged ${money(total)} as an inventory purchase`;
    }

    touch(sku);
    return ok(`${name} created${extra}.`);
  } catch (e) {
    return fail(explain(e));
  }
}

export async function restockAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const sku = String(form.get("sku") ?? "").trim();
    if (!sku) return fail("Pick an item first.");

    const qty = Math.round(num(form.get("qty")));
    if (qty === 0) return fail("Enter how many arrived.");

    const cost = optNum(form.get("cost"));
    const done = await restockProduct(sku, qty, cost);
    if (!done) {
      return fail(`No item has the number ${sku}. Use "Add a new item" to create it.`);
    }

    const product = await getProduct(sku);
    let extra = "";
    if (form.get("log_expense") === "on" && cost && qty > 0) {
      const total = cost * qty;
      await addExpense({
        spentOn: String(form.get("expense_date") ?? "") || shopToday(),
        category: "Inventory Purchase",
        amount: total,
        description: `Restocked ${product?.name ?? sku} (${sku})`,
      });
      revalidatePath("/admin/financials");
      extra = ` and logged ${money(total)} as an inventory purchase`;
    }

    touch(sku);
    return ok(
      `${qty > 0 ? "Added" : "Removed"} ${Math.abs(qty)} — ${product?.name ?? sku} is now at ${
        product?.stock_qty ?? "?"
      }${extra}.`,
    );
  } catch (e) {
    return fail(explain(e));
  }
}

export async function saveProductAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const sku = String(form.get("sku") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    if (!sku) return fail("Missing item.");
    if (!name) return fail("A name is required.");

    const done = await updateProduct(sku, {
      name,
      price: num(form.get("price")),
      wholesalePrice: optNum(form.get("wholesale_price")),
      cost: optNum(form.get("cost")),
      vendor: String(form.get("vendor") ?? "").trim(),
      category: String(form.get("category") ?? "").trim(),
      active: form.get("active") === "on",
    });
    if (!done) return fail("That item no longer exists.");

    touch(sku);
    return ok("Saved.");
  } catch (e) {
    return fail(explain(e));
  }
}

export async function countStockAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const sku = String(form.get("sku") ?? "").trim();
    const counted = Math.round(num(form.get("counted")));
    if (!sku) return fail("Missing item.");
    const done = await setStockCount(sku, counted, String(form.get("note") ?? "").trim() || undefined);
    if (!done) return fail("That item no longer exists.");
    touch(sku);
    return ok(`Set to ${counted} on hand.`);
  } catch (e) {
    return fail(explain(e));
  }
}

export type BulkEdit = {
  sku: string;
  price?: number;
  cost?: number | null;
  wholesalePrice?: number | null;
  stock?: number;
};

/**
 * Editing many rows at once, replacing the old spreadsheet-style grid.
 *
 * The grid let you retype anything including the SKU, which is how the same
 * item ended up in the book twice. Here the identity of a row is fixed and only
 * the numbers can move. A stock change goes through the same counted-adjustment
 * path as a stocktake, so the ledger still explains every on-hand figure rather
 * than having values appear from nowhere.
 */
export async function bulkUpdateAction(edits: BulkEdit[]): Promise<ActionResult> {
  try {
    await requireStaff();
    if (!Array.isArray(edits) || edits.length === 0) return fail("Nothing changed.");
    if (edits.length > 500) return fail("That's a lot at once — save in smaller batches.");

    let changed = 0;
    const missing: string[] = [];

    for (const e of edits) {
      const current = await getProduct(e.sku);
      if (!current) {
        missing.push(e.sku);
        continue;
      }
      const price = e.price ?? current.price;
      const cost = e.cost === undefined ? current.cost : e.cost;
      const wholesale =
        e.wholesalePrice === undefined ? current.wholesale_price : e.wholesalePrice;

      if (price < 0 || (cost ?? 0) < 0 || (wholesale ?? 0) < 0) {
        return fail(`${e.sku}: prices can't be negative.`);
      }

      await updateProduct(e.sku, {
        name: current.name,
        price,
        wholesalePrice: wholesale,
        cost,
        vendor: current.vendor ?? "",
        category: current.category ?? "",
        active: current.active,
      });

      if (e.stock !== undefined && Math.round(e.stock) !== current.stock_qty) {
        await setStockCount(e.sku, Math.round(e.stock), "corrected in bulk edit");
      }
      changed++;
    }

    touch();
    if (missing.length) {
      return ok(
        `${changed} item${changed === 1 ? "" : "s"} saved. ${missing.length} no longer exist and were skipped.`,
      );
    }
    return ok(`${changed} item${changed === 1 ? "" : "s"} saved.`);
  } catch (e) {
    return fail(explain(e));
  }
}

export async function historyAction(sku: string) {
  await requireStaff();
  return getStockHistory(sku, 30);
}

/**
 * Bulk import from a pasted or uploaded CSV.
 *
 * Parsed and reported on before anything is written, because the old importer
 * concatenated the file onto the sheet and told you afterwards.
 */
export type ImportPreview = {
  ok: boolean;
  message: string;
  rows: ImportRow[];
  problems: string[];
  newCount: number;
  updateCount: number;
};

export async function previewImportAction(csv: string): Promise<ImportPreview> {
  try {
    await requireStaff();
    const { rows, problems } = parseCsv(csv);
    if (rows.length === 0) {
      return {
        ok: false,
        message: problems[0] ?? "Nothing to import — the file had no data rows.",
        rows: [],
        problems,
        newCount: 0,
        updateCount: 0,
      };
    }
    const existing = await Promise.all(rows.map((r) => getProduct(r.sku)));
    const updateCount = existing.filter(Boolean).length;
    return {
      ok: true,
      message: `${rows.length} row${rows.length === 1 ? "" : "s"} ready.`,
      rows,
      problems,
      newCount: rows.length - updateCount,
      updateCount,
    };
  } catch (e) {
    return {
      ok: false,
      message: explain(e),
      rows: [],
      problems: [],
      newCount: 0,
      updateCount: 0,
    };
  }
}

export async function commitImportAction(rows: ImportRow[]): Promise<ActionResult> {
  try {
    await requireStaff();
    if (!Array.isArray(rows) || rows.length === 0) return fail("Nothing to import.");
    if (rows.length > 5000) return fail("That's more than 5,000 rows — split the file up.");
    const { inserted, updated } = await importProducts(rows);
    touch();
    return ok(`${inserted} item${inserted === 1 ? "" : "s"} created, ${updated} updated.`);
  } catch (e) {
    return fail(explain(e));
  }
}

/** Small enough to hand-roll, and quoted fields with commas are common in item names. */
function parseCsv(text: string): { rows: ImportRow[]; problems: string[] } {
  const problems: string[] = [];
  const lines = splitRows(text.trim());
  if (lines.length < 2) return { rows: [], problems: ["The file needs a header row and at least one item."] };

  const header = lines[0].map((h) => h.trim().toLowerCase().replace(/[\s_]/g, ""));
  const at = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iSku = at("sku", "itemnumber", "item", "part", "partnumber");
  const iName = at("name", "description", "productname", "item name");
  const iPrice = at("price", "retail", "retailprice");
  const iStock = at("stockqty", "stock", "qty", "quantity", "onhand");
  const iWhole = at("wholesaleprice", "wholesale");
  const iCost = at("cost", "unitcost");

  if (iSku < 0) problems.push("No SKU column found — the header needs a column called SKU.");
  if (iName < 0) problems.push("No Name column found.");
  if (iSku < 0 || iName < 0) return { rows: [], problems };

  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i];
    if (cells.every((c) => !c.trim())) continue;
    const sku = (cells[iSku] ?? "").trim();
    const name = (cells[iName] ?? "").trim();
    if (!sku || !name) {
      problems.push(`Row ${i + 1} skipped — it needs both a SKU and a name.`);
      continue;
    }
    if (seen.has(sku.toLowerCase())) {
      problems.push(`Row ${i + 1} skipped — ${sku} appears more than once in this file.`);
      continue;
    }
    seen.add(sku.toLowerCase());
    rows.push({
      sku,
      name,
      price: toNum(cells[iPrice]),
      stock: Math.round(toNum(cells[iStock])),
      wholesalePrice: iWhole >= 0 && toNum(cells[iWhole]) > 0 ? toNum(cells[iWhole]) : null,
      cost: iCost >= 0 && toNum(cells[iCost]) > 0 ? toNum(cells[iCost]) : null,
    });
  }
  return { rows, problems };
}

function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const toNum = (v: string | undefined) => {
  const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

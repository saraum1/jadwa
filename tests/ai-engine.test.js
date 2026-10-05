import test from "node:test";
import assert from "node:assert/strict";
import { analyze, fromFiles, forAI } from "../src/features/ai/engine.js";
import { catalogProducts, catalogStock, stockMetrics } from "../src/shared/data/catalog.js";
import { expenseRecords, expenseDate } from "../src/shared/data/expenses.js";

// نفس تحويل dataset.js للبيانات التوضيحية، بدون استيراد خدمات Supabase
function demo(key, period) {
  return {
    source: "demo", period,
    products: catalogProducts.map((p) => ({ code: p.code, name: p.name, qty: p[key].qty, sales: p[key].sales, cost: p[key].cost })),
    inventory: catalogStock.map((p) => { const s = stockMetrics(p, key); return { code: p.code, name: p.name, unit: p.unit, opening: s.opening, incoming: s.incoming, used: s.used, waste: s.waste, adjustment: s.adjustment, unitCost: s.cost }; }),
    expenses: expenseRecords.filter((r) => r[key] != null).map((r) => ({ date: expenseDate(r, key), name: r.name, amount: r[key], vendor: r.vendor, category: r.category, categoryId: r.category, recurring: r.recurring })),
    daily: null, weekly: null, has: { sales: true, costs: true, inventory: true, expenses: true },
  };
}

test("AI engine reproduces demo totals and computes losses from data", () => {
  const f = analyze(demo("sep", "2026-09"), demo("aug", "2026-08"));
  assert.equal(f.summary.revenue, 48000);
  assert.equal(f.summary.totalCost, 36000);
  assert.equal(f.summary.profit, 12000);
  assert.equal(f.losses.total, f.decisions.reduce((s, d) => s + d.lossAmount, 0));
  assert.ok(f.decisions.length > 0);
  for (const d of f.decisions) for (const k of ["problem", "cause", "decision", "basis"]) assert.ok(d[k], k);
  assert.ok(f.dataGaps.some((g) => g.includes("الورديات")), "staffing gap is declared, not invented");
});

test("AI engine analyses uploaded files without double counting losing products", () => {
  const v = (rows) => rows.map((values) => ({ values }));
  const days = [...Array(30)].map((_, i) => "2026-09-" + String(i + 1).padStart(2, "0"));
  const files = [
    { type: "sales", name: "s", result: { period: "2026-09", valid: v(days.map((date) => ({ date, code: "P1", name: "كروسان", qty: 10, sales: 60 }))) } },
    { type: "costs", name: "c", result: { period: "2026-09", valid: v([{ period: "2026-09", code: "P1", unitCost: 8, totalCost: "" }]) } },
    { type: "inventory", name: "i", result: { period: "2026-09", valid: v([{ date: "2026-09-28", code: "M1", name: "زبدة", unit: "كجم", opening: 10, incoming: 50, used: 30, waste: 12, adjustment: 0, unitCost: 35 }]) } },
  ];
  const f = analyze(fromFiles("2026-09", files), null);
  const losing = f.decisions.find((d) => d.category === "losing_product");
  assert.equal(losing.lossAmount, 600); // (8 − 6) × 300
  assert.equal(f.decisions.find((d) => d.category === "waste").lossAmount, 420);
  assert.ok(f.dataGaps.some((g) => g.includes("المصروفات")));
  assert.ok(f.weekdays.length === 7);
  assert.ok(JSON.stringify(forAI(f)).length < 60000);
});

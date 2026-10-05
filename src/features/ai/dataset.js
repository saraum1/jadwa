/*
 * مصدر بيانات العقل: يحوّل بيانات المنشأة (Supabase أو الزائر) إلى dataset للمحرك.
 * الترتيب: ملفات مركز البيانات للفترة ← جداول Supabase للمستخدم المسجّل ← البيانات التوضيحية للزائر.
 * لا يغيّر أي صفحة أو رقم معروض؛ يستخدمه الشات والاجتماع فقط.
 */
import { analyze, fromFiles, previousPeriod } from "./engine.js";
import { catalogProducts, catalogStock, stockMetrics } from "../../shared/data/catalog.js";
import { expenseRecords, expenseCategories, expenseDate } from "../../shared/data/expenses.js";
import { months } from "../../shared/data/demo.js";
import { authService } from "../auth/services/authService.js";
import { dataHubService } from "../data-hub/services/dataHubService.js";
import { JadwaSession } from "../../shared/lib/session.js";
import { catalogService } from "../catalog/services/catalogService.js";
import { expensesService } from "../expenses/services/expensesService.js";

const MONTH_CODES = { "2026-09": "sep", "2026-08": "aug" };
const categoryName = (id) => (expenseCategories.find((c) => c.id === id) || {}).name || id || "غير مصنف";

export function demoDataset(period) {
  const key = MONTH_CODES[period];
  if (!key) return null;
  const products = catalogProducts.map((p) => ({ code: p.code, name: p.name, qty: p[key].qty, sales: p[key].sales, cost: p[key].cost }));
  const inventory = catalogStock.map((p) => {
    const s = stockMetrics(p, key);
    return { code: p.code, name: p.name, unit: p.unit, opening: s.opening, incoming: s.incoming, used: s.used, waste: s.waste, adjustment: s.adjustment, unitCost: s.cost };
  });
  const expenses = expenseRecords
    .filter((r) => r[key] !== null && r[key] !== undefined)
    .map((r) => ({ date: expenseDate(r, key), name: r.name, amount: r[key], vendor: r.vendor, category: categoryName(r.category), categoryId: r.category, recurring: r.recurring }));
  return {
    source: "demo", period, products, inventory, expenses, daily: null, weekly: months[key]?.sales || null,
    has: { sales: true, costs: true, inventory: inventory.length > 0, expenses: expenses.length > 0 },
  };
}

async function databaseDataset(period) {
  const key = MONTH_CODES[period];
  if (!key) return null; // خدمات الجداول الحالية تدعم سبتمبر وأغسطس 2026 فقط
  const [products, inventory, expenses] = await Promise.all([
    catalogService.getProducts(key, false),
    catalogService.getInventory(key, false),
    expensesService.getExpenseRecords(key, false),
  ]);
  const sold = products.filter((p) => p.qty || p.sales);
  const moved = inventory.filter((i) => i.opening || i.incoming || i.used || i.waste);
  if (!sold.length && !moved.length && !expenses.length) return null;
  return {
    source: "database", period,
    products: sold.map((p) => ({ code: p.code, name: p.name, qty: p.qty, sales: p.sales, cost: p.cost || p.cost === 0 ? p.cost : null })),
    inventory: moved.map((i) => ({ code: i.code, name: i.name, unit: i.unit, opening: i.opening, incoming: i.incoming, used: i.used, waste: i.waste, adjustment: i.adjustment, unitCost: i.cost })),
    expenses: expenses.map((e) => ({ date: e.date, name: e.name, amount: e.amount, vendor: e.vendor, category: categoryName(e.category), categoryId: e.category, recurring: e.recurring })),
    daily: null, weekly: null,
    has: { sales: sold.length > 0, costs: sold.some((p) => p.cost), inventory: moved.length > 0, expenses: expenses.length > 0 },
  };
}

async function datasetFor(period, isGuest) {
  let files = await dataHubService.getFiles(period, isGuest).catch(() => []);
  // لو ما انحفظت الملفات في Supabase، نستخدم الملفات المجهزة في هذا التبويب
  if (!files.length) files = JadwaSession.forPeriod(period);
  if (files.length) return fromFiles(period, files);
  if (isGuest) return demoDataset(period);
  return databaseDataset(period).catch(() => null);
}

/** يحسب نتائج التحليل للفترة. يرجع null إذا لا توجد بيانات. */
export async function loadFacts(period) {
  const user = await authService.getCurrentUser().catch(() => null);
  const isGuest = !user || Boolean(user.isGuest);
  const ds = await datasetFor(period, isGuest);
  if (!ds) return null;
  const prev = await datasetFor(previousPeriod(period), isGuest);
  const facts = analyze(ds, prev);
  facts.business = user?.profile?.businessName || null;
  return facts;
}

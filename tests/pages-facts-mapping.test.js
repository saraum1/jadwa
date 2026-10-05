import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fromFiles, analyze, forAI } from "../src/features/ai/engine.js";
import { mapExpenseCategory } from "../src/shared/data/expenses.js";
import { getSourceLabel } from "../src/features/ai/usePeriodFacts.js";
import { marginTarget } from "../src/shared/data/catalog.js";

// Load September 2026 test files fixture
const fixturePath = path.resolve("./tests/fixtures/september-2026-files.json");
const files = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

test("September 2026 files fixture loads exactly sales 150, costs 5, inventory 5, expenses 7", () => {
  const salesFile = files.find((f) => f.type === "sales");
  const costsFile = files.find((f) => f.type === "costs");
  const invFile = files.find((f) => f.type === "inventory");
  const expFile = files.find((f) => f.type === "expenses");

  assert.equal(salesFile.result.valid.length, 150, "Sales must have 150 rows");
  assert.equal(costsFile.result.valid.length, 5, "Costs must have 5 rows");
  assert.equal(invFile.result.valid.length, 5, "Inventory must have 5 rows");
  assert.equal(expFile.result.valid.length, 7, "Expenses must have 7 rows");
});

test("Dashboard page metrics mapped from facts: revenue 41,470 · total cost 43,261 · profit -1,791 · saving 2,391", () => {
  const ds = fromFiles("2026-09", files);
  const facts = analyze(ds, null);

  assert.equal(facts.summary.revenue, 41470, "Revenue should be 41,470");
  assert.equal(facts.summary.totalCost, 43261, "Total cost should be 43,261");
  assert.equal(facts.summary.profit, -1791, "Profit should be -1,791");
  assert.equal(facts.losses.expectedSaving, 2391, "Expected saving should be 2,391");

  // Weekly sales
  assert.ok(Array.isArray(facts.weeklySales), "Weekly sales array exists");
  assert.equal(facts.weeklySales.length, 4, "Weekly sales has 4 weeks");
  const sumWeekly = facts.weeklySales.reduce((s, v) => s + v, 0);
  assert.equal(sumWeekly, 41470, "Sum of weekly sales matches total revenue");

  // Opportunity cards top 3
  const top3 = facts.decisions.slice(0, 3);
  assert.equal(top3.length, 3, "Top 3 decisions for dashboard opportunity cards");
  assert.equal(top3[0].id, "product-PR-101");
  assert.equal(top3[0].saving, 1072);
  assert.equal(top3[1].id, "waste");
  assert.equal(top3[1].saving, 939);
  assert.equal(top3[2].id, "subscriptions");
  assert.equal(top3[2].saving, 380);
});

test("Losses and Ask Jadwa consistency: total 2,704 = product 1,072 + waste 1,252 + duplicate subscriptions 380", () => {
  const ds = fromFiles("2026-09", files);
  const facts = analyze(ds, null);

  const productLoss = facts.decisions.find((d) => d.category === "losing_product");
  const wasteLoss = facts.decisions.find((d) => d.category === "waste");
  const subLoss = facts.decisions.find((d) => d.category === "duplicate_subscription");

  assert.ok(productLoss, "Losing product decision exists");
  assert.ok(wasteLoss, "Waste decision exists");
  assert.ok(subLoss, "Duplicate subscription decision exists");

  assert.equal(productLoss.lossAmount, 1072, "Losing product loss amount 1,072");
  assert.equal(wasteLoss.lossAmount, 1252, "Waste loss amount 1,252");
  assert.equal(subLoss.lossAmount, 380, "Duplicate subscriptions loss amount 380");

  const totalLoss = productLoss.lossAmount + wasteLoss.lossAmount + subLoss.lossAmount;
  assert.equal(totalLoss, 2704, "Total losses sum to 2,704");
  assert.equal(facts.losses.total, 2704, "facts.losses.total matches 2,704");

  // Ask Jadwa (AI context) receives the exact same facts
  const aiFacts = forAI(facts);
  assert.equal(aiFacts.losses.total, 2704, "AI facts losses total must match 2,704");
  assert.equal(aiFacts.summary.revenue, 41470, "AI facts revenue matches");
  assert.equal(aiFacts.summary.profit, -1791, "AI facts profit matches");
});

test("Products and Inventory page mapping: croissant marked as loss (avg price 6, unit cost 8), fresh milk waste 110L = 770 SAR", () => {
  const ds = fromFiles("2026-09", files);
  const facts = analyze(ds, null);

  // Products mapping
  const croissant = facts.products.find((p) => p.name.includes("كروسان زبدة"));
  assert.ok(croissant, "كروسان زبدة exists in products");
  assert.equal(croissant.avgPrice, 6, "Average price is 6");
  assert.equal(croissant.unitCost, 8, "Unit cost is 8");
  assert.equal(croissant.sales, 3216);
  assert.equal(croissant.cost, 4288);
  assert.equal(croissant.profit, -1072);
  assert.equal(croissant.margin, -33.3);

  // Status computation check
  let croissantStatus = "normal";
  if (croissant.cost === null) croissantStatus = "missing";
  else if (croissant.profit !== null && croissant.profit < 0) croissantStatus = "loss";
  else if (croissant.margin !== null && croissant.margin < marginTarget) croissantStatus = "low";
  assert.equal(croissantStatus, "loss", "Croissant must be marked as loss");

  // Inventory mapping
  const milk = facts.inventory.find((i) => i.name.includes("حليب طازج"));
  assert.ok(milk, "حليب طازج exists in inventory");
  assert.equal(milk.waste, 110, "Milk waste is 110 L");
  assert.equal(milk.unit, "لتر", "Milk unit is لتر");
  assert.equal(milk.unitCost, 7, "Milk unit cost is 7");
  assert.equal(milk.wasteCost, 770, "Milk waste cost is 110 * 7 = 770 SAR");
  assert.equal(milk.wasteRatePct, 17.5, "Milk waste rate is 17.5%");

  let milkStatus = "normal";
  if (milk.wasteCost > 0 || milk.waste > 0) milkStatus = "waste";
  assert.equal(milkStatus, "waste", "Milk must be marked with waste status");
});

test("Expenses page mapping: total 18,240 and category mapping from Arabic text", () => {
  const ds = fromFiles("2026-09", files);
  const facts = analyze(ds, null);

  assert.equal(facts.expenses.total, 18240, "Total expenses must equal 18,240");
  assert.equal(facts.expenses.items.length, 7, "Must have 7 expense items");

  // Category mapping function tests
  assert.equal(mapExpenseCategory("إيجار"), "rent");
  assert.equal(mapExpenseCategory("ايجار المحل"), "rent");
  assert.equal(mapExpenseCategory("رواتب"), "payroll");
  assert.equal(mapExpenseCategory("راتب العامل"), "payroll");
  assert.equal(mapExpenseCategory("خدمات"), "utilities");
  assert.equal(mapExpenseCategory("فاتورة كهرباء"), "utilities");
  assert.equal(mapExpenseCategory("مياه"), "utilities");
  assert.equal(mapExpenseCategory("اشتراكات"), "software");
  assert.equal(mapExpenseCategory("تطبيق توصيل"), "software");
  assert.equal(mapExpenseCategory("برمجيات"), "software");
  assert.equal(mapExpenseCategory("تسويق"), "marketing");
  assert.equal(mapExpenseCategory("إعلانات سناب"), "marketing");
  assert.equal(mapExpenseCategory("نثريات متنوعة"), "unclassified");

  // Test mapping of all 7 items
  const mappedItems = facts.expenses.items.map((e) => ({
    name: e.name,
    amount: e.amount,
    category: mapExpenseCategory(e.category),
    recurring: e.recurring,
  }));

  const byCategory = {};
  for (const item of mappedItems) {
    byCategory[item.category] = (byCategory[item.category] || 0) + item.amount;
  }

  assert.equal(byCategory.rent, 6000, "Rent total is 6,000");
  assert.equal(byCategory.payroll, 9000, "Payroll total is 9,000");
  assert.equal(byCategory.utilities, 1760, "Utilities total is 1,760 (1500+260)");
  assert.equal(byCategory.software, 830, "Software subscriptions total is 830 (450+380)");
  assert.equal(byCategory.marketing, 650, "Marketing total is 650");

  const totalCalculated = Object.values(byCategory).reduce((a, b) => a + b, 0);
  assert.equal(totalCalculated, 18240, "Sum of all categories equals 18,240");
});

test("Source label helper produces exact localized Arabic badges", () => {
  assert.equal(getSourceLabel("files"), "من ملفاتك المرفوعة");
  assert.equal(getSourceLabel("database"), "بيانات حسابك");
  assert.equal(getSourceLabel("demo"), "بيانات توضيحية");
});

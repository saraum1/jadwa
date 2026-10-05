import test from "node:test";
import assert from "node:assert/strict";
import { toDataHubFileDTO } from "../src/shared/types/dto.js";
import { fromFiles, analyze } from "../src/features/ai/engine.js";

test("toDataHubFileDTO normalizes raw database rows with Arabic headers for AI engine", () => {
  const dbRows = [
    {
      id: "3b809427-32ae-4412-889f-f0d8066ab518",
      file_name: "costs_sep_2026.csv",
      file_type: "costs",
      period_key: "2026-09",
      origin: "upload",
      headers: ["المنتج", "التكلفة للوحدة"],
      mapping: { product: "المنتج", unit_cost: "التكلفة للوحدة" },
      valid_count: 2,
      invalid_count: 0,
      issues: [],
      valid_rows: [
        { "المنتج": "لاتيه", "التكلفة للوحدة": 7.2 },
        { "المنتج": "ساندويتش دجاج", "التكلفة للوحدة": 12.5 },
      ],
    },
    {
      id: "400f4463-a33b-4986-a02d-861b1ddfa7d8",
      file_name: "inventory_sep_2026.xlsx",
      file_type: "inventory",
      period_key: "2026-09",
      origin: "upload",
      headers: ["الصنف", "رصيد أول", "وارد", "مستخدم", "هدر"],
      mapping: { item: "الصنف", used: "مستخدم", waste: "هدر", opening: "رصيد أول", incoming: "وارد" },
      valid_count: 2,
      invalid_count: 0,
      issues: [],
      valid_rows: [
        { "هدر": 1.5, "وارد": 60, "الصنف": "حبوب قهوة", "مستخدم": 56, "رصيد أول": 18 },
        { "هدر": 28, "وارد": 420, "الصنف": "حليب", "مستخدم": 395, "رصيد أول": 40 },
      ],
    },
    {
      id: "5dc03e04-1d66-49ec-bc0d-115d584b1c24",
      file_name: "expenses_sep_2026.csv",
      file_type: "expenses",
      period_key: "2026-09",
      origin: "demo",
      headers: ["البند", "المورد", "المبلغ", "اليوم"],
      mapping: { day: "اليوم", name: "البند", amount: "المبلغ", vendor: "المورد" },
      valid_count: 2,
      invalid_count: 0,
      issues: [],
      valid_rows: [
        { "البند": "إيجار المحل", "اليوم": 1, "المبلغ": 6000, "المورد": "شركة الواحة العقارية" },
        { "البند": "نظام نقاط البيع", "اليوم": 5, "المبلغ": 450, "المورد": "Foodics" },
      ],
    },
    {
      id: "e67e5810-134a-48fa-aad8-90c3b5ddb396",
      file_name: "Jadwa_sales_2026-09.csv",
      file_type: "sales",
      period_key: "2026-09",
      origin: "upload",
      headers: ["date", "product_code", "name", "qty", "net_sales"],
      mapping: { qty: 3, code: 1, date: 0, name: 2, sales: 4 },
      valid_count: 2,
      invalid_count: 0,
      issues: [],
      valid_rows: [
        {
          line: 2,
          cells: ["2026-09-01", "PR-001", "برجر دجاج", "10", "300"],
          period: "2026-09",
          values: { qty: 10, code: "PR-001", date: "2026-09-01", name: "برجر دجاج", sales: 300 },
        },
        {
          line: 3,
          cells: ["2026-09-02", "PR-002", "باستا الدجاج", "5", "200"],
          period: "2026-09",
          values: { qty: 5, code: "PR-002", date: "2026-09-02", name: "باستا الدجاج", sales: 200 },
        },
      ],
    },
  ];

  const files = dbRows.map(toDataHubFileDTO);
  assert.equal(files.length, 4);

  // Check normalization on costs
  const costsFile = files.find((f) => f.type === "costs");
  assert.ok(costsFile.result.valid[0].values, "Cost row must have .values object");
  assert.equal(costsFile.result.valid[0].values.code, "لاتيه");
  assert.equal(costsFile.result.valid[0].values.unitCost, 7.2);

  // Check normalization on inventory
  const invFile = files.find((f) => f.type === "inventory");
  assert.ok(invFile.result.valid[0].values, "Inventory row must have .values object");
  assert.equal(invFile.result.valid[0].values.code, "حبوب قهوة");
  assert.equal(invFile.result.valid[0].values.waste, 1.5);
  assert.equal(invFile.result.valid[0].values.opening, 18);

  // Check normalization on expenses
  const expFile = files.find((f) => f.type === "expenses");
  assert.ok(expFile.result.valid[0].values, "Expense row must have .values object");
  assert.equal(expFile.result.valid[0].values.amount, 6000);
  assert.equal(expFile.result.valid[0].values.name, "إيجار المحل");

  // Verify fromFiles and analyze succeed without throwing
  const dataset = fromFiles("2026-09", files);
  assert.ok(dataset, "Dataset must be created from normalized files");
  assert.equal(dataset.products.length, 2);
  assert.equal(dataset.inventory.length, 2);
  assert.equal(dataset.expenses.length, 2);

  const facts = analyze(dataset, null);
  assert.ok(facts, "Facts must be calculated successfully");
  assert.equal(facts.summary.revenue, 500);
  assert.equal(facts.summary.operatingExpenses, 6450);
});

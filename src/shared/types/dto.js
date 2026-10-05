// DTOs and Data Converters for Jadwa (جدوى)
// Ensures frontend components receive predictable, domain-specific structures.

/**
 * Computes the avatar initial dynamically from full name or email
 * Examples:
 * "محمد العتيبي" -> "م"
 * "Maram Saleh" -> "M"
 * If full_name is unavailable, use the first character of the email.
 */
export function computeAvatarInitial(fullName, email) {
  if (fullName && typeof fullName === "string" && fullName.trim().length > 0) {
    return fullName.trim().charAt(0);
  }
  if (email && typeof email === "string" && email.trim().length > 0) {
    return email.trim().charAt(0).toUpperCase();
  }
  return "";
}

/**
 * Transforms a Supabase profile row into a user profile DTO
 */
export function toProfileDTO(row) {
  if (!row) return null;
  const fullName = row.full_name ? row.full_name.trim() : "";
  const email = row.email ? row.email.trim() : "";
  const avatarInitial = row.avatar_initial || computeAvatarInitial(fullName, email) || (email ? email.charAt(0).toUpperCase() : "");

  return {
    id: row.id,
    email,
    fullName: fullName || (email ? email.split("@")[0] : "مستخدم"),
    businessName: row.business_name || "منشأتي",
    businessType: row.business_type || "مقهى ومطعم",
    role: row.role || "مالكة المنشأة",
    avatarInitial,
  };
}

/**
 * Formats a metric change entry (string or object with label/percent/direction)
 */
export function formatChange(val) {
  if (typeof val === "string") return val;
  if (val && typeof val === "object") {
    if (typeof val.label === "string" && val.label.trim()) return val.label.trim();
    if (val.percent !== undefined && val.percent !== null) {
      const sign = val.direction === "down" || val.percent < 0 ? "-" : "+";
      return `${sign}${Math.abs(val.percent)}٪`;
    }
    if (val.percentage !== undefined && val.percentage !== null) {
      const sign = val.direction === "down" || val.percentage < 0 ? "-" : "+";
      return `${sign}${Math.abs(val.percentage)}٪`;
    }
  }
  return typeof val === "number" ? String(val) : "";
}

/**
 * Transforms a business period row into a dashboard period DTO
 */
export function toPeriodDTO(row) {
  if (!row) return null;
  const rawChanges = Array.isArray(row.changes) ? row.changes : ["+١٥٪", "+٨٪", "+٤٢٪"];
  const changes = rawChanges.map((c) => formatChange(c) || "");

  return {
    periodKey: row.period_key,
    monthCode: row.month_code,
    name: row.name,
    year: row.year,
    revenue: Number(row.revenue) || 0,
    cost: Number(row.cost) || 0,
    profit: Number(row.profit) || 0,
    saving: Number(row.potential_saving) || 0,
    sales: Array.isArray(row.weekly_sales) ? row.weekly_sales : [],
    costs: Array.isArray(row.weekly_costs) ? row.weekly_costs : [],
    changes,
  };
}

/**
 * Transforms an opportunity row into a frontend opportunity DTO
 */
export function toOpportunityDTO(row) {
  if (!row) return null;
  return {
    id: row.id,
    index: row.opportunity_index ?? 0,
    category: row.category,
    title: row.title,
    text: row.description,
    icon: row.icon || "spark",
    accent: row.accent_color || "#0d9977",
    tint: row.tint_color || "#ebf9f3",
    potentialSaving: Number(row.potential_saving) || 0,
    evidence: row.evidence,
    steps: Array.isArray(row.steps) ? row.steps : [],
    calculation: row.calculation,
    source: row.source,
    status: row.status || "new",
    dismissReason: row.dismiss_reason || "",
    measurement: row.measurement || null,
  };
}

/**
 * Transforms product row + metrics row into a catalog product DTO
 */
export function toProductDTO(productRow, metricsRow) {
  return {
    id: productRow.code.toLowerCase().replace(/[^a-z0-9]/g, "-"),
    dbId: productRow.id,
    name: productRow.name,
    code: productRow.code,
    group: productRow.group_name || "وجبات",
    parts: productRow.parts || null,
    stocks: productRow.stock_refs || [],
    opportunities: productRow.opportunity_refs || [],
    qty: metricsRow ? Number(metricsRow.qty) : 0,
    sales: metricsRow ? Number(metricsRow.sales) : 0,
    cost: metricsRow ? Number(metricsRow.cost) : 0,
  };
}

/**
 * Transforms inventory item row + metrics row into an inventory item DTO
 */
export function toInventoryDTO(itemRow, metricsRow) {
  return {
    id: itemRow.code.toLowerCase().replace(/[^a-z0-9]/g, "-"),
    dbId: itemRow.id,
    name: itemRow.name,
    code: itemRow.code,
    unit: itemRow.unit || "كجم",
    lead: itemRow.lead_time_days || 3,
    target: itemRow.target_stock_days || 10,
    opportunities: itemRow.opportunity_refs || [],
    cost: metricsRow ? Number(metricsRow.unit_cost) : 0,
    previousCost: metricsRow ? Number(metricsRow.previous_cost) : 0,
    opening: metricsRow ? Number(metricsRow.opening) : 0,
    incoming: metricsRow ? Number(metricsRow.incoming) : 0,
    used: metricsRow ? Number(metricsRow.used) : 0,
    waste: metricsRow ? Number(metricsRow.waste) : 0,
    adjustment: metricsRow ? Number(metricsRow.adjustment) : 0,
  };
}

/**
 * Transforms an expense row into a frontend expense DTO
 */
export function toExpenseDTO(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    vendor: row.vendor,
    amount: Number(row.amount) || 0,
    recurring: Boolean(row.recurring),
    day: row.day_of_month || 1,
    date: row.expense_date,
    renewDay: row.renew_day || null,
    opportunity: row.opportunity_ref ?? null,
    description: row.description || "",
  };
}

/**
 * Normalizes a data row to ensure it has { values: {...}, period, line }
 * compatible with the AI engine and frontend previews.
 */
export function normalizeDataHubRow(item, type, period, mapping = {}, headers = []) {
  if (item && item.values && typeof item.values === "object") {
    const v = { ...item.values };
    if (!v.date && (type === "inventory" || type === "expenses")) {
      v.date = period ? period + "-01" : "2026-09-01";
    }
    const cells = Array.isArray(item.cells)
      ? item.cells
      : headers.length
        ? headers.map((h) => item[h] ?? v[h] ?? "")
        : Object.values(v);
    return { ...item, values: v, period: item.period || period, cells };
  }

  const raw = item && typeof item === "object" ? item : {};
  const get = (aliases) => {
    for (const a of aliases) {
      if (raw[a] !== undefined && raw[a] !== null && raw[a] !== "") return raw[a];
      const mapped = mapping[a];
      if (mapped && raw[mapped] !== undefined && raw[mapped] !== null && raw[mapped] !== "") return raw[mapped];
    }
    return undefined;
  };

  const values = {};
  if (type === "sales") {
    values.date = get(["date", "التاريخ"]) || (period ? period + "-01" : "2026-09-01");
    values.code = String(get(["code", "product_code", "رمز المنتج", "الكود", "product", "المنتج"]) || "");
    values.name = String(get(["name", "المنتج", "اسم المنتج"]) || values.code);
    values.qty = Number(get(["qty", "الكمية", "العدد"])) || 0;
    values.sales = Number(get(["sales", "net_sales", "المبيعات", "صافي المبيعات"])) || 0;
  } else if (type === "costs") {
    values.period = String(get(["period", "الفترة", "الشهر"]) || period || "2026-09");
    values.code = String(get(["code", "product_code", "product", "رمز المنتج", "المنتج", "الصنف"]) || "");
    const uc = get(["unitCost", "unit_cost", "التكلفة للوحدة", "سعر الوحدة", "تكلفة الوحدة"]);
    const tc = get(["totalCost", "total_cost", "إجمالي التكلفة", "التكلفة"]);
    if (uc !== undefined) values.unitCost = Number(uc) || 0;
    if (tc !== undefined) values.totalCost = Number(tc) || 0;
  } else if (type === "inventory") {
    values.date = get(["date", "التاريخ"]) || (period ? period + "-28" : "2026-09-28");
    values.code = String(get(["code", "item", "الصنف", "رمز الصنف", "الكود"]) || "");
    values.name = String(get(["name", "الصنف", "اسم الصنف", "item"]) || values.code);
    values.unit = String(get(["unit", "الوحدة"]) || "كجم");
    values.opening = Number(get(["opening", "رصيد أول", "رصيد البداية"])) || 0;
    values.incoming = Number(get(["incoming", "وارد", "المستلم"])) || 0;
    values.used = Number(get(["used", "مستخدم", "الاستهلاك"])) || 0;
    values.waste = Number(get(["waste", "هدر", "الهدر", "التالف"])) || 0;
    values.adjustment = Number(get(["adjustment", "تسوية", "التسويات"])) || 0;
    const uc = get(["unitCost", "unit_cost", "التكلفة للوحدة", "سعر الوحدة", "cost"]);
    if (uc !== undefined) values.unitCost = Number(uc) || 0;
  } else if (type === "expenses") {
    const day = get(["day", "اليوم"]);
    values.date = get(["date", "التاريخ"]) || (day ? (period || "2026-09") + "-" + String(day).padStart(2, "0") : (period ? period + "-01" : "2026-09-01"));
    values.name = String(get(["name", "البند", "المصروف", "الوصف"]) || "مصروف");
    values.amount = Number(get(["amount", "المبلغ", "القيمة"])) || 0;
    values.vendor = String(get(["vendor", "المورد", "الجهة"]) || "");
    values.category = String(get(["category", "التصنيف", "الفئة"]) || "تشغيلي");
    values.recurring = get(["recurring", "متكرر", "شهري", "التكرار"]) ?? true;
  }

  const cells = Array.isArray(raw.cells)
    ? raw.cells
    : headers.length
      ? headers.map((h) => raw[h] ?? values[h] ?? "")
      : Object.values(raw);

  return {
    line: raw.line || 1,
    period: period || "2026-09",
    values,
    cells,
  };
}

/**
 * Transforms a data hub file row into a session-compatible file DTO
 */
export function toDataHubFileDTO(row) {
  const period = row.period_key;
  const headers = Array.isArray(row.headers) ? row.headers : [];
  const rawMapping = row.mapping && typeof row.mapping === "object" ? row.mapping : {};

  // Standardize mapping to schema fields
  const mapping = { ...rawMapping };
  if (mapping.code === undefined && mapping.product !== undefined) mapping.code = mapping.product;
  if (mapping.code === undefined && mapping.item !== undefined) mapping.code = mapping.item;
  if (mapping.unitCost === undefined && mapping.unit_cost !== undefined) mapping.unitCost = mapping.unit_cost;
  if (mapping.totalCost === undefined && mapping.total_cost !== undefined) mapping.totalCost = mapping.total_cost;

  // Map header name strings to indices if headers present
  for (const [k, v] of Object.entries(mapping)) {
    if (typeof v === "string") {
      const idx = headers.indexOf(v);
      if (idx >= 0) mapping[k] = idx;
    }
  }

  const validRows = Array.isArray(row.valid_rows) ? row.valid_rows : [];
  const normalizedValid = validRows.map((r) => normalizeDataHubRow(r, row.file_type, period, mapping, headers));

  return {
    id: String(row.id),
    type: row.file_type,
    name: row.file_name,
    size: row.file_size || 0,
    origin: row.origin || "upload",
    preparedAt: row.prepared_at ? new Date(row.prepared_at).getTime() : Date.now(),
    parsed: {
      headers,
      rows: normalizedValid,
    },
    mapping,
    result: {
      period: row.period_key,
      valid: normalizedValid,
      invalid: Array.isArray(row.invalid_rows) ? row.invalid_rows : [],
      issues: Array.isArray(row.issues) ? row.issues : [],
    },
  };
}

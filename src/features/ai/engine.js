/*
 * محرك تحليل جدوى
 * ----------------
 * كل الأرقام تُحسب هنا بكود ثابت. الذكاء الاصطناعي لا يحسب أي رقم؛ يستقبل نتيجة
 * هذا المحرك (facts) ويشرحها فقط، فيقول الشات والاجتماع نفس الرقم دائمًا.
 * دوال نقية بلا اعتماد على المتصفح أو Supabase؛ مصدر البيانات في dataset.js.
 *
 * شكل dataset:
 * { source:'demo'|'files'|'database', period:'YYYY-MM',
 *   products:[{code,name,qty,sales,cost|null}], inventory:[{code,name,unit,opening,incoming,used,waste,adjustment,unitCost}],
 *   expenses:[{date,name,amount,vendor,category,categoryId,recurring}], daily: Map|null, weekly:number[]|null,
 *   has:{sales,costs,inventory,expenses} }
 */
// ثوابت وافتراضات معلنة. أي توفير مبني عليها يوصف بأنه «تقديري».
export const ASSUMPTIONS = {
  wasteReducible: 0.75,   // نسبة الهدر القابلة للتقليل
  marginTarget: 20,       // هامش الربح المستهدف للسعر المقترح (%)
  overstockRatio: 0.2,    // نمو الرصيد فوق 20% من الاستهلاك = طلب زائد
  overstockMinValue: 100, // تجاهل الفروقات الأقل من 100 ريال
  expenseIncreasePct: 15, // زيادة مصروف تستحق المراجعة
  expenseIncreaseMin: 200,
  costRisePct: 8,         // ارتفاع تكلفة الوحدة عن الشهر السابق يستحق قرارًا
  costRiseMin: 100,
  weekdayMinDays: 14      // أقل عدد أيام مبيعات لتحليل أيام الأسبوع
};
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const round = n => Math.round(n);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sum = (list, fn) => list.reduce((s, x) => s + (fn(x) || 0), 0);
const pct = (cur, prev) => (prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null);
// عدّ عربي بسيط: صنف واحد / صنفان / 3 أصناف
const count = (n, one, two, many) => (n === 1 ? one + ' واحد' : n === 2 ? two : `${n} ${many}`);
const roundPriceUp = n => Math.ceil(n * 2) / 2; // لأقرب نصف ريال للأعلى

export function previousPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}
export function periodName(period) {
  return new Intl.DateTimeFormat('ar-SA', { month: 'long', year: 'numeric', calendar: 'gregory', timeZone: 'UTC' })
    .format(new Date(period + '-01T00:00:00Z'));
}
export function periodFromUrl() {
  const params = new URLSearchParams(location.search);
  const p = params.get('period');
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(p || '')) return p;
  return params.get('month') === 'aug' ? '2026-08' : '2026-09';
}


function recurringFlag(raw) {
  if (typeof raw === 'boolean') return raw;
  const s = String(raw || '').replace(/\s/g, '').toLowerCase();
  if (['شهري', 'متكرر', 'نعم', 'monthly', 'recurring', 'true', 'yes', '1'].includes(s)) return true;
  if (['غيرمتكرر', 'لا', 'oneoff', 'false', 'no', '0'].includes(s)) return false;
  return null;
}


// يحوّل ملفات مركز البيانات (نفس شكل JadwaSession / data_hub_files) إلى بيانات تحليل.
export function fromFiles(period, files) {
  if (!files || !files.length) return null;
  const byType = t => files.find(f => f.type === t);
  const rows = t => (byType(t) ? byType(t).result.valid.map(r => r.values) : []);

  const salesRows = rows('sales'), costRows = rows('costs'), invRows = rows('inventory'), expRows = rows('expenses');

  const productMap = new Map();
  const daily = new Map();
  for (const r of salesRows) {
    const p = productMap.get(r.code) || { code: r.code, name: r.name || r.code, qty: 0, sales: 0, cost: null };
    p.qty += num(r.qty) || 0; p.sales += num(r.sales) || 0;
    if (r.name) p.name = r.name;
    productMap.set(r.code, p);
    daily.set(r.date, (daily.get(r.date) || 0) + (num(r.sales) || 0));
  }
  for (const r of costRows) {
    const p = productMap.get(r.code);
    if (!p) continue;
    const total = num(r.totalCost) !== null ? num(r.totalCost) : num(r.unitCost) !== null ? num(r.unitCost) * p.qty : null;
    if (total !== null) p.cost = (p.cost || 0) + total;
  }

  const invMap = new Map();
  for (const r of [...invRows].sort((a, b) => a.date.localeCompare(b.date))) {
    const it = invMap.get(r.code);
    if (!it) {
      invMap.set(r.code, { code: r.code, name: r.name || r.code, unit: r.unit, opening: num(r.opening) || 0,
        incoming: num(r.incoming) || 0, used: num(r.used) || 0, waste: num(r.waste) || 0,
        adjustment: num(r.adjustment) || 0, unitCost: num(r.unitCost) || 0 });
    } else {
      it.incoming += num(r.incoming) || 0; it.used += num(r.used) || 0; it.waste += num(r.waste) || 0;
      it.adjustment += num(r.adjustment) || 0; if (num(r.unitCost) !== null) it.unitCost = num(r.unitCost);
    }
  }

  const expenses = expRows.map(r => ({ date: r.date, name: r.name, amount: num(r.amount) || 0, vendor: r.vendor || '',
    category: r.category || 'غير مصنف', categoryId: r.category || 'unclassified', recurring: recurringFlag(r.recurring) }));

  const weekly = salesRows.length ? [0, 0, 0, 0] : null;
  if (weekly) for (const [d, v] of daily) weekly[Math.min(3, Math.floor((Number(d.slice(8, 10)) - 1) / 7))] += v;

  return {
    source: 'files', period, products: [...productMap.values()], inventory: [...invMap.values()], expenses,
    daily: salesRows.length ? daily : null, weekly,
    has: { sales: salesRows.length > 0, costs: costRows.length > 0, inventory: invRows.length > 0, expenses: expRows.length > 0 },
    fileNames: files.map(f => f.name)
  };
}


// ---------- التحليل ----------

export function analyze(ds, prev) {
  const facts = {
    period: ds.period, periodName: periodName(ds.period), source: ds.source, currency: 'ريال سعودي',
    assumptions: ASSUMPTIONS, dataGaps: [], findings: [], decisions: []
  };

  // ١. الملخص المالي
  const revenue = ds.has.sales ? round(sum(ds.products, p => p.sales)) : null;
  const productsWithCost = ds.products.filter(p => p.cost !== null);
  const productCost = ds.has.costs ? round(sum(productsWithCost, p => p.cost)) : null;
  const wasteCost = ds.has.inventory ? round(sum(ds.inventory, i => i.waste * i.unitCost)) : null;
  const operating = ds.has.expenses ? round(sum(ds.expenses, e => e.amount)) : null;
  const costParts = [productCost, wasteCost, operating].filter(v => v !== null);
  const totalCost = costParts.length ? costParts.reduce((a, b) => a + b, 0) : null;
  const complete = revenue !== null && productCost !== null && wasteCost !== null && operating !== null;
  facts.summary = {
    revenue, productCost, wasteCost, operatingExpenses: operating, totalCost,
    profit: revenue !== null && totalCost !== null ? revenue - totalCost : null,
    profitIsComplete: complete,
    margin: revenue && totalCost !== null ? Math.round(((revenue - totalCost) / revenue) * 1000) / 10 : null
  };
  if (prev) {
    const p = analyze(prev, null).summary;
    facts.previous = { period: prev.period, periodName: periodName(prev.period), revenue: p.revenue, totalCost: p.totalCost, profit: p.profit };
    facts.changes = { revenuePct: pct(facts.summary.revenue, p.revenue), totalCostPct: pct(facts.summary.totalCost, p.totalCost), profitPct: pct(facts.summary.profit, p.profit) };
  }
  facts.weeklySales = ds.weekly ? ds.weekly.map(round) : null;

  // ٢. ربحية الأصناف
  facts.products = ds.products.map(p => {
    const profit = p.cost === null ? null : p.sales - p.cost;
    return {
      code: p.code, name: p.name, qty: p.qty, sales: round(p.sales), cost: p.cost === null ? null : round(p.cost),
      profit: profit === null ? null : round(profit),
      margin: profit === null || !p.sales ? null : Math.round((profit / p.sales) * 1000) / 10,
      avgPrice: p.qty ? Math.round((p.sales / p.qty) * 100) / 100 : null,
      unitCost: p.cost === null || !p.qty ? null : Math.round((p.cost / p.qty) * 100) / 100
    };
  }).sort((a, b) => b.sales - a.sales);
  const losing = facts.products.filter(p => p.profit !== null && p.profit < 0).sort((a, b) => a.profit - b.profit);
  const lowMargin = facts.products.filter(p => p.margin !== null && p.margin >= 0 && p.margin < ASSUMPTIONS.marginTarget);
  const noCost = facts.products.filter(p => p.cost === null);
  if (ds.has.sales && ds.has.costs && noCost.length) facts.dataGaps.push(`${noCost.length} أصناف بدون تكلفة في ملف التكلفة؛ لم تُحسب ربحيتها: ${noCost.slice(0, 5).map(p => p.name).join('، ')}.`);

  for (const p of losing) {
    const suggested = roundPriceUp(p.unitCost / (1 - ASSUMPTIONS.marginTarget / 100));
    facts.decisions.push({
      id: 'product-' + p.code, category: 'losing_product', categoryName: 'صنف خاسر', subject: p.name,
      title: `${p.name} يسبب خسارة ${round(-p.profit)} ريال شهريًا`,
      problem: `${p.name} خسر ${round(-p.profit)} ريال هذا الشهر.`,
      cause: `متوسط سعر البيع ${p.avgPrice} ريال، بينما تكلفة الوحدة ${p.unitCost} ريال، والمباع ${p.qty} وحدة.`,
      decision: `ارفع السعر إلى ${suggested} ريال (يغطي التكلفة بهامش ${ASSUMPTIONS.marginTarget}%)، أو خفّض تكلفة مكوناته إلى أقل من ${p.avgPrice} ريال للوحدة.`,
      lossAmount: round(-p.profit), saving: round(-p.profit),
      confidence: 'محسوب من البيانات', basis: `الخسارة = (${p.unitCost} − ${p.avgPrice}) × ${p.qty}. التوفير بافتراض بقاء الكمية المباعة كما هي.`,
      page: 'products.html'
    });
  }
  // ارتفاع تكلفة الوحدة عن الشهر السابق
  if (prev && prev.has.costs) {
    const before = new Map(prev.products.filter(p => p.cost !== null && p.qty).map(p => [p.code, p.cost / p.qty]));
    // الأصناف الخاسرة لها قرار مستقل؛ نستبعدها هنا حتى لا تُحسب الخسارة مرتين
    const rises = facts.products.filter(p => p.unitCost !== null && before.has(p.code) && !(p.profit < 0)).map(p => {
      const old = Math.round(before.get(p.code) * 100) / 100;
      return { ...p, oldUnitCost: old, risePct: pct(p.unitCost, old), extra: round((p.unitCost - old) * p.qty) };
    }).filter(p => p.risePct >= ASSUMPTIONS.costRisePct && p.extra >= ASSUMPTIONS.costRiseMin).sort((a, b) => b.extra - a.extra);
    if (rises.length) {
      const total = sum(rises, p => p.extra);
      facts.decisions.push({
        id: 'cost-rise', category: 'cost_increase', categoryName: 'تكلفة المنتجات',
        title: `ارتفاع تكلفة ${count(rises.length, 'صنف', 'صنفين', 'أصناف')} كلّفك ${total} ريال`,
        problem: `تكلفة الوحدة ارتفعت عن ${periodName(prev.period)} في: ${rises.map(p => p.name).join('، ')}.`,
        cause: rises.map(p => `${p.name} من ${p.oldUnitCost} إلى ${p.unitCost} ريال للوحدة (+${p.risePct}%) × ${p.qty} وحدة = ${p.extra} ريال`).join('، ') + '.',
        decision: 'فاوض المورد أو قارن عرضًا بديلًا لإرجاع تكلفة الوحدة: ' + rises.map(p => `${p.name} إلى ${p.oldUnitCost} ريال`).join('، ') + '، ثم حدّث تكلفة الوصفة.',
        lossAmount: total, saving: total, confidence: 'تقديري',
        basis: `التوفير = (تكلفة الوحدة الحالية − تكلفة الشهر السابق) × الكمية المباعة، بافتراض إرجاع التكلفة لمستواها السابق.`,
        page: 'products.html'
      });
    }
  }
  if (lowMargin.length) facts.findings.push({ type: 'low_margin', text: `أصناف رابحة لكن هامشها أقل من ${ASSUMPTIONS.marginTarget}%: ` + lowMargin.map(p => `${p.name} (${p.margin}%)`).join('، ') });

  // ٣. المخزون: الهدر والطلب الزائد
  facts.inventory = ds.inventory.map(i => {
    const end = i.opening + i.incoming - i.used - i.waste + i.adjustment;
    return { code: i.code, name: i.name, unit: i.unit, opening: round(i.opening), incoming: round(i.incoming), used: round(i.used),
      waste: round(i.waste), unitCost: i.unitCost, wasteCost: round(i.waste * i.unitCost), endBalance: round(end),
      wasteRatePct: i.used + i.waste ? Math.round((i.waste / (i.used + i.waste)) * 1000) / 10 : 0 };
  });
  const wasted = facts.inventory.filter(i => i.wasteCost > 0).sort((a, b) => b.wasteCost - a.wasteCost);
  if (wasted.length) {
    const total = sum(wasted, i => i.wasteCost);
    const top = wasted.slice(0, 3);
    facts.decisions.push({
      id: 'waste', category: 'waste', categoryName: 'هدر المخزون',
      title: `هدر المخزون كلّف ${total} ريال هذا الشهر`,
      problem: `تم هدر مواد بقيمة ${total} ريال.`,
      cause: 'أعلى المواد هدرًا: ' + top.map(i => `${i.name} (${i.waste} ${i.unit || ''} بقيمة ${i.wasteCost} ريال، ${i.wasteRatePct}% من الكمية)`).join('، ') + '.',
      decision: 'خفّض كمية الشراء القادمة: ' + top.map(i => `${i.name} من ${i.incoming} إلى ${Math.max(0, round(i.incoming - i.waste * ASSUMPTIONS.wasteReducible))} ${i.unit || ''}`).join('، ') + '، واشترِ المواد قصيرة الصلاحية على دفعات أصغر.',
      lossAmount: total, saving: round(total * ASSUMPTIONS.wasteReducible),
      confidence: 'تقديري', basis: `التوفير = تكلفة الهدر ${total} × ${ASSUMPTIONS.wasteReducible * 100}% (افتراض أن هذا الجزء قابل للتقليل).`,
      page: 'products.html'
    });
  }
  const overstock = facts.inventory.map(i => ({ ...i, growth: i.endBalance - i.opening }))
    .filter(i => i.incoming > 0 && i.growth > ASSUMPTIONS.overstockRatio * i.used && i.growth * i.unitCost >= ASSUMPTIONS.overstockMinValue)
    .sort((a, b) => b.growth * b.unitCost - a.growth * a.unitCost);
  if (overstock.length) {
    facts.overOrdering = overstock.map(i => ({ name: i.name, unit: i.unit, incoming: i.incoming, used: i.used, extraQty: round(i.growth),
      cashTied: round(i.growth * i.unitCost), suggestedNextOrder: Math.max(0, round(i.used - i.growth)) }));
    facts.findings.push({ type: 'over_ordering', text: 'مواد طُلبت بكمية أكبر من الاستهلاك (سيولة مجمدة في المخزون وليست خسارة مباشرة): ' +
      facts.overOrdering.map(o => `${o.name}: الوارد ${o.incoming} والمستهلك ${o.used}، زيادة ${o.extraQty} ${o.unit || ''} بقيمة ${o.cashTied} ريال؛ الطلب المقترح القادم ${o.suggestedNextOrder}`).join('، ') });
  }

  // ٤. المصروفات
  if (ds.has.expenses) {
    const cats = new Map();
    for (const e of ds.expenses) cats.set(e.category, (cats.get(e.category) || 0) + e.amount);
    facts.expenses = {
      total: operating,
      byCategory: [...cats].map(([name, total]) => ({ name, total: round(total) })).sort((a, b) => b.total - a.total),
      recurringTotal: round(sum(ds.expenses.filter(e => e.recurring), e => e.amount)),
      items: ds.expenses.map(e => ({ name: e.name, amount: round(e.amount), category: e.category, recurring: e.recurring, date: e.date, vendor: e.vendor }))
    };
    // اشتراكات متكررة متشابهة
    const groups = new Map();
    for (const e of ds.expenses.filter(e => e.recurring && /اشتراك|برمج|software|subscription|تطبيق/i.test(e.category + ' ' + e.categoryId + ' ' + e.name))) {
      const k = e.categoryId; groups.set(k, [...(groups.get(k) || []), e]);
    }
    for (const items of groups.values()) {
      if (items.length < 2) continue;
      const sorted = [...items].sort((a, b) => b.amount - a.amount);
      const saving = round(sum(sorted.slice(1), e => e.amount));
      facts.decisions.push({
        id: 'subscriptions', category: 'duplicate_subscription', categoryName: 'اشتراكات متشابهة',
        title: `${count(items.length, 'اشتراك', 'اشتراكان', 'اشتراكات')} ${items.length === 2 ? 'متكرران' : 'متكررة'} لنفس الغرض`,
        problem: `تدفع ${round(sum(items, e => e.amount))} ريال شهريًا على: ${items.map(e => `${e.name} (${e.amount})`).join('، ')}.`,
        cause: 'أكثر من اشتراك شهري في نفس الفئة، وقد تكون وظيفتها متشابهة.',
        decision: `تأكد من استخدام الفريق، واحتفظ باشتراك واحد (${sorted[0].name})، وألغِ الباقي قبل تاريخ التجديد.`,
        lossAmount: saving, saving, confidence: 'يحتاج تأكيد',
        basis: `التوفير = مجموع الاشتراكات عدا الأعلى قيمة (${saving} ريال)، بشرط أن تكون الخدمات متشابهة فعلًا.`,
        page: 'expenses.html'
      });
    }
    if (prev && prev.has.expenses) {
      const prevCats = new Map();
      for (const e of prev.expenses) prevCats.set(e.category, (prevCats.get(e.category) || 0) + e.amount);
      const ups = [...cats].map(([name, total]) => ({ name, total, before: prevCats.get(name) }))
        .filter(c => c.before && c.total - c.before >= ASSUMPTIONS.expenseIncreaseMin && pct(c.total, c.before) >= ASSUMPTIONS.expenseIncreasePct);
      if (ups.length) facts.findings.push({ type: 'expense_increase', text: 'مصروفات زادت عن الشهر السابق: ' + ups.map(c => `${c.name} من ${round(c.before)} إلى ${round(c.total)} (+${pct(c.total, c.before)}%)`).join('، ') });
    }
  }

  // ٥. أيام الأسبوع (من الملفات فقط لأنها تحتوي تاريخًا يوميًا)
  if (ds.daily && ds.daily.size >= ASSUMPTIONS.weekdayMinDays) {
    const by = WEEKDAYS.map(() => ({ total: 0, days: 0 }));
    for (const [d, v] of ds.daily) { const w = new Date(d + 'T00:00:00Z').getUTCDay(); by[w].total += v; by[w].days++; }
    const avg = sum([...ds.daily.values()], v => v) / ds.daily.size;
    facts.weekdays = by.map((b, i) => b.days ? { day: WEEKDAYS[i], avgSales: round(b.total / b.days), vsAveragePct: pct(b.total / b.days, avg) } : null).filter(Boolean);
    const sorted = [...facts.weekdays].sort((a, b) => a.vsAveragePct - b.vsAveragePct);
    facts.findings.push({ type: 'weekdays', text: `أضعف يوم: ${sorted[0].day} (${sorted[0].vsAveragePct}% عن متوسط الأيام)، وأقوى يوم: ${sorted.at(-1).day} (+${sorted.at(-1).vsAveragePct}%).` });
  } else if (ds.source === 'demo') {
    facts.dataGaps.push('البيانات التوضيحية أسبوعية وليست يومية؛ لا يمكن مقارنة أيام الأسبوع.');
  } else if (ds.has.sales) {
    facts.dataGaps.push(`ملف المبيعات يغطي أقل من ${ASSUMPTIONS.weekdayMinDays} يومًا؛ لا يكفي لمقارنة أيام الأسبوع.`);
  }

  // ٦. فجوات البيانات
  const names = { sales: 'المبيعات', costs: 'تكلفة المنتجات', inventory: 'المخزون والهدر', expenses: 'المصروفات' };
  for (const [k, v] of Object.entries(ds.has)) if (!v) facts.dataGaps.push(`لم يُرفع ملف ${names[k]} لهذه الفترة.`);
  facts.dataGaps.push('ملف المبيعات لا يحتوي وقت البيع، ولا يوجد ملف للموظفين أو الورديات؛ لا يمكن تحليل ساعات الذروة أو نقص الموظفين.');

  // ٧. الخسارة الإجمالية والقرارات
  facts.decisions.sort((a, b) => b.saving - a.saving);
  facts.losses = {
    total: sum(facts.decisions, d => d.lossAmount),
    expectedSaving: sum(facts.decisions, d => d.saving),
    breakdown: facts.decisions.map(d => ({ category: d.categoryName, amount: d.lossAmount, saving: d.saving }))
  };
  return facts;
}


// نسخة مختصرة تُرسل للذكاء الاصطناعي (تقلل التوكنز وتبقي كل الأرقام المهمة)
export function forAI(facts) {
  if (!facts) return null;
  const losingCodes = new Set(facts.decisions.filter(d => d.category === 'losing_product').map(d => d.id.slice(8)));
  return {
    ...facts,
    products: facts.products.filter((p, i) => i < 25 || losingCodes.has(p.code)),
    inventory: facts.inventory.slice(0, 30),
    expenses: facts.expenses ? { ...facts.expenses, items: facts.expenses.items.slice(0, 30) } : undefined,
    source: { demo: 'بيانات توضيحية (ليست بيانات منشأة حقيقية)', files: 'ملفات المنشأة المرفوعة', database: 'بيانات المنشأة المحفوظة في حسابها' }[facts.source] || facts.source
  };
}


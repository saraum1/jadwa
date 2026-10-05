import { useState, useEffect, useRef } from "react";
import View from "./components/OpportunitiesView.jsx";
import { months, opportunities as defaultOpportunities } from "../../shared/data/demo.js";
import {
  useQuery,
  useWorkspace,
  useToast,
} from "../../shared/lib/hooks.js";
import {
  number,
  Money,
  Text,
  Icon,
  Skeleton,
} from "../../shared/ui/primitives.jsx";
import InfoContent from "../../shared/ui/InfoContent.jsx";
import { opportunityService } from "./services/opportunityService.js";
import { measurementSchema, dismissSchema } from "./schemas/opportunitySchemas.js";
import { useAuth } from "../../shared/lib/authContext.jsx";
import { computeAvatarInitial } from "../../shared/types/dto.js";
import { openAskJadwa } from "../ai/client.js";
import { usePeriodFacts, getSourceLabel } from "../ai/usePeriodFacts.js";

const statuses = {
    new: "جديدة",
    active: "قيد التنفيذ",
    awaiting: "بانتظار القياس",
    completed: "مكتملة",
    dismissed: "غير مناسبة",
  },
  workflow = ["new", "active", "awaiting", "completed"];

const fresh = () =>
  defaultOpportunities.map(() => ({ status: "new", reason: "", measurement: null }));

function OpportunityDetails({ id, month, s, o, transition }) {
  const m = months[month],
    step = workflow.indexOf(s.status),
    [mode, setMode] = useState("detail"),
    [error, setError] = useState(""),
    form = useRef(),
    title = useRef(),
    actions = useRef();

  useEffect(() => {
    if (mode !== "detail") {
      form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      form.current
        ?.querySelector("input,textarea")
        ?.focus({ preventScroll: true });
    }
  }, [mode]);

  function next(status, extra = {}) {
    transition(status, extra);
    setMode("detail");
    requestAnimationFrame(() =>
      status === "completed"
        ? title.current?.focus()
        : actions.current
            ?.querySelector("button")
            ?.focus({ preventScroll: true }),
    );
  }

  const feedback = {
    active:
      "الفرصة قيد التنفيذ. بعد تطبيق الإجراء، انقليها إلى انتظار قياس الأثر.",
    awaiting:
      "تم تسجيل تنفيذ الإجراء. لم يُحتسب أي وفر محقق؛ يلزم مقارنة التكاليف على أساس متكافئ.",
    dismissed:
      "تم استبعاد الفرصة من إجمالي الوفر المحتمل." +
      (s.reason ? " السبب: " + s.reason : ""),
    completed:
      "اكتملت المتابعة. النتيجة أدناه مسجلة ومحفوظة في قاعدة بيانات المنشأة.",
  };

  function measure(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      payload = {
        before: Number(f.get("before")),
        after: Number(f.get("after")),
        basis: (f.get("basis") || "").trim(),
        source: (f.get("source") || "").trim(),
      };

    const result = measurementSchema.safeParse(payload);
    if (!result.success) {
      const issues = result.error.issues || result.error.errors || [];
      setError(issues[0]?.message || "أدخلي تكاليف صحيحة وأكملي أساس المقارنة ومرجع القياس.");
      return;
    }

    if (s.status === "awaiting") {
      next("completed", { measurement: result.data });
    }
  }

  function dismiss(e) {
    e.preventDefault();
    const rawReason = new FormData(e.currentTarget).get("reason");
    const result = dismissSchema.safeParse({ reason: rawReason ? String(rawReason).trim() : undefined });
    next("dismissed", { reason: result.success ? result.data.reason || "" : "" });
  }

  return (
    <>
      <div className="sheet-title-row">
        <span className="sheet-category" style={{ "--accent": o.accent }}>
          <Icon name={o.icon} />
          {o.category}
        </span>
        <span className={"status-badge status-" + s.status}>
          {statuses[s.status]}
        </span>
      </div>
      <h2 id="sheet-title" ref={title} tabIndex={-1}>
        {o.title}
      </h2>
      <p className="sheet-period">{m.name} ٢٠٢٦ · {o.sourceLabel || "بيانات المنشأة"}</p>
      <div className="sheet-saving">
        <div>
          <p>الوفر الشهري المحتمل</p>
          <small>تقدير قبل التنفيذ والقياس</small>
        </div>
        <strong>
          <Money value={o.potentialSaving ?? o.saving ?? m.amounts[id]} />
        </strong>
      </div>
      {step >= 0 && (
        <ol className="workflow-steps" aria-label="مراحل المتابعة">
          {workflow.map((status, n) => (
            <li
              key={status}
              className={
                (n <= step ? "reached" : "") +
                " " +
                (n === step ? "current" : "")
              }
              aria-current={n === step ? "step" : undefined}
            >
              {statuses[status]}
            </li>
          ))}
        </ol>
      )}
      {feedback[s.status] && (
        <div className="state-feedback">{feedback[s.status]}</div>
      )}
      {s.measurement && (
        <div
          className={
            "measurement-result " +
            (s.measurement.before < s.measurement.after ? "negative" : "")
          }
        >
          <h3>فرق التكلفة المسجل</h3>
          <strong>
            <Money value={s.measurement.before - s.measurement.after} />
          </strong>
          <p>
            {s.measurement.before < s.measurement.after
              ? "ارتفعت التكلفة بعد الإجراء."
              : s.measurement.before === s.measurement.after
                ? "لم تتغير التكلفة."
                : "انخفضت التكلفة في المقارنة المدخلة."}{" "}
            هذا الفرق وحده لا يثبت أن الإجراء سبب التغير.
          </p>
          <p>
            أساس المقارنة: {s.measurement.basis}
            <br />
            المصدر: {s.measurement.source}
          </p>
        </div>
      )}
      <section className="evidence-block">
        <h3>ما الذي لاحظه جدوى؟</h3>
        <p>{o.evidence || o.problem}</p>
        {o.cause && o.cause !== o.evidence && (
          <p style={{ marginTop: "8px", color: "#475569" }}>
            <strong>السبب: </strong>{o.cause}
          </p>
        )}
        <div className="source-reference">
          <Icon name="file" />
          <span>{o.source || "بيانات المنشأة"}</span>
        </div>
      </section>
      <section className="evidence-block">
        <h3>كيف قُدّر الوفر؟</h3>
        <p className="calculation-text">
          <Text>
            {o.calculation || o.basis || (month === "sep" ? o.calculation : `تقدير توضيحي لشهر أغسطس بقيمة ${number(m.amounts[id])} ⃁.`)}
          </Text>
        </p>
        {o.confidence && (
          <small style={{ display: "block", marginTop: "8px", color: "#64748b" }}>
            درجة الثقة: {o.confidence}
          </small>
        )}
      </section>
      <button
        className="context-question"
        onClick={() => {
          if (o.targetPage) {
            location.href = o.targetPage + "?month=" + month;
          } else {
            location.href =
              id < 2
                ? "products.html?month=" +
                  month +
                  "&tab=" +
                  (id === 0 ? "inventory" : "products") +
                  "&opportunity=" +
                  id
                : "expenses.html?month=" + month + "&opportunity=2";
          }
        }}
      >
        <Icon name={o.icon === "wallet" || o.targetPage === "expenses.html" ? "wallet" : "box"} />
        {o.targetPage === "expenses.html" || id >= 2 ? "عرض المصروفات المرتبطة" : "عرض الأصناف المرتبطة"}
      </button>
      <section className="steps-block">
        <h3>خطوات مقترحة</h3>
        <ol>
          {(o.steps || [o.decision]).filter(Boolean).map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ol>
      </section>
      <button
        className="context-question"
        onClick={() => openAskJadwa(`اشرح لي فرصة «${o.title}»: وش السبب في بياناتي، ووش أسوي، وكم أوفر؟`)}
      >
        <Icon name="spark" />اسأل جدوى عن هذه الفرصة
      </button>
      {mode === "dismiss" ? (
        <form
          id="dismiss-form"
          className="measurement-block"
          ref={form}
          onSubmit={dismiss}
        >
          <h3>لماذا لا تناسبك هذه الفرصة؟</h3>
          <label className="field">
            السبب (اختياري)
            <textarea
              name="reason"
              maxLength={300}
              placeholder="مثلًا: الاشتراك ضروري لفريق آخر"
            />
          </label>
          <div className="form-actions">
            <button className="primary-button" type="submit">
              تأكيد الاستبعاد
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setMode("detail")}
            >
              إلغاء
            </button>
          </div>
        </form>
      ) : mode === "measure" ? (
        <form
          id="measurement-form"
          ref={form}
          className="measurement-block"
          onSubmit={measure}
        >
          <h3>قياس أثر الفرصة</h3>
          <p>
            أدخلي تكلفة البند نفسه لفترتين قابلتين للمقارنة، مع توضيح المدة وحجم
            النشاط.
          </p>
          <div className="field-grid">
            {[
              ["before", "التكلفة قبل الإجراء"],
              ["after", "التكلفة بعد الإجراء"],
            ].map(([name, label]) => (
              <label className="field" key={name}>
                {label}
                <input
                  name={name}
                  type="number"
                  min="0"
                  max="1000000000"
                  step="0.01"
                  required
                  inputMode="decimal"
                  aria-label={label + " بالريال السعودي"}
                />
              </label>
            ))}
          </div>
          <label className="field">
            أساس المقارنة
            <textarea
              name="basis"
              maxLength={500}
              required
              placeholder="الفترتان، مدتهما، ومدى تقارب حجم النشاط"
            />
          </label>
          <label className="field">
            مرجع القياس
            <input
              name="source"
              maxLength={250}
              required
              placeholder="مثلًا: سجل هدر المكونات للفترتين"
            />
          </label>
          <p id="measurement-error" className="form-error" role="alert">
            {error}
          </p>
          <div className="form-actions">
            <button className="primary-button" type="submit">
              تسجيل النتيجة وحفظها
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setMode("detail")}
            >
              إلغاء
            </button>
          </div>
        </form>
      ) : (
        <div className="sheet-actions" ref={actions}>
          {s.status === "new" ? (
            <>
              <button className="primary-button" onClick={() => next("active")}>
                ابدأ المتابعة
              </button>
              <button
                className="secondary-button"
                onClick={() => setMode("dismiss")}
              >
                ليست مناسبة
              </button>
            </>
          ) : s.status === "active" ? (
            <>
              <button
                className="primary-button"
                onClick={() => next("awaiting")}
              >
                تم تنفيذ الإجراء
              </button>
              <button
                className="secondary-button"
                onClick={() => setMode("dismiss")}
              >
                إيقاف المتابعة
              </button>
            </>
          ) : s.status === "awaiting" ? (
            <>
              <button
                className="primary-button"
                onClick={() => {
                  setError("");
                  setMode("measure");
                }}
              >
                سجّل قياس الأثر
              </button>
              <button
                className="secondary-button"
                onClick={() => next("active")}
              >
                العودة إلى التنفيذ
              </button>
            </>
          ) : s.status === "dismissed" ? (
            <button className="secondary-button" onClick={() => next("new")}>
              إعادة الفرصة للمراجعة
            </button>
          ) : null}
        </div>
      )}
      <p className="sheet-disclaimer">
        حالات المتابعة وإدخالات القياس متزامنة ومحفوظة في قاعدة بيانات جدوى.
      </p>
    </>
  );
}

export default function OpportunitiesPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const isGuest = user?.isGuest ?? false;

  const [params, update] = useQuery(),
    month = Object.hasOwn(months, params.get("month"))
      ? params.get("month")
      : "sep",
    m = months[month],
    w = useWorkspace(month, "opportunities");

  useEffect(() => {
    if (!authLoading && !user) {
      location.replace("login.html");
    }
  }, [authLoading, user]);

  const { facts, source, loading: factsLoading } = usePeriodFacts(month);
  const isFactsFiles = facts && facts.source === "files";

  const fileOpportunities = isFactsFiles
    ? facts.decisions.map((d) => ({
        id: d.id,
        title: d.title,
        text: d.cause || d.problem,
        problem: d.problem,
        cause: d.cause,
        decision: d.decision,
        potentialSaving: d.saving,
        saving: d.saving,
        confidence: d.confidence,
        basis: d.basis,
        category: d.categoryName,
        categoryName: d.categoryName,
        icon:
          d.category === "duplicate_subscription"
            ? "wallet"
            : d.category === "cost_increase"
              ? "cart"
              : "box",
        accent:
          d.category === "losing_product"
            ? "#ef4444"
            : d.category === "duplicate_subscription"
              ? "#e3b130"
              : "#2563eb",
        evidence: d.problem + (d.cause ? " " + d.cause : ""),
        calculation: d.basis || `التوفير المحسوب: ${number(d.saving)} ريال.`,
        steps: [d.decision],
        source: "تحليل ملفات مركز البيانات",
        sourceLabel: "من ملفاتك المرفوعة",
        targetPage:
          d.page ||
          (d.category === "duplicate_subscription"
            ? "expenses.html"
            : "products.html"),
      }))
    : null;

  const [loading, setLoading] = useState(true);
  const [opportunitiesList, setOpportunitiesList] = useState([]);
  const [stateByMonth, setStates] = useState({ sep: [], aug: [] });
  const [workflowMap, setWorkflowMap] = useState(() => {
    try {
      const raw = localStorage.getItem("jadwa_workflow_" + month);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem("jadwa_workflow_" + month);
      setWorkflowMap(raw ? JSON.parse(raw) : {});
    } catch {
      setWorkflowMap({});
    }
  }, [month]);

  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("highest");
  const [current, setCurrent] = useState(null);
  const [toast, showToast] = useToast();

  useEffect(() => {
    if (authLoading || !user) return;
    let active = true;
    setLoading(true);

    opportunityService.getOpportunities(month, isGuest).then((res) => {
      if (!active) return;
      if (res) {
        setOpportunitiesList(res);
        setStates((prev) => ({
          ...prev,
          [month]: res.map((item) => ({
            status: item.status || "new",
            reason: item.dismissReason || "",
            measurement: item.measurement || null,
          })),
        }));
      }
      setLoading(false);
    }).catch(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [month, authLoading, user, isGuest]);

  const displayName = user?.profile?.fullName || (isGuest ? "الشيماء" : (user?.email?.split("@")[0] || "مستخدم"));
  const avatarChar = isGuest
    ? "ش"
    : (computeAvatarInitial(user?.profile?.fullName, user?.email) || (displayName ? displayName.charAt(0) : "م"));

  const displayedOpportunities = fileOpportunities || opportunitiesList;
  const pageLoading = isFactsFiles ? factsLoading : (loading || factsLoading);
  const states = stateByMonth[month] || fresh();

  const ids = displayedOpportunities
    .map((_, i) => i)
    .filter((i) => category === "all" || String(i) === category || displayedOpportunities[i]?.id === category)
    .sort((a, b) => {
      const amtA = displayedOpportunities[a]?.potentialSaving ?? displayedOpportunities[a]?.saving ?? m.amounts?.[a] ?? 0;
      const amtB = displayedOpportunities[b]?.potentialSaving ?? displayedOpportunities[b]?.saving ?? m.amounts?.[b] ?? 0;
      const stA = isFactsFiles ? (workflowMap[displayedOpportunities[a]?.id]?.status || "new") : (states[a]?.status || "new");
      const stB = isFactsFiles ? (workflowMap[displayedOpportunities[b]?.id]?.status || "new") : (states[b]?.status || "new");
      return sort === "lowest"
        ? amtA - amtB
        : sort === "status"
          ? Object.keys(statuses).indexOf(stA) - Object.keys(statuses).indexOf(stB) || amtB - amtA
          : amtB - amtA;
    });

  useEffect(() => {
    if (!pageLoading && params.has("opportunity")) {
      const oppParam = params.get("opportunity");
      const foundIdx = displayedOpportunities.findIndex(
        (o, i) => o.id === oppParam || String(i) === oppParam,
      );
      if (foundIdx !== -1) setCurrent(foundIdx);
    }
  }, [pageLoading, displayedOpportunities]);

  async function transition(next, extra = {}) {
    if (current === null) return;
    const curOpp = displayedOpportunities[current];
    if (!curOpp) return;
    const oppKey = curOpp.id || String(current);

    const allowed = {
      new: ["active", "dismissed"],
      active: ["awaiting", "dismissed"],
      awaiting: ["active", "completed"],
      dismissed: ["new"],
      completed: [],
    };

    const currentStatus = isFactsFiles
      ? (workflowMap[oppKey]?.status || "new")
      : (states[current]?.status || "new");

    if (!allowed[currentStatus]?.includes(next)) return;

    if (isFactsFiles) {
      setWorkflowMap((prev) => {
        const nextMap = {
          ...prev,
          [oppKey]: {
            ...(prev[oppKey] || { status: "new" }),
            ...extra,
            status: next,
          },
        };
        try {
          localStorage.setItem("jadwa_workflow_" + month, JSON.stringify(nextMap));
        } catch {}
        return nextMap;
      });
    } else {
      setStates((prev) => ({
        ...prev,
        [month]: prev[month].map((s, i) =>
          i === current ? { ...s, ...extra, status: next } : s,
        ),
      }));
      await opportunityService.updateOpportunity(month, current, {
        status: next,
        reason: extra.reason,
        measurement: extra.measurement,
      });
    }

    showToast("تم تحديث وحفظ حالة الفرصة بنجاح");
  }

  const waitingCount = displayedOpportunities.filter((o, i) =>
    (isFactsFiles ? (workflowMap[o.id]?.status || "new") : (states[i]?.status || "new")) === "awaiting",
  ).length;

  const slots = {
    "mini-avatar": avatarChar,
    "demo-label": getSourceLabel(facts?.source || (isGuest ? "demo" : "database")),
    "topbar-actions": (
      <button
        type="button"
        className="icon-button"
        onClick={logout}
        title="تسجيل الخروج"
        aria-label="تسجيل الخروج"
        style={{
          background: "transparent",
          border: "1px solid #e2e8f0",
          borderRadius: "6px",
          padding: "4px 8px",
          fontSize: "12px",
          color: "#64748b",
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          cursor: "pointer",
        }}
      >
        <svg style={{ width: "14px", height: "14px" }}>
          <use href="#logout" />
        </svg>
        <span>خروج</span>
      </button>
    ),
    "potential-value": number(
      displayedOpportunities.reduce(
        (sum, o, i) => {
          const st = isFactsFiles ? (workflowMap[o.id]?.status || "new") : (states[i]?.status || "new");
          const amt = o.potentialSaving ?? o.saving ?? m.amounts[i] ?? 0;
          return sum + (["dismissed", "completed"].includes(st) ? 0 : amt);
        },
        0,
      ),
    ),
    "new-count": number(
      displayedOpportunities.filter((o, i) =>
        (isFactsFiles ? (workflowMap[o.id]?.status || "new") : (states[i]?.status || "new")) === "new",
      ).length,
    ),
    "active-count": number(
      displayedOpportunities.filter((o, i) =>
        (isFactsFiles ? (workflowMap[o.id]?.status || "new") : (states[i]?.status || "new")) === "active",
      ).length,
    ),
    "pending-label": waitingCount
      ? number(waitingCount) + " بانتظار قياس الأثر"
      : "لا توجد فرص بانتظار قياس الأثر",
    "result-count": number(ids.length) + " من " + number(displayedOpportunities.length),
    "period-footer": (facts?.source === "files" ? "ملفات " : (isGuest ? "بيانات توضيحية · " : "فترة ")) + m.name + " ٢٠٢٦",
    "opportunity-list": ids.length > 0 ? ids.map((i) => {
      const o = displayedOpportunities[i],
        s = isFactsFiles ? (workflowMap[o.id] || { status: "new" }) : (states[i] || { status: "new" }),
        amt = o?.potentialSaving ?? o?.saving ?? m.amounts[i] ?? 0,
        rank =
          displayedOpportunities
            .map((_, idx) => idx)
            .sort((a, b) => (displayedOpportunities[b]?.potentialSaving ?? displayedOpportunities[b]?.saving ?? 0) - (displayedOpportunities[a]?.potentialSaving ?? displayedOpportunities[a]?.saving ?? 0))
            .indexOf(i) + 1;
      if (!o) return null;
      return (
        <article
          key={o.id || i}
          className={
            "opportunity-row " +
            (["dismissed", "completed"].includes(s.status)
              ? "row-excluded "
              : "") +
            (pageLoading ? "is-loading" : "")
          }
          style={{ "--accent": o.accent }}
          inert={pageLoading}
        >
          <span className="rank-number" aria-label={"الأولوية " + number(rank)}>
            {number(rank).padStart(2, "٠")}
          </span>
          <div className="row-copy">
            <div className="row-category">
              <Icon name={o.icon} />
              {o.category}
            </div>
            <h3>{o.title}</h3>
            <p>{o.text}</p>
          </div>
          <div className="row-amount">
            <span>وفر محتمل / الشهر</span>
            <strong>
              <Money value={amt} />
            </strong>
          </div>
          <div className="row-status">
            <span className={"status-badge status-" + s.status}>
              {statuses[s.status]}
            </span>
          </div>
          <button
            className="review-button"
            data-review={o.id || i}
            aria-label={"مراجعة: " + o.title}
            onClick={() => {
              setCurrent(i);
              w.closeMenu();
            }}
          >
            مراجعة الفرصة
          </button>
          {pageLoading && <Skeleton />}
        </article>
      );
    }) : (
      !pageLoading ? (
        <div style={{ padding: "36px", textAlign: "center", color: "#64748b", background: "white", borderRadius: "12px", border: "1px solid #e9edf3" }}>
          <p style={{ margin: "0 0 6px", fontWeight: "500", color: "#334155" }}>لا توجد فرص مسجلة حاليًا لهذه الفترة</p>
          <small style={{ color: "#94a3b8" }}>يمكنك إضافة مصادر البيانات عبر مركز البيانات للبدء في توليد فرص التوفير.</small>
        </div>
      ) : null
    ),
    "sheet-content":
      current !== null && displayedOpportunities[current] ? (
        <OpportunityDetails
          key={month + (displayedOpportunities[current]?.id || current)}
          id={current}
          month={month}
          s={isFactsFiles ? (workflowMap[displayedOpportunities[current]?.id] || { status: "new" }) : (states[current] || { status: "new" })}
          o={displayedOpportunities[current]}
          transition={transition}
        />
      ) : null,
    "dialog-content": (
      <InfoContent info={w.info} onClose={() => w.setInfo(null)} />
    ),
    toast: toast,
    "loading-status": pageLoading
      ? "جاري تحميل فرص " + m.name
      : number(ids.length) + " فرص معروضة",
  };

  return (
    <View
      active="opportunities"
      loading={pageLoading}
      slots={slots}
      refs={w.refs}
      bindings={{
        ...w.bindings,
        period: {
          value: month,
          onChange: (e) => {
            setCurrent(null);
            update({ month: e.target.value, opportunity: null });
          },
        },
        sort: { value: sort, onChange: (e) => setSort(e.target.value) },
        ...Object.fromEntries(
          ["all", "0", "1", "2"].map((c) => [
            "data-filter:" + c,
            {
              "aria-pressed": category === c,
              className: "filter-pill" + (category === c ? " selected" : ""),
              onClick: () => setCategory(c),
            },
          ]),
        ),
        ".opportunity-toolbar": { inert: pageLoading },
        "opportunity-list": { "aria-busy": pageLoading },
        "opportunity-dialog": {
          open: current !== null,
          onClose: () => setCurrent(null),
        },
        "close-sheet": { onClick: () => setCurrent(null) },
        toast: { className: "toast" + (toast ? " visible" : "") },
        "advisor-button": { onClick: () => openAskJadwa() },
      }}
    />
  );
}

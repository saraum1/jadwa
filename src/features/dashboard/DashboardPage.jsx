import { useState, useEffect } from "react";
import View from "./components/DashboardView.jsx";
import { months, opportunities as defaultOpportunities } from "../../shared/data/demo.js";
import { useQuery, useWorkspace } from "../../shared/lib/hooks.js";
import {
  number,
  Money,
  Text,
  Icon,
  Skeleton,
} from "../../shared/ui/primitives.jsx";
import { JadwaSession } from "../../shared/lib/session.js";
import { dashboardService } from "./services/dashboardService.js";
import { opportunityService } from "../opportunities/services/opportunityService.js";
import { useAuth } from "../../shared/lib/authContext.jsx";
import { computeAvatarInitial, formatChange } from "../../shared/types/dto.js";
import { openAskJadwa } from "../ai/client.js";
import { usePeriodFacts, getSourceLabel } from "../ai/usePeriodFacts.js";

function Chart({ m }) {
  const xs = [55, 220, 385, 550],
    y = (v) => 145 - (v / 16000) * 125,
    path = (v) =>
      v ? v.map((n, i) => (i ? "L" : "M") + xs[i] + " " + y(n)).join(" ") : "",
    labels = [
      "الأسبوع الأول",
      "الأسبوع الثاني",
      "الأسبوع الثالث",
      "الأسبوع الرابع",
    ];
  const hasCosts = Array.isArray(m.costs) && m.costs.some((c) => typeof c === "number" && Number.isFinite(c));
  return (
    <svg
      className="chart-svg"
      viewBox="0 0 600 180"
      role="img"
      aria-label={
        hasCosts
          ? "المبيعات والتكاليف الأسبوعية لشهر " +
            m.name +
            "، جميع قيم المبيعات أعلى من التكاليف. اضغط عرض الأرقام للتفاصيل."
          : "المبيعات الأسبوعية لشهر " + m.name + ". اضغط عرض الأرقام للتفاصيل."
      }
      dir="ltr"
    >
      <defs>
        <linearGradient id="fillBlue" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#2563eb" stopOpacity=".12" />
          <stop offset="1" stopColor="#2563eb" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 5000, 10000, 15000].map((v) => (
        <g key={v}>
          <line
            x1="55"
            x2="550"
            y1={y(v)}
            y2={y(v)}
            stroke="#e9eef6"
            strokeDasharray="3 5"
          />
          <text x="36" y={y(v) + 4} textAnchor="end">
            {v ? number(v / 1000) + " ألف" : "٠"}
          </text>
        </g>
      ))}
      <path d={path(m.sales) + " L550 145 L55 145Z"} fill="url(#fillBlue)" />
      {hasCosts && <path d={path(m.costs)} fill="none" stroke="#25be98" strokeWidth="2.3" />}
      <path d={path(m.sales)} fill="none" stroke="#2563eb" strokeWidth="2.5" />
      {m.sales.map((v, i) => (
        <g key={i}>
          <circle
            cx={xs[i]}
            cy={y(v)}
            r="4"
            fill="#2563eb"
            stroke="white"
            strokeWidth="2"
          >
            <title>
              {labels[i] +
                ": مبيعات " +
                number(v) +
                " ريال" +
                (hasCosts && m.costs?.[i] != null
                  ? "، تكاليف " + number(m.costs[i]) + " ريال"
                  : "")}
            </title>
          </circle>
          {hasCosts && m.costs?.[i] != null && (
            <circle
              cx={xs[i]}
              cy={y(m.costs[i])}
              r="3"
              fill="#25be98"
              stroke="white"
              strokeWidth="1.5"
            />
          )}
          <text x={xs[i]} y="171" textAnchor="middle">
            {labels[i]}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function DashboardPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const isGuest = user?.isGuest ?? false;

  const [params, update] = useQuery(),
    month = Object.hasOwn(months, params.get("month"))
      ? params.get("month")
      : "sep",
    workspace = useWorkspace(month, "dashboard");

  const { facts, source, loading: factsLoading } = usePeriodFacts(month);

  useEffect(() => {
    if (!authLoading && !user) {
      location.replace("login.html");
    }
  }, [authLoading, user]);

  const [metricData, setMetricData] = useState(null);
  const [opportunitiesList, setOpportunitiesList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !user) return;
    let active = true;
    setLoading(true);

    Promise.all([
      dashboardService.getPeriodMetrics(month, isGuest),
      opportunityService.getOpportunities(month, isGuest),
    ]).then(([periodRes, opsRes]) => {
      if (!active) return;
      if (periodRes) {
        setMetricData(periodRes);
      }
      setOpportunitiesList(opsRes || []);
      setLoading(false);
    }).catch(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [month, authLoading, user, isGuest]);

  const isFactsFiles = facts && facts.source === "files";

  const fileMetricData = isFactsFiles
    ? {
        name: month === "aug" ? "أغسطس" : "سبتمبر",
        revenue: facts.summary?.revenue ?? 0,
        cost: facts.summary?.totalCost ?? 0,
        profit: facts.summary?.profit ?? 0,
        saving: facts.losses?.expectedSaving ?? 0,
        sales: facts.weeklySales || [0, 0, 0, 0],
        costs: null,
        changes: [
          facts.changes?.revenuePct != null
            ? (facts.changes.revenuePct >= 0 ? "+" : "") + facts.changes.revenuePct + "٪"
            : "—",
          facts.changes?.totalCostPct != null
            ? (facts.changes.totalCostPct >= 0 ? "+" : "") + facts.changes.totalCostPct + "٪"
            : "—",
          facts.changes?.profitPct != null
            ? (facts.changes.profitPct >= 0 ? "+" : "") + facts.changes.profitPct + "٪"
            : "—",
        ],
        amounts: facts.decisions.slice(0, 3).map((d) => d.saving),
      }
    : null;

  const fileOpportunities = isFactsFiles
    ? facts.decisions.slice(0, 3).map((d) => ({
        id: d.id,
        title: d.title,
        text: d.cause || d.problem,
        potentialSaving: d.saving,
        category: d.categoryName,
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
        tint:
          d.category === "losing_product"
            ? "#fef2f2"
            : d.category === "duplicate_subscription"
              ? "#fefce8"
              : "#eff6ff",
      }))
    : null;

  const m = fileMetricData || metricData || {
    name: month === "aug" ? "أغسطس" : "سبتمبر",
    revenue: 0,
    cost: 0,
    profit: 0,
    saving: 0,
    sales: [0, 0, 0, 0],
    costs: [0, 0, 0, 0],
    changes: ["٠٪", "٠٪", "٠٪"],
    amounts: [0, 0, 0],
  };

  const displayedOpportunities = fileOpportunities || opportunitiesList;
  const pageLoading = isFactsFiles ? factsLoading : (loading || factsLoading);

  const displayName = user?.profile?.fullName || (isGuest ? "الشيماء" : (user?.email?.split("@")[0] || "مستخدم"));
  const avatarChar = isGuest
    ? "ش"
    : (computeAvatarInitial(user?.profile?.fullName, user?.email) || (displayName ? displayName.charAt(0) : "م"));
  const [dialog, setDialog] = useState(null),
    [answer, setAnswer] = useState("");
  const period = JadwaSession.periodFor(month),
    files = JadwaSession.forPeriod(period);

  const open = (kind) => {
    setAnswer("");
    setDialog(kind);
    workspace.closeMenu();
  };
  const close = () => setDialog(null);
  const go = (page) => (location.href = page);

  const firstSaving = m.amounts?.[0] || 1200;
  const answers = {
    saving: `ابدأ بمراجعة هدر المكونات: هو أكبر فرصة في هذا المثال، بوفر محتمل ${number(firstSaving)} ⃁ من أصل ${number(m.saving)} ⃁. راجع الاستهلاك الفعلي قبل تعديل كميات الشراء.`,
    profit: `صافي الربح في عينة ${m.name} = المبيعات ${number(m.revenue)} ⃁ − إجمالي التكاليف ${number(m.cost)} ⃁ = ${number(m.profit)} ⃁. تشمل التكاليف تكلفة المبيعات والمصروفات والهدر مرة واحدة.`,
    sources:
      "التحليل في هذه النسخة مبني على بيانات المبيعات والتكاليف والمخزون والهدر مع الربط بقاعدة بيانات السحابة.",
  };

  let content;
  if (dialog === "meeting")
    content = (
      <>
        <h2 id="dialog-title" className="dialog-title">
          كيف تحب نبدأ الاجتماع؟
        </h2>
        <p className="dialog-description">
          أضف ملفات جديدة قبل الدخول، أو تابع بالبيانات المتاحة للفترة
          المحددة.
        </p>
        <div className="meeting-choices">
          <button
            className="meeting-choice"
            id="meeting-upload"
            onClick={() =>
              go("data-hub.html?month=" + month + "&return=meeting")
            }
          >
            <Icon name="file" />
            <span>
              <strong>إضافة ملفات قبل الاجتماع</strong>
              <small>
                افتح مركز البيانات لرفع ملفات CSV ومراجعتها، ثم انتقل
                للاجتماع.
              </small>
            </span>
          </button>
          <button
            className="meeting-choice primary-choice"
            id="meeting-continue"
            onClick={() =>
              go(
                "meeting.html?month=" +
                  month +
                  "&period=" +
                  period +
                  "&mode=" +
                  (files.length ? "files" : "demo"),
              )
            }
          >
            <Icon name="video" />
            <span>
              <strong>
                {files.length
                  ? "المتابعة بالملفات الموجودة"
                  : "المتابعة بالبيانات التوضيحية"}
              </strong>
              <small>
                {files.length
                  ? number(files.length) +
                    " ملفات مرتبطة بفترة " +
                    m.name
                  : "لا توجد ملفات مضافة لهذه الفترة. يمكنك بدء الاجتماع بالبيانات التوضيحية."}
              </small>
            </span>
          </button>
        </div>
        <ul id="meeting-files" className="meeting-file-list">
          {files.map((f) => (
            <li key={f.id}>
              {f.name}
              {f.origin === "demo" ? " · عينة توضيحية" : ""}
            </li>
          ))}
        </ul>
        <p className="meeting-note">
          تناقش جدوى معك مؤشرات الفترة والفرص والقرارات المكتشفة في بياناتك صوتيًا في الغرفة التفاعلية.
        </p>
      </>
    );
  else if (dialog === "advisor")
    content = (
      <>
        <h2 id="dialog-title" className="dialog-title">
          ما الذي تودّين معرفته؟
        </h2>
        <p className="dialog-description">
          اختر سؤالًا لتجربة طريقة عرض الإجابة. الإجابات هنا معدّة من بيانات
          المثال؛ لا يوجد اتصال بنموذج ذكاء اصطناعي بعد.
        </p>
        {[
          ["saving", "من أين أبدأ لتحسين الربحية؟"],
          ["profit", "كيف تم حساب صافي الربح؟"],
          ["sources", "ما البيانات التي بُني عليها التحليل؟"],
        ].map(([key, label]) => (
          <button
            key={key}
            className="suggestion"
            data-question={key}
            onClick={() => setAnswer(answers[key])}
          >
            {label}
          </button>
        ))}
        <div
          id="advisor-answer"
          className={answer ? "advisor-answer" : ""}
          aria-live="polite"
        >
          <Text>{answer}</Text>
        </div>
      </>
    );
  else if (dialog === "chart")
    content = (
      <>
        <h2 id="dialog-title" className="dialog-title">
          الأرقام الأسبوعية · {m.name}
        </h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>الأسبوع</th>
              <th>المبيعات</th>
              <th>التكاليف</th>
            </tr>
          </thead>
          <tbody>
            {m.sales.map((v, i) => (
              <tr key={i}>
                <td>{number(i + 1)}</td>
                <td>
                  <Money value={v} />
                </td>
                <td>
                  {m.costs && m.costs[i] != null ? (
                    <Money value={m.costs[i]} />
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <th>الإجمالي</th>
              <th>
                <Money value={m.revenue} />
              </th>
              <th>
                {m.cost != null ? <Money value={m.cost} /> : "—"}
              </th>
            </tr>
          </tbody>
        </table>
        <p className="dialog-description">
          القيم توضيحية، ومتسقة مع مؤشرات الملخص.
        </p>
        <button className="primary-button" onClick={close}>
          إغلاق
        </button>
      </>
    );

  const slots = {
    "mini-avatar": avatarChar,
    "demo-label": getSourceLabel(facts?.source || (isGuest ? "demo" : "database")),
    greeting: (
      <>
        {(new Date().getHours() < 12 ? "صباح الخير، " : "مساء الخير، ") + displayName.split(" ")[0] + " "}
        <span className="greeting-dot"></span>
      </>
    ),
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
    "period-footer": (facts?.source === "files" ? "ملفات " : (isGuest ? "بيانات توضيحية · " : "فترة ")) + m.name + " ٢٠٢٦",
    ...Object.fromEntries(
      ["revenue", "cost", "profit", "saving"].map((k) => [k, number(m[k] || 0)]),
    ),
    ...Object.fromEntries(
      ["revenue", "cost", "profit"].map((k, i) => [
        k + "-change",
        typeof m.changes?.[i] === "string" ? m.changes[i] : (formatChange(m.changes?.[i]) || "—"),
      ]),
    ),
    "chart-wrap": <Chart m={m} />,
    "loading-status":
      (pageLoading ? "جاري تحميل بيانات " : "تم تحميل بيانات ") + m.name,
    "dialog-eyebrow":
      dialog === "meeting"
        ? "اجتماع مع جدوى"
        : dialog === "advisor"
          ? "اسأل جدوى · معاينة"
          : "أداء المنشأة",
    "dialog-content": content,
    "opportunity-grid": displayedOpportunities.length > 0 ? displayedOpportunities.map((o, i) => {
      const savingAmt = o.potentialSaving ?? m.amounts?.[i] ?? 0;
      return (
        <article
          key={o.id || i}
          className={"opportunity-card" + (pageLoading ? " is-loading" : "")}
          style={{ "--accent": o.accent, "--tint": o.tint }}
          inert={pageLoading}
        >
          <div className="opportunity-top">
            <span className="category">{o.category}</span>
            <span className="opportunity-icon">
              <Icon name={o.icon} />
            </span>
          </div>
          <h3>{o.title}</h3>
          <p>{o.text}</p>
          <div className="opportunity-saving">
            <span>وفر محتمل / الشهر</span>
            <b>
              <Money value={savingAmt} />
            </b>
          </div>
          <button
            data-opportunity={o.id || i}
            aria-label={"راجع تفاصيل: " + o.title}
            onClick={() =>
              go("opportunities.html?month=" + month + "&opportunity=" + (o.id ? encodeURIComponent(o.id) : i))
            }
          >
            راجع التفاصيل
          </button>
          {pageLoading && <Skeleton />}
        </article>
      );
    }) : (
      !pageLoading ? (
        <div style={{ gridColumn: "1 / -1", padding: "32px", textAlign: "center", color: "#64748b", background: "white", borderRadius: "12px", border: "1px solid #e9edf3" }}>
          <p style={{ margin: "0 0 6px", fontWeight: "500", color: "#334155" }}>لا توجد فرص مسجلة حاليًا لهذه الفترة</p>
          <small style={{ color: "#94a3b8" }}>يمكنك إضافة ملفات المبيعات والمصروفات من مركز البيانات لبدء التحليل واكتشاف فرص التوفير.</small>
        </div>
      ) : null
    ),
  };

  return (
    <View
      active="dashboard"
      loading={pageLoading}
      slots={slots}
      refs={workspace.refs}
      bindings={{
        ...workspace.bindings,
        period: {
          value: month,
          onChange: (e) => update({ month: e.target.value }),
        },
        "meeting-button": { onClick: () => open("meeting") },
        "advisor-button": { onClick: () => openAskJadwa() },
        "chart-data": { onClick: () => open("chart") },
        "detail-dialog": { open: !!dialog, onClose: close },
        "close-dialog": { onClick: close },
        ".metrics": { "aria-busy": pageLoading },
        ".opportunity-grid": { "aria-busy": pageLoading },
        ".bottom-grid": { "aria-busy": pageLoading },
      }}
    />
  );
}

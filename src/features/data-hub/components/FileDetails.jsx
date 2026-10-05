import { useState, useEffect } from "react";
import { HubData } from "../model/csv.js";
import { number, Icon } from "../../../shared/ui/primitives.jsx";
export const monthName = (p) =>
  p
    ? new Intl.DateTimeFormat("ar-SA", {
        month: "long",
        year: "numeric",
        calendar: "gregory",
        timeZone: "UTC",
      }).format(new Date(p + "-01T00:00:00Z"))
    : "—";
export const time = (t) =>
  new Intl.DateTimeFormat("ar-SA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(t));
export const warnCount = (r) =>
  r.issues.filter((i) => i.level === "warning").length;
export function Badge({ result: r }) {
  if (!r) return null;
  return (
    <span className={"hub-badge " + (warnCount(r) ? "review" : "ready")}>
      {warnCount(r) ? "يحتاج مراجعة ربط" : "جاهز للربط"}
    </span>
  );
}
export function PreviewTable({ headers = [], rows = [] }) {
  if (!rows || !rows.length) return null;
  return (
    <table>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 5).map((r, i) => {
          const cells = Array.isArray(r?.cells)
            ? r.cells
            : headers.length
              ? headers.map((h) => r?.[h] ?? r?.values?.[h] ?? "")
              : Object.values(r?.values || r || {});
          return (
            <tr key={i}>
              {cells.map((c, j) => (
                <td key={j}>{typeof c === "object" ? JSON.stringify(c) : String(c ?? "")}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
export function Issues({ result }) {
  if (!result) return null;
  return !result.issues?.length ? (
    <div className="hub-issue">
      <Icon name="check" /> اجتازت السجلات فحوص الحقول والتواريخ والأرقام. هذا
      لا يتحقق من صحة المستندات الأصلية.
    </div>
  ) : (
    <>
      {result.issues.slice(0, 50).map((i, n) => (
        <div key={n} className={"hub-issue " + i.level}>
          <b>
            {i.line ? "السطر " + number(i.line) + " · " : ""}
            {i.field}
          </b>
          <br />
          {i.message}
        </div>
      ))}
      {result.issues.length > 50 && (
        <p className="hub-small">
          عرض أول ٥٠ ملاحظة من {number(result.issues.length)}. صحح الملف وأعد
          رفعه لمراجعة البقية.
        </p>
      )}
    </>
  );
}
export function FileSummary({ file: d }) {
  if (!d) return null;
  const validCount = d.result?.valid?.length || 0;
  const invalidCount = d.result?.invalid?.length || 0;
  const issuesCount = d.result ? warnCount(d.result) : 0;
  const schemaLabel = HubData.schemas[d.type]?.label || d.type;
  return (
    <dl className="hub-confirm">
      {[
        ["اسم الملف", d.name || "—"],
        ["المصدر", schemaLabel],
        ["الفترة", monthName(d.result?.period)],
        ["سجلات ستُجهّز", number(validCount)],
        ["سجلات ستُستبعد", number(invalidCount)],
        ["ملاحظات للمراجعة", number(issuesCount)],
      ].map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
export default function FileDetails({ file: f, onReplace, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setConfirmDelete(false), [f?.id]);
  if (!f) return null;
  return (
    <>
      <Badge result={f.result} />
      <FileSummary file={f} />
      <p className="hub-small">
        {f.origin === "demo"
          ? "عينة توضيحية مصغرة لتجربة الاستيراد، وليست ملفات التحليلات الحالية."
          : "ملفك محفوظ في حسابك (أو في هذا التبويب للزائر)."}
      </p>
      <h3>الأعمدة المطابقة</h3>
      <dl className="hub-confirm">
        {HubData.schemas[f.type]?.fields
          .filter((k) => {
            const m = f.mapping?.[k];
            return (typeof m === "number" && m >= 0) || (typeof m === "string" && m.trim().length > 0);
          })
          .map((k) => {
            const m = f.mapping[k];
            const headerName = typeof m === "number" ? f.parsed?.headers?.[m] : m;
            return (
              <div key={k}>
                <dt>{HubData.fields[k]?.[0] || k}</dt>
                <dd>{headerName || "—"}</dd>
              </div>
            );
          })}
      </dl>
      <h3>أول خمسة سجلات مقبولة</h3>
      <div className="hub-table-scroll">
        <PreviewTable headers={f.parsed?.headers} rows={f.result?.valid} />
      </div>
      <h3 style={{ marginTop: 24 }}>ملاحظات الفحص</h3>
      <Issues result={f.result} />
      <button className="hub-secondary" onClick={() => onReplace(f)}>
        اختيار ملف بديل
      </button>
      {onDelete && (
        <button
          className="hub-secondary"
          style={{ marginInlineStart: 8, color: "#b42318", borderColor: "#f3c5bc" }}
          onClick={() => (confirmDelete ? onDelete(f) : setConfirmDelete(true))}
        >
          {confirmDelete ? "تأكيد حذف الملف" : "حذف الملف"}
        </button>
      )}
    </>
  );
}

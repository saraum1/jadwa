/*
 * «اسأل جدوى» — لوحة شات حقيقية تُركَّب مرة واحدة لصفحات التطبيق.
 * تُفتح بـ openAskJadwa(question?) من أي زر. تجيب من نتائج المحرك فقط.
 */
import { useEffect, useRef, useState } from "react";
import { ask, openAskJadwa } from "./client.js";
import { loadFacts } from "./dataset.js";
import "./ai.css";

const money = (n) => new Intl.NumberFormat("ar-SA").format(n);
const storeKey = (p) => "jadwa-chat-v1-" + p;

function periodFromUrl() {
  const params = new URLSearchParams(location.search);
  const p = params.get("period");
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(p || "")) return p;
  return params.get("month") === "aug" ? "2026-08" : "2026-09";
}

// Markdown بسيط → عناصر React (بدون HTML خام)
function Rich({ text }) {
  const inline = (s, k) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <b key={k + "-" + i}>{part.slice(2, -2)}</b> : part,
    );
  const blocks = [];
  let list = null;
  text.split(/\n+/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const item = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)/);
    if (item) {
      if (!list) blocks.push((list = { items: [] }));
      list.items.push(inline(item[1], i));
    } else {
      list = null;
      blocks.push(<p key={i}>{inline(line, i)}</p>);
    }
  });
  return blocks.map((b, i) =>
    b.items ? (
      <ul key={"l" + i}>
        {b.items.map((it, j) => (
          <li key={j}>{it}</li>
        ))}
      </ul>
    ) : (
      b
    ),
  );
}

function suggestions(f) {
  const list = ["وش أكثر شي يخسرني؟"];
  const product = f?.decisions.find((d) => d.category === "losing_product");
  if (product) list.push(`إذا رفعت سعر ${product.subject} كم أوفر؟`);
  if (f?.decisions.some((d) => d.category === "waste")) list.push("كيف أقلل الهدر؟");
  list.push("من وين أبدأ اليوم؟", "على أي بيانات بنيت التحليل؟");
  return list.slice(0, 4);
}

export default function AskJadwa() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(periodFromUrl);
  const [facts, setFacts] = useState(undefined); // undefined = لم تُحمّل، null = لا بيانات
  const [history, setHistory] = useState(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(storeKey(periodFromUrl())) || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });
  const [pending, setPending] = useState(null); // {question, answer, error}
  const [input, setInput] = useState("");
  const busy = useRef(null),
    list = useRef(),
    field = useRef(),
    opener = useRef(null),
    queued = useRef(null);

  useEffect(() => {
    const onOpen = (e) => {
      opener.current = document.activeElement;
      document.querySelectorAll("dialog[open]").forEach((d) => d.close());
      setOpen(true);
      if (e.detail?.question) queued.current = e.detail.question;
      setFacts((prev) => (prev === null ? undefined : prev));
    };
    window.addEventListener("jadwa:open-ask", onOpen);
    return () => window.removeEventListener("jadwa:open-ask", onOpen);
  }, []);

  useEffect(() => {
    if (!open || facts !== undefined) return;
    let alive = true;
    loadFacts(period)
      .then((f) => {
        if (!alive) return;
        setFacts(f);
        if (f?.period && f.period !== period) setPeriod(f.period);
      })
      .catch(() => alive && setFacts(null));
    return () => {
      alive = false;
    };
  }, [open, facts, period]);

  useEffect(() => {
    if (open && facts !== undefined && queued.current) {
      const q = queued.current;
      queued.current = null;
      send(q);
    } else if (open) field.current?.focus();
  }, [open, facts]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storeKey(period), JSON.stringify(history.slice(-30)));
    } catch {}
  }, [history, period]);

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [history, pending]);

  async function send(text) {
    text = String(text || "").trim();
    if (!text || busy.current) return;
    setInput("");
    const prior = history.slice(-12);
    setPending({ question: text, answer: "" });
    busy.current = new AbortController();
    try {
      const full = await ask({
        facts,
        message: text,
        history: prior,
        signal: busy.current.signal,
        onToken: (t) => setPending({ question: text, answer: t }),
      });
      setHistory((h) => [...h, { role: "user", text }, { role: "model", text: full }]);
      setPending(null);
    } catch (e) {
      if (e.name === "AbortError") setPending(null);
      else setPending({ question: text, error: e.message });
    } finally {
      busy.current = null;
      field.current?.focus();
    }
  }

  function close() {
    setOpen(false);
    opener.current?.focus?.();
  }

  function reset() {
    busy.current?.abort();
    setHistory([]);
    setPending(null);
    setFacts(undefined);
  }

  if (!open) return null;
  const loading = facts === undefined;
  return (
    <section className="jai-panel" role="dialog" aria-label="اسأل جدوى" onKeyDown={(e) => e.key === "Escape" && close()}>
      <header className="jai-head">
        <span className="jai-avatar" aria-hidden="true">
          ج
        </span>
        <div>
          <b>اسأل جدوى</b>
          <small>
            {loading
              ? "جدوى يراجع أرقامك…"
              : facts
                ? `${facts.periodName} · ${{ demo: "بيانات توضيحية", files: "ملفاتك المرفوعة", database: "بيانات حسابك" }[facts.source]}`
                : "لا توجد بيانات"}
          </small>
        </div>
        <button className="jai-icon" title="محادثة جديدة" aria-label="محادثة جديدة" onClick={reset}>
          ↺
        </button>
        <button className="jai-icon" aria-label="إغلاق" onClick={close}>
          ✕
        </button>
      </header>
      <div className="jai-messages" ref={list} aria-live="polite">
        {loading ? (
          <div className="jai-msg jai-model jai-intro">
            <span className="jai-typing">
              <i />
              <i />
              <i />
            </span>
          </div>
        ) : facts ? (
          <div className="jai-msg jai-model jai-intro">
            <Rich
              text={`أهلًا، أنا جدوى. راجعت بيانات ${facts.periodName}.\nالخسارة الشهرية المقدرة: **${money(facts.losses.total)} ريال** من ${facts.decisions.length} أسباب، والتوفير المتوقع **${money(facts.losses.expectedSaving)} ريال**.\nاسألني أي شي عنها.`}
            />
          </div>
        ) : (
          <div className="jai-msg jai-model jai-error">
            <p>لا توجد بيانات لهذه الفترة بعد. أضف ملفاتك من مركز البيانات ثم اسألني.</p>
          </div>
        )}
        {history.map((t, i) => (
          <div key={i} className={"jai-msg jai-" + t.role}>
            {t.role === "user" ? <p>{t.text}</p> : <Rich text={t.text} />}
          </div>
        ))}
        {pending && (
          <>
            <div className="jai-msg jai-user">
              <p>{pending.question}</p>
            </div>
            <div className={"jai-msg jai-model" + (pending.error ? " jai-error" : "")}>
              {pending.error ? (
                <p>{pending.error}</p>
              ) : pending.answer ? (
                <Rich text={pending.answer} />
              ) : (
                <span className="jai-typing">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </div>
          </>
        )}
      </div>
      {!history.length && !pending && facts && (
        <div className="jai-suggestions">
          {suggestions(facts).map((q) => (
            <button key={q} type="button" onClick={() => send(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <form
        className="jai-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          ref={field}
          rows={1}
          maxLength={1000}
          value={input}
          disabled={loading || !facts}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="اسأل عن أرباحك، خسائرك، أو أي صنف…"
          aria-label="سؤالك"
        />
        <button type="submit" aria-label="إرسال" disabled={!!busy.current || loading || !facts}>
          ↑
        </button>
      </form>
      <p className="jai-note">الأرقام محسوبة من بياناتك؛ جدوى يشرحها ولا يخترعها.</p>
    </section>
  );
}

export { openAskJadwa };

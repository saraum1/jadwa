/*
 * اجتماع جدوى الصوتي
 *  الكلام ← نص: SpeechRecognition من المتصفح (مجاني)
 *  النص ← نفس عقل جدوى: /api/chat بدور «الاجتماع» ونفس نتائج المحرك
 *  الرد ← صوت: /api/tts (Gemini)، ولو تعذّر يكمل بصوت المتصفح
 *  الوجه: getRoom().setFace({mouth, glow}) + أحداث window للأنيميشن:
 *    jadwa:state {state} · jadwa:mouth {level 0..1} · jadwa:say {text}
 */
import { useEffect, useRef, useState } from "react";
import { ask, speak, plain } from "./client.js";
import { loadFacts } from "./dataset.js";
import "./ai.css";

const MEMORY_KEY = "jadwa-last-meeting-v1";
const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const STATES = {
  idle: ["جاهز. جدوى راجع أرقامك وينتظرك.", ""],
  loading: ["جدوى يراجع أرقامك…", "thinking"],
  thinking: ["جدوى يفكر…", "thinking"],
  speaking: ["جدوى يتكلم… (اضغطي «تكلّمي» لمقاطعته)", "speaking"],
  listening: ["أسمعك… تكلّمي الآن", "listening"],
  waiting: [Recognition ? "اضغطي «تكلّمي» واسألي جدوى" : "اكتبي سؤالك لجدوى", ""],
  closing: ["جدوى يجهز خطة العمل…", "thinking"],
  done: ["انتهى الاجتماع. خطة العمل تحت.", ""],
};
const emit = (name, detail) => window.dispatchEvent(new CustomEvent("jadwa:" + name, { detail }));
const fmt = (n) => new Intl.NumberFormat("ar-SA").format(n);

function previousMeeting() {
  try {
    const m = JSON.parse(localStorage.getItem(MEMORY_KEY) || "null");
    return m && m.actions?.length ? m : null;
  } catch {
    return null;
  }
}

export function useMeetingVoice({ period, getRoom }) {
  const [phase, setPhaseState] = useState("idle");
  const [status, setStatus] = useState(STATES.idle[0]);
  const [lines, setLines] = useState([]); // {role, text, error}
  const [caption, setCaption] = useState("");
  const [plan, setPlan] = useState(null);
  const [active, setActive] = useState(false);
  const [note, setNote] = useState("");
  const r = useRef({ phase: "idle", history: [], facts: undefined, audioCtx: null, source: null, recognizer: null, abort: null, browserVoice: false, active: false, alive: true });

  const face = (v) => getRoom()?.setFace?.(v);
  const mouth = (level) => {
    face({ mouth: level });
    emit("mouth", { level });
  };
  function setPhase(p, extra) {
    r.current.phase = p;
    setPhaseState(p);
    setStatus(extra || STATES[p][0]);
    emit("state", { state: p });
    face({ glow: p === "listening" ? 1 : p === "thinking" || p === "loading" ? 0.4 : 0 });
  }
  const pushLine = (line) => setLines((l) => [...l, line]);
  const updateLast = (patch) => setLines((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, ...patch } : x)));

  // ---------- الصوت ----------
  function stopSpeaking() {
    try {
      r.current.source?.stop();
    } catch {}
    r.current.source = null;
    if (window.speechSynthesis) speechSynthesis.cancel();
    mouth(0);
  }
  async function speakWithGemini(text) {
    const ctx = (r.current.audioCtx ||= new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === "suspended") await ctx.resume();
    const buffer = await ctx.decodeAudioData(await speak(text));
    const source = ctx.createBufferSource(),
      analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.buffer = buffer;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    r.current.source = source;
    const samples = new Float32Array(analyser.fftSize);
    let level = 0,
      playing = true;
    (function animate() {
      if (!playing) return;
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
      level = level * 0.55 + Math.min(1, Math.max(0, (rms - 0.015) * 7)) * 0.45;
      mouth(level);
      requestAnimationFrame(animate);
    })();
    await new Promise((resolve) => {
      source.onended = resolve;
      source.start();
    });
    playing = false;
    mouth(0);
  }
  function speakWithBrowser(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ar-SA";
      const voices = speechSynthesis.getVoices();
      u.voice = voices.find((v) => v.lang === "ar-SA") || voices.find((v) => v.lang.startsWith("ar")) || null;
      let talking = true,
        t = 0;
      const timer = setInterval(() => {
        if (talking) mouth(0.25 + 0.35 * Math.abs(Math.sin((t += 0.35))) * Math.random());
      }, 70);
      const done = () => {
        talking = false;
        clearInterval(timer);
        mouth(0);
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    });
  }
  async function say(text) {
    setPhase("speaking");
    setCaption(text);
    emit("say", { text });
    try {
      if (!r.current.browserVoice) await speakWithGemini(text);
      else await speakWithBrowser(text);
    } catch (e) {
      r.current.browserVoice = true;
      setNote("صوت جدوى الآن من المتصفح مؤقتًا" + (e.code === "rate_limit" ? " (وصلنا لحد الصوت المجاني)." : "."));
      if (r.current.phase === "speaking") await speakWithBrowser(text);
    }
    setCaption("");
    if (r.current.phase === "speaking" && r.current.alive) {
      setPhase("waiting");
      if (Recognition && r.current.active) listen();
    }
  }

  // ---------- الاستماع ----------
  function listen() {
    if (!Recognition) return;
    stopSpeaking();
    r.current.recognizer?.abort();
    const rec = new Recognition();
    r.current.recognizer = rec;
    rec.lang = "ar-SA";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "",
      started = false;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setCaption(finalText + interim);
      if (!started) {
        started = true;
        pushLine({ role: "user", text: finalText + interim });
      } else updateLast({ text: finalText + interim });
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setNote("اسمحي للمتصفح باستخدام الميكروفون، أو اكتبي سؤالك.");
    };
    rec.onend = () => {
      if (r.current.recognizer === rec) r.current.recognizer = null;
      setCaption("");
      const text = finalText.trim();
      if (text) {
        updateLast({ text });
        respond(text);
      } else {
        if (started) setLines((l) => l.slice(0, -1));
        if (r.current.phase === "listening") setPhase("waiting");
      }
    };
    setPhase("listening");
    try {
      rec.start();
    } catch {
      setPhase("waiting");
    }
  }

  // ---------- عقل جدوى ----------
  async function respond(userText, mode = "meeting") {
    stopSpeaking();
    r.current.abort?.abort();
    const abort = (r.current.abort = new AbortController());
    const history = r.current.history;
    if (userText) history.push({ role: "user", text: userText });
    setPhase("thinking");
    pushLine({ role: "model", text: "…" });
    try {
      const text = await ask({
        facts: r.current.facts,
        mode,
        message: userText || "",
        history: history.slice(-13, userText ? -1 : undefined),
        previousMeeting: mode === "meeting_open" ? previousMeeting() : undefined,
        signal: abort.signal,
        onToken: (t) => updateLast({ text: plain(t) }),
      });
      updateLast({ text: plain(text) });
      history.push({ role: "model", text });
      await say(plain(text));
    } catch (e) {
      if (e.name === "AbortError") return;
      updateLast({ text: e.message, error: true });
      setPhase("waiting");
    }
  }

  async function start() {
    setPlan(null);
    setLines([]);
    setNote(Recognition ? "" : "متصفحك لا يدعم تحويل الكلام إلى نص؛ اكتبي أسئلتك وجدوى يرد بالصوت. (الميكروفون يعمل في Chrome وSafari وEdge)");
    r.current.history = [];
    r.current.active = true;
    setActive(true);
    try {
      const ctx = (r.current.audioCtx ||= new (window.AudioContext || window.webkitAudioContext)());
      ctx.resume();
    } catch {}
    if (r.current.facts === undefined) {
      setPhase("loading");
      r.current.facts = await loadFacts(period).catch(() => null);
    }
    if (!r.current.facts) {
      pushLine({ role: "model", text: "لا توجد بيانات لهذه الفترة بعد. أضيفي ملفاتك من مركز البيانات ثم ادخلي الاجتماع.", error: true });
      setPhase("waiting");
      return;
    }
    await respond("", "meeting_open");
  }

  async function end() {
    stopSpeaking();
    r.current.recognizer?.abort();
    r.current.abort?.abort();
    r.current.active = false;
    setActive(false);
    setPhase("closing");
    try {
      const result = await ask({ facts: r.current.facts, mode: "meeting_close", history: r.current.history.slice(-14) });
      const actions = Array.isArray(result.actions) ? result.actions.filter((a) => a && a.decision) : [];
      setPlan(actions);
      try {
        localStorage.setItem(MEMORY_KEY, JSON.stringify({ date: new Date().toISOString().slice(0, 10), period, actions }));
      } catch {}
      if (result.spoken) {
        pushLine({ role: "model", text: result.spoken });
        await say(result.spoken);
      }
      setPhase("done");
    } catch (e) {
      pushLine({ role: "model", text: e.message, error: true });
      setPhase("idle", "تعذر تجهيز خطة العمل. " + e.message);
    }
  }

  function toggleMic() {
    if (r.current.phase === "listening") r.current.recognizer?.stop();
    else listen();
  }
  function sendText(text) {
    text = text.trim();
    if (!text) return;
    pushLine({ role: "user", text });
    respond(text);
  }

  useEffect(() => {
    r.current.alive = true;
    window.speechSynthesis?.getVoices();
    return () => {
      r.current.alive = false;
      r.current.active = false;
      r.current.abort?.abort();
      r.current.recognizer?.abort();
      try {
        r.current.source?.stop();
      } catch {}
      window.speechSynthesis?.cancel();
    };
  }, []);

  return { phase, status, lines, caption, plan, active, note, start, end, toggleMic, sendText, canListen: !!Recognition };
}

export function VoicePanel({ voice }) {
  const [text, setText] = useState("");
  const list = useRef();
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [voice.lines]);
  const cls = STATES[voice.phase]?.[1] || "";
  const busy = voice.phase === "thinking" || voice.phase === "closing" || voice.phase === "loading";
  return (
    <section className="voice-panel" aria-label="محادثة الاجتماع مع جدوى">
      <div className="voice-bar">
        <div className="voice-status">
          <span className={"voice-dot " + cls} aria-hidden="true" />
          <span role="status">{voice.status}</span>
        </div>
        <div className="voice-controls">
          {!voice.active && voice.phase !== "closing" && (
            <button className="voice-start" onClick={voice.start} disabled={voice.phase === "loading"}>
              {voice.plan ? "اجتماع جديد" : "ابدئي الاجتماع"}
            </button>
          )}
          {voice.active && voice.canListen && (
            <button className="voice-mic" aria-pressed={voice.phase === "listening"} disabled={busy} onClick={voice.toggleMic}>
              <span aria-hidden="true">🎙</span> {voice.phase === "listening" ? "إيقاف" : "تكلّمي"}
            </button>
          )}
          {voice.active && (
            <button className="voice-end" onClick={voice.end}>
              إنهاء الاجتماع
            </button>
          )}
        </div>
      </div>
      {voice.active && (
        <form
          className="voice-type"
          onSubmit={(e) => {
            e.preventDefault();
            voice.sendText(text);
            setText("");
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} autoComplete="off" placeholder="أو اكتبي سؤالك هنا…" aria-label="اكتبي سؤالك" />
          <button type="submit" disabled={busy}>
            إرسال
          </button>
        </form>
      )}
      {voice.lines.length > 0 && (
        <div className="voice-transcript" ref={list} aria-live="polite">
          {voice.lines.map((l, i) => (
            <div key={i} className={"voice-line voice-" + l.role + (l.error ? " voice-error" : "")}>
              <b>{l.role === "user" ? "أنتِ" : "جدوى"}</b>
              <p>{l.text}</p>
            </div>
          ))}
        </div>
      )}
      {voice.plan && (
        <div className="voice-plan">
          <h2>خطة العمل من الاجتماع</h2>
          <ol>
            {voice.plan.map((a, i) => (
              <li key={i}>
                <b>{a.decision}</b>
                <span>{[a.due, typeof a.saving === "number" ? `توفير متوقع ${fmt(a.saving)} ريال` : ""].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="voice-note">
        {voice.note || "جدوى يبدأ الاجتماع بمراجعة أرقامك، يناقشك سببًا سببًا، ثم يختم بخطة عمل. الأرقام محسوبة من بياناتك ولا يخترعها."}
      </p>
    </section>
  );
}

/*
 * الاتصال بخادم جدوى AI (دوال Netlify). المفتاح لا يوجد في الواجهة أبدًا.
 * ask(): نفس العقل للشات والاجتماع؛ الاختلاف فقط في mode.
 */
import { forAI } from "./engine.js";
import { supabase } from "../../shared/lib/supabase.js";

const API = { chat: "/api/chat", tts: "/api/tts" };

// توكن المستخدم من Supabase: الخادم يرفض الطلبات بدون تسجيل دخول
async function headers() {
  const h = { "content-type": "application/json" };
  try {
    const token = (await supabase?.auth.getSession())?.data?.session?.access_token;
    if (token) h.authorization = "Bearer " + token;
  } catch {}
  return h;
}

export class AIError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function failure(res) {
  if (res.status === 401) {
    try {
      const j = await res.json();
      return new AIError(j.error || "سجّلي دخولك أولًا.", "auth");
    } catch {
      return new AIError("سجّلي دخولك أولًا.", "auth");
    }
  }
  if ([404, 405, 501].includes(res.status))
    return new AIError("الذكاء الاصطناعي يعمل بعد نشر الموقع على Netlify (أو بتشغيل netlify dev محليًا). تشغيل npm run dev وحده لا يشغّل الدوال.", "offline");
  try {
    const j = await res.json();
    return new AIError(j.error || "تعذر الحصول على رد.", j.code);
  } catch {
    return new AIError("تعذر الحصول على رد من جدوى.", "error");
  }
}

/** يرجع النص كاملًا، ويستدعي onToken بالنص المتراكم أثناء الوصول. في meeting_close يرجع {spoken, actions}. */
export async function ask({ facts, mode = "chat", message = "", history = [], previousMeeting, onToken, signal } = {}) {
  if (!facts) throw new AIError("لا توجد بيانات لهذه الفترة. أضيفي ملفاتك من مركز البيانات.", "no_data");
  let res;
  try {
    res = await fetch(API.chat, {
      method: "POST",
      signal,
      headers: await headers(),
      body: JSON.stringify({ mode, message, history, facts: forAI(facts), previousMeeting }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new AIError("لا يوجد اتصال بالإنترنت أو الخادم غير متاح.", "network");
  }
  if (!res.ok) throw await failure(res);
  if (mode === "meeting_close") return res.json();
  const reader = res.body.getReader(),
    decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onToken?.(text);
  }
  if (!text.trim()) throw new AIError("لم يصل رد. حاولي مرة ثانية.", "empty");
  return text.trim();
}

/** نص ← صوت WAV (ArrayBuffer) */
export async function speak(text, signal) {
  const res = await fetch(API.tts, {
    method: "POST",
    signal,
    headers: await headers(),
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw await failure(res);
  return res.arrayBuffer();
}

/** يحذف رموز التنسيق قبل القراءة بصوت أو العرض كترجمة */
export const plain = (t) =>
  String(t)
    .replace(/\*\*|__|[#*`>|]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();

/** فتح «اسأل جدوى» من أي مكان (اختياريًا بسؤال جاهز) */
export function openAskJadwa(question) {
  window.dispatchEvent(new CustomEvent("jadwa:open-ask", { detail: { question } }));
}

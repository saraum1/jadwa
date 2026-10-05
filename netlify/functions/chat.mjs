// POST /api/chat
// { mode: chat|meeting|meeting_open|meeting_close|summary, message, history:[{role:'user'|'model',text}], facts, previousMeeting }
// يرجع نصًا يصل تدريجيًا (stream)، أو JSON في وضع meeting_close.
import { buildSystemPrompt, MODES } from '../lib/prompt.mjs';
import { generate, generateStream } from '../lib/gemini.mjs';
import { readBody, json, errorResponse } from '../lib/http.mjs';

const OPENERS = {
  meeting_open: 'ابدأ الاجتماع الآن.',
  meeting_close: 'انتهى الاجتماع. جهّز خطة العمل.',
  summary: 'اكتب ملخص الصفحة الرئيسية.'
};

export default async (req) => {
  try {
    const body = await readBody(req, 120_000);
    const mode = MODES.includes(body.mode) ? body.mode : 'chat';
    if (!body.facts || typeof body.facts !== 'object') return json(400, { error: 'لا توجد نتائج تحليل مرفقة بالسؤال.' });
    const message = String(body.message || OPENERS[mode] || '').trim().slice(0, 1000);
    if (!message) return json(400, { error: 'اكتب سؤالك أولًا.' });

    const history = (Array.isArray(body.history) ? body.history : []).slice(-12)
      .filter(t => t && typeof t.text === 'string' && t.text.trim())
      .map(t => ({ role: t.role === 'model' ? 'model' : 'user', parts: [{ text: t.text.slice(0, 2000) }] }));
    // Gemini يتوقع محادثة تبدأ بالمستخدم وتتناوب الأدوار؛ ندمج المتتالي ونضيف بداية عند الحاجة.
    const contents = [];
    for (const turn of [...history, { role: 'user', parts: [{ text: message }] }]) {
      const last = contents.at(-1);
      if (last && last.role === turn.role) last.parts[0].text += '\n' + turn.parts[0].text;
      else contents.push({ role: turn.role, parts: [{ text: turn.parts[0].text }] });
    }
    if (contents[0].role === 'model') contents.unshift({ role: 'user', parts: [{ text: OPENERS.meeting_open }] });
    const system = buildSystemPrompt(mode, body.facts, body.previousMeeting || null);

    if (mode === 'meeting_close') {
      const text = await generate(system, contents, { maxTokens: 1500, json: true });
      let plan;
      try { plan = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { plan = { spoken: text, actions: [] }; }
      return json(200, plan);
    }

    // سقف مرتفع لأن توكنز «التفكير» تُحسب منه؛ طول الرد الفعلي تحدده التعليمات.
    const maxTokens = mode === 'chat' ? 1500 : 900;
    const fast = mode.startsWith('meeting');
    const stream = await generateStream(system, contents, { maxTokens, fast });
    return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config = { path: '/api/chat' };

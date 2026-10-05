// اتصال بسيط مع Gemini API (generateContent). المفتاح يبقى على الخادم فقط.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

export const config = {
  key: () => process.env.GEMINI_API_KEY,
  model: () => process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  ttsModel: () => process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts',
  voice: () => process.env.GEMINI_VOICE || 'Charon',
  // نماذج احتياطية عند ضغط سيرفرات Google (503) أو انتهاء حد نموذج معين (429)
  fallbacks: () => list(process.env.GEMINI_FALLBACK_MODELS, ['gemini-3.5-flash', 'gemini-3.5-flash-lite']),
  ttsFallbacks: () => list(process.env.GEMINI_TTS_FALLBACK_MODELS, ['gemini-3.8-flash-tts'])
};
function list(value, defaults) { return value ? value.split(',').map(s => s.trim()).filter(Boolean) : defaults; }
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class GeminiError extends Error {
  constructor(status, detail) { super(detail); this.status = status; }
}

async function postOnce(model, method, body, stream) {
  const url = `${BASE}${encodeURIComponent(model)}:${method}${stream ? '?alt=sse' : ''}`;
  const send = b => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': config.key() }, body: JSON.stringify(b) });
  let res = await send(body);
  // بعض النماذج لا تدعم إعداد التفكير؛ نعيد المحاولة بدونه.
  if (res.status === 400 && body.generationConfig?.thinkingConfig) {
    const text = await res.text();
    if (/thinking/i.test(text)) {
      const { thinkingConfig, ...gc } = body.generationConfig;
      res = await send({ ...body, generationConfig: gc });
    } else throw new GeminiError(400, text.slice(0, 500));
  }
  if (!res.ok) throw new GeminiError(res.status, (await res.text()).slice(0, 500));
  return res;
}

// يجرب النموذج الأساسي مرتين، ثم النماذج الاحتياطية بالترتيب، عند الأخطاء المؤقتة فقط.
async function post(models, method, body, { stream = false } = {}) {
  let last;
  for (const [i, model] of [...new Set(models)].entries()) {
    for (let attempt = 0; attempt < (i === 0 ? 2 : 1); attempt++) {
      try {
        return await postOnce(model, method, body, stream);
      } catch (err) {
        last = err;
        if (!(err instanceof GeminiError) || !RETRYABLE.has(err.status)) throw err;
        console.warn(`Gemini ${err.status} on ${model}; retrying`);
        if (attempt === 0 && i === 0) await sleep(600);
      }
    }
  }
  throw last;
}

function textFrom(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
}

function request(system, contents, { maxTokens = 700, json = false } = {}) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: maxTokens,
      thinkingConfig: { thinkingLevel: 'low' },
      ...(json ? { responseMimeType: 'application/json' } : {})
    }
  };
}

export async function generate(system, contents, opts) {
  const res = await post([config.model(), ...config.fallbacks()], 'generateContent', request(system, contents, opts));
  return textFrom(await res.json());
}

// يحول SSE من Gemini إلى نص عادي يصل للمتصفح تدريجيًا.
export async function generateStream(system, contents, opts) {
  const res = await post([config.model(), ...config.fallbacks()], 'streamGenerateContent', request(system, contents, opts), { stream: true });
  const decoder = new TextDecoder(), encoder = new TextEncoder();
  let buffer = '';
  return res.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try { const t = textFrom(JSON.parse(line.slice(5))); if (t) controller.enqueue(encoder.encode(t)); } catch { /* سطر غير مكتمل */ }
      }
    },
    flush(controller) {
      if (buffer.startsWith('data:')) { try { const t = textFrom(JSON.parse(buffer.slice(5))); if (t) controller.enqueue(encoder.encode(t)); } catch {} }
    }
  }));
}

// تحويل نص إلى صوت. يرجع WAV جاهز للتشغيل في المتصفح.
export async function speak(text) {
  const prompt = text;
  const res = await post([config.ttsModel(), ...config.ttsFallbacks()], 'generateContent', {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice() } } }
    }
  });
  const json = await res.json();
  const part = (json?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData);
  if (!part) throw new GeminiError(502, 'لم يرجع نموذج الصوت أي صوت');
  const { mimeType = '', data } = part.inlineData;
  const bytes = Buffer.from(data, 'base64');
  if (/wav/i.test(mimeType)) return bytes;
  const rate = Number((mimeType.match(/rate=(\d+)/) || [])[1]) || 24000;
  return pcmToWav(bytes, rate);
}

function pcmToWav(pcm, sampleRate, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bits) / 8;
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(byteRate, 28); header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

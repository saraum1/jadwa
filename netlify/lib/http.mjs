// أدوات مشتركة للدوال: التحقق من الطلب ورسائل الخطأ بالعربي.
import { config, GeminiError } from './gemini.mjs';

export const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export async function readBody(req, maxBytes) {
  if (req.method !== 'POST') throw Object.assign(new Error('POST فقط'), { status: 405 });
  if (!config.key()) throw Object.assign(new Error('مفتاح Gemini غير مضاف. أضف GEMINI_API_KEY في إعدادات Netlify ثم أعد النشر.'), { status: 503, code: 'no_key' });
  // حماية بسيطة: نقبل الطلبات من نفس الموقع فقط.
  const origin = req.headers.get('origin');
  const allowed = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL, 'http://localhost:8888'].filter(Boolean);
  if (origin && allowed.length && !allowed.includes(origin) && !origin.endsWith('.netlify.app'))
    throw Object.assign(new Error('مصدر الطلب غير مسموح'), { status: 403 });
  const text = await req.text();
  if (text.length > maxBytes) throw Object.assign(new Error('الطلب أكبر من المسموح'), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('صيغة الطلب غير صحيحة'), { status: 400 }); }
}

export function errorResponse(err) {
  if (err instanceof GeminiError) {
    console.error('Gemini error', err.status, err.message);
    if (err.status === 429) return json(429, { error: 'وصلنا لحد الاستخدام المجاني مؤقتًا. حاول بعد دقيقة.', code: 'rate_limit' });
    if (err.status === 400 || err.status === 403) return json(502, { error: 'تعذر الاتصال بنموذج الذكاء الاصطناعي. تأكد من المفتاح واسم النموذج.', code: 'gemini_config' });
    return json(502, { error: 'نموذج الذكاء الاصطناعي لم يرد. حاول مرة ثانية.', code: 'gemini_error' });
  }
  return json(err.status || 500, { error: err.message || 'خطأ غير متوقع', code: err.code || 'error' });
}

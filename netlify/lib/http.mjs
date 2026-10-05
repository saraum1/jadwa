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
  const site = process.env.SITE_NAME;
  const preview = site && origin && origin.startsWith('https://') && origin.endsWith(`--${site}.netlify.app`);
  if (origin && allowed.length && !allowed.includes(origin) && !preview)
    throw Object.assign(new Error('مصدر الطلب غير مسموح'), { status: 403 });
  await requireUser(req);
  const text = await req.text();
  if (text.length > maxBytes) throw Object.assign(new Error('الطلب أكبر من المسموح'), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('صيغة الطلب غير صحيحة'), { status: 400 }); }
}

export function errorResponse(err) {
  if (err instanceof GeminiError) {
    console.error('Gemini error', err.status, err.message);
    if (err.status === 503 || err.status === 500) return json(503, { error: 'سيرفرات Google مضغوطة الحين. حاول بعد دقيقة.', code: 'overloaded' });
    if (err.status === 429) return json(429, { error: 'وصلنا لحد الاستخدام المجاني مؤقتًا. حاول بعد دقيقة.', code: 'rate_limit' });
    if (err.status === 400 || err.status === 403) return json(502, { error: 'تعذر الاتصال بنموذج الذكاء الاصطناعي. تأكد من المفتاح واسم النموذج.', code: 'gemini_config' });
    return json(502, { error: 'نموذج الذكاء الاصطناعي لم يرد. حاول مرة ثانية.', code: 'gemini_error' });
  }
  return json(err.status || 500, { error: err.message || 'خطأ غير متوقع', code: err.code || 'error' });
}

// ---------- التحقق من تسجيل الدخول (Supabase) وحد الطلبات ----------
const SUPABASE_URL = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const tokenCache = new Map(); // token → { id, until }
const hits = new Map(); // userId → [timestamps]
const LIMIT_PER_MINUTE = Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 20);

async function requireUser(req) {
  // بدون إعداد Supabase على الخادم (تشغيل محلي) لا نطلب تسجيل دخول.
  if (!SUPABASE_URL() || !SUPABASE_KEY()) return null;
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw Object.assign(new Error('سجّل دخولك أولًا لاستخدام جدوى.'), { status: 401, code: 'auth' });
  let user = tokenCache.get(token);
  if (!user || user.until < Date.now()) {
    const res = await fetch(`${SUPABASE_URL()}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY(), authorization: `Bearer ${token}` } });
    if (!res.ok) throw Object.assign(new Error('انتهت جلستك. سجّل دخولك مرة ثانية.'), { status: 401, code: 'auth' });
    const data = await res.json();
    user = { id: data.id, until: Date.now() + 5 * 60_000 };
    tokenCache.set(token, user);
    if (tokenCache.size > 500) tokenCache.delete(tokenCache.keys().next().value);
  }
  const now = Date.now(), recent = (hits.get(user.id) || []).filter((t) => now - t < 60_000);
  if (recent.length >= LIMIT_PER_MINUTE) throw Object.assign(new Error('طلبات كثيرة خلال دقيقة. خذ نفس وحاول بعد قليل.'), { status: 429, code: 'user_rate_limit' });
  recent.push(now);
  hits.set(user.id, recent);
  return user;
}

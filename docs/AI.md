# جدوى AI — العقل

**الكود يحسب، والذكاء الاصطناعي يشرح.** كل رقم يُحسب في `src/features/ai/engine.js` (دوال نقية)، ثم تُرسل النتيجة (facts) لـ Gemini ليجاوب منها فقط. الشات والاجتماع يستخدمان نفس العقل ونفس الأرقام.

النطاق المعتمد: العقل يعمل في «اسأل جدوى» والاجتماع فقط. أرقام الرئيسية وفرص التحسين لم تتغير وما زالت من جداولها.

```
بيانات المنشأة ──► dataset.js ──► engine.js ──► facts
  ملفات مركز البيانات (data_hub_files / الجلسة)        ├─► AskJadwa.jsx   ──► /api/chat (mode=chat)
  ثم جداول Supabase (منتجات/مخزون/مصروفات)            └─► MeetingVoice.jsx ──► /api/chat (mode=meeting…) ──► /api/tts ──► صوت + فم الروبوت
  ثم البيانات التوضيحية للزائر المحلي
```

## الملفات
| الملف | الدور |
|---|---|
| `src/features/ai/engine.js` | الحسابات: الملخص، الأصناف الخاسرة، ارتفاع التكلفة، الهدر، الاشتراكات المتشابهة، الطلب الزائد، أيام الأسبوع، فجوات البيانات. الافتراضات في `ASSUMPTIONS`. |
| `src/features/ai/dataset.js` | مصدر البيانات حسب المستخدم. |
| `src/features/ai/client.js` | `ask()` و`speak()` و`openAskJadwa()`. |
| `src/features/ai/AskJadwa.jsx` | لوحة الشات، تُركّب في main.jsx لصفحات dashboard/opportunities/products/expenses. |
| `src/features/ai/MeetingVoice.jsx` | `useMeetingVoice` + `VoicePanel`: يبدأ جدوى الاجتماع، يسمع (SpeechRecognition من المتصفح)، يرد بصوت، ويختم بخطة عمل تُحفظ في localStorage ويسأل عنها في الاجتماع التالي. |
| `netlify/functions/chat.mjs` | `/api/chat` |
| `netlify/functions/tts.mjs` | `/api/tts` |
| `netlify/lib/prompt.mjs` | **شخصية جدوى وقواعده** (لا أرقام مخترعة، عربي مختصر، قرار لا نصيحة عامة). |
| `netlify/lib/gemini.mjs` | الاتصال بـ Gemini (generateContent). المفتاح على الخادم فقط. |

## الروبوت
`room.vert`: uniform `mouthOpen` يمدد الابتسامة (robot-smile، motion 1) مع قوة الصوت. `room.frag`: uniform `listenGlow` يضيء مؤشر الصدر وقت الاستماع. `adapter.setFace({mouth, glow})`.
أحداث للأنيميشن المستقبلي: `jadwa:state` و`jadwa:mouth` و`jadwa:say` على window.
> تنبيه: `npm run sync:room` ينسخ الـ shaders من مجلد project الأصلي ويمسح هذه الإضافات. أعيدي إضافتها بعده.

## النشر (Netlify)
`netlify.toml` يبني Vite وينشر dist ويشغّل الدوال. متغيرات البيئة في Netlify:

| المتغير | |
|---|---|
| `GEMINI_API_KEY` | مطلوب (Google AI Studio) |
| `VITE_SUPABASE_URL` و`VITE_SUPABASE_PUBLISHABLE_KEY` | مطلوبة لتسجيل الدخول والبيانات |
| `GEMINI_MODEL` | اختياري، افتراضي `gemini-3.8-flash` |
| `GEMINI_TTS_MODEL` | اختياري، افتراضي `gemini-3.8-flash-lite-tts` |
| `GEMINI_VOICE` | اختياري، افتراضي `Charon` |

محليًا مع الدوال: `npx netlify-cli dev` (تشغيل `npm run dev` وحده يعرض رسالة أن الـ AI يعمل بعد النشر).

## حدود
- الخطة المجانية في Gemini قد تستخدم البيانات لتحسين منتجات Google؛ فعّلوا الدفع قبل بيانات عملاء حقيقيين.
- حد الصوت المجاني: يكمل الاجتماع بصوت المتصفح تلقائيًا.
- الميكروفون: Chrome وEdge وSafari. Firefox: كتابة فقط.
- ساعات الذروة ونقص الموظفين غير مدعومة (لا وقت بيع ولا ورديات)؛ جدوى يقول «لا توجد بيانات كافية».
- خدمات الجداول الحالية تدعم سبتمبر وأغسطس 2026 فقط؛ الفترات الأخرى تعمل من ملفات مركز البيانات.
- الدوال تقبل الطلبات من نفس الموقع فقط، ولا تتحقق من تسجيل الدخول بعد. قبل الإطلاق العام: تحقق JWT من Supabase وحد طلبات لكل مستخدم.
- اختُبر كل شيء بنسخة تحاكي Gemini؛ أول تشغيل بالمفتاح الحقيقي هو الاختبار الفعلي.

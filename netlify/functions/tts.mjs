// POST /api/tts  { text }  →  audio/wav
import { speak } from '../lib/gemini.mjs';
import { readBody, json, errorResponse } from '../lib/http.mjs';

const STYLE = 'Read the following Arabic text aloud as Jadwa, a calm, warm and confident Saudi business advisor. Natural pace, clear numbers. Read only the text:';

export default async (req) => {
  try {
    const body = await readBody(req, 8_000);
    const text = String(body.text || '').replace(/[*#_`>|]/g, '').trim().slice(0, 1200);
    if (!text) return json(400, { error: 'لا يوجد نص لتحويله إلى صوت.' });
    const wav = await speak(text, STYLE);
    return new Response(wav, { headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config = { path: '/api/tts' };

const path = require('path');
const express = require('express');
const { FEATURE_PROMPTS } = require('./prompts');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function getGeminiApiKey() {
  const key = process.env.GEMINI_API_KEY;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', model: GEMINI_MODEL, hasApiKey: Boolean(getGeminiApiKey()) });
});

app.post('/api/generate', async (req, res) => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return res.status(503).json({ error: '서버 환경변수 GEMINI_API_KEY가 설정되지 않았습니다.' });

  try {
    const { feature, input } = req.body || {};
    if (!feature || !FEATURE_PROMPTS[feature]) return res.status(400).json({ error: '지원하지 않는 기능입니다.' });
    if (!input || typeof input !== 'object' || Array.isArray(input)) return res.status(400).json({ error: '입력 데이터가 올바르지 않습니다.' });

    const prompt = FEATURE_PROMPTS[feature].build(input);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 4096 } }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: 'Gemini API 요청에 실패했습니다.' });
    const result = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
    if (!result) return res.status(502).json({ error: '생성된 결과가 비어 있습니다. 다시 시도해 주세요.' });
    return res.json({ feature, title: FEATURE_PROMPTS[feature].title, result });
  } catch (error) {
    console.error('[server error]', error.message);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Job Star 서버: http://localhost:${PORT}`));
}

module.exports = app;

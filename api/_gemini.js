const https = require('https');
const { FEATURE_PROMPTS } = require('../prompts');

const MAX_INPUT_LENGTH = 30000;

function getGeminiApiKey() {
  const key = process.env.GEMINI_API_KEY;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

function getGeminiModel() {
  const model = process.env.GEMINI_MODEL;
  return typeof model === 'string' && model.trim() ? model.trim() : 'gemini-2.5-flash';
}

async function generateFeature(feature, input) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    const error = new Error('서버 환경변수 GEMINI_API_KEY가 설정되지 않았습니다.');
    error.statusCode = 503;
    throw error;
  }
  if (!feature || !FEATURE_PROMPTS[feature]) {
    const error = new Error('지원하지 않는 기능입니다.');
    error.statusCode = 400;
    throw error;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const error = new Error('입력 데이터가 올바르지 않습니다.');
    error.statusCode = 400;
    throw error;
  }

  const prompt = FEATURE_PROMPTS[feature].build(input);
  if (prompt.length > MAX_INPUT_LENGTH) {
    const error = new Error(`입력 내용이 너무 깁니다. ${MAX_INPUT_LENGTH.toLocaleString()}자 이하로 입력해 주세요.`);
    error.statusCode = 413;
    throw error;
  }

  const model = getGeminiModel();
  const data = await callGeminiREST(model, apiKey, prompt);
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
  if (!text) throw Object.assign(new Error('생성된 결과가 비어 있습니다. 다시 시도해 주세요.'), { statusCode: 502 });

  return { feature, title: FEATURE_PROMPTS[feature].title, result: text };
}

function callGeminiREST(model, apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    });
    const request = https.request({
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let data = {};
        try { data = JSON.parse(raw); } catch { return reject(new Error('Gemini 응답 JSON 파싱 오류')); }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error('Gemini API 요청에 실패했습니다.'));
        }
        resolve(data);
      });
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

module.exports = { getGeminiApiKey, getGeminiModel, generateFeature };

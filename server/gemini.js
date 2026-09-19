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
  if (!feature || !Object.hasOwn(FEATURE_PROMPTS,feature)) {
    const error = new Error('지원하지 않는 기능입니다.');
    error.statusCode = 400;
    throw error;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const error = new Error('입력 데이터가 올바르지 않습니다.');
    error.statusCode = 400;
    throw error;
  }


  const allowed = {"counselingLog":["participantInfo","sessionInfo","discussion","agreements","nextSession"],"interviewQA":["participantInfo","company","job"],"interviewFeedback":["question","answer"],"followUpPlan":["participantInfo"],"caseClosure":["period","sessions","employmentResult","interventions","notes"],"strategyPivot":["period","jobSearchHistory","failStage","notes"]};
  if (Object.entries(input).some(([k,v])=>!allowed[feature].includes(k)||typeof v!=='string'||v.length>6000)||!Object.values(input).some(v=>v.trim())) {
    throw Object.assign(new Error('입력 항목과 길이를 확인해 주세요.'),{statusCode:400});
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

async function callGeminiREST(model,apiKey,prompt) {
  const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
    body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.7,maxOutputTokens:4096}}),
    signal:AbortSignal.timeout(45000)
  });
  if(!response.ok){await response.body?.cancel();throw Object.assign(new Error('생성 API 호출 실패'),{statusCode:502});}
  return response.json();
}
module.exports={getGeminiApiKey,getGeminiModel,generateFeature};

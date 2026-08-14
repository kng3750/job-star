const FEATURE_META = {
  counselingLog: {
    title: "상담일지 자동 생성",
    desc: "참여자 정보와 상담 내용을 입력하면 정식 상담일지 양식으로 생성합니다.",
  },
  interviewQA: {
    title: "면접 예상 질문 및 답변 생성",
    desc: "중장년·경력보유 여성에 특화된 면접 예상 질문과 답변 예시, 1분 자기소개를 생성합니다.",
  },
  interviewFeedback: {
    title: "모의 면접 답변 피드백",
    desc: "면접 질문과 실제 답변을 분석해 강점·개선점과 모범 답변을 제안합니다.",
  },
  followUpPlan: {
    title: "취업 후 사후관리 계획 수립",
    desc: "취업 초기 적응을 위한 주차별 체크리스트와 위험 신호·조언을 생성합니다.",
  },
  caseClosure: {
    title: "사례 종결 요약 보고서",
    desc: "참여 과정과 취업 성과를 정리한 공식 종결 요약 보고서를 작성합니다.",
  },
  strategyPivot: {
    title: "취업 전략 전환 (미취업자 대상)",
    desc: "탈락 원인을 분석하고 향후 1개월 집중 전략과 격려 메시지를 제시합니다.",
  },
};

const navItems = document.querySelectorAll(".nav-item");
const forms = document.querySelectorAll(".feature-form");
const titleEl = document.getElementById("feature-title");
const descEl = document.getElementById("feature-desc");
const resultOutput = document.getElementById("result-output");
const resultStatus = document.getElementById("result-status");
const btnCopy = document.getElementById("btn-copy");
const btnClear = document.getElementById("btn-clear");
const apiStatusText = document.getElementById("api-status-text");
const apiStatusDot = document.getElementById("api-status-dot");

const state = {
  apiKey: "BACKEND_ENV",
  model: "gemini-2.5-flash",
  backendUrl: "",
  mode: "backend"
};

let latestResult = "";
let activeFeature = "counselingLog";

function setApiStatus(type, text) {
  if (apiStatusText) apiStatusText.textContent = text;
  if (apiStatusDot) {
    apiStatusDot.className = "api-status-dot" + (type ? ` is-${type}` : "");
  }
}

async function loadApiKey() {
  setApiStatus("loading", "서버 환경변수 연결 확인 중…");
  const isFileProtocol = location.protocol === "file:";
  const healthUrl = isFileProtocol ? "http://localhost:3000/api/health" : "/api/health";
  try {
    const res = await fetch(healthUrl);
    const data = await res.json();
    if (res.ok && data.hasApiKey === true) {
      state.apiKey = "BACKEND_ENV";
      state.mode = "backend";
      state.backendUrl = isFileProtocol ? "http://localhost:3000" : "";
      if (data.model) state.model = data.model;
      setApiStatus("ok", "API 연결됨 (서버 환경변수)");
      return true;
    }
  } catch (error) {
    console.warn("API 상태 확인 실패:", error.message);
  }
  state.apiKey = "BACKEND_ENV";
  state.mode = "backend";
  setApiStatus("error", "서버 환경변수 미설정 또는 서버 미실행");
  return false;
}

function switchFeature(feature) {
  if (!FEATURE_META[feature]) return;
  activeFeature = feature;

  navItems.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.feature === feature);
  });

  forms.forEach((form) => {
    const isTarget = form.dataset.feature === feature;
    form.hidden = !isTarget;
    form.classList.toggle("is-active", isTarget);
  });

  titleEl.textContent = FEATURE_META[feature].title;
  descEl.textContent = FEATURE_META[feature].desc;
  setStatus("");
}

function formToObject(form) {
  const data = {};
  const fields = form.querySelectorAll("input, textarea, select");
  fields.forEach((field) => {
    if (!field.name) return;
    data[field.name] = field.value.trim();
  });
  return data;
}

function setStatus(message, type = "") {
  resultStatus.textContent = message;
  resultStatus.className = "result-status" + (type ? ` is-${type}` : "");
}

function setResult(text) {
  latestResult = text || "";
  if (!latestResult) {
    resultOutput.innerHTML =
      '<p class="result-placeholder">왼쪽에서 업무를 선택하고 내용을 입력한 뒤 생성 버튼을 눌러 주세요.</p>';
    btnCopy.disabled = true;
    btnClear.disabled = true;
    return;
  }

  const pre = document.createElement("div");
  pre.className = "result-content";
  pre.textContent = latestResult;
  resultOutput.replaceChildren(pre);
  btnCopy.disabled = false;
  btnClear.disabled = false;
}

function setLoading(isLoading, form) {
  const button = form.querySelector(".btn-generate");
  if (!button) return;
  button.disabled = isLoading;
  button.dataset.originalText =
    button.dataset.originalText || button.textContent;
  button.textContent = isLoading
    ? "생성 중…"
    : button.dataset.originalText;
}

async function generateViaBackend(feature, input) {
  const base = state.backendUrl || "";
  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature, input }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "생성에 실패했습니다.");
  }
  return data;
}


async function generate(feature, input, form) {
  if (!state.apiKey) {
    const ok = await loadApiKey();
    if (!ok) {
      setStatus(
        "서버 환경변수가 설정되지 않았거나 서버가 실행되지 않았습니다.",
        "error"
      );
      return;
    }
  }

  setLoading(true, form);
  setStatus("Gemini가 문서를 작성하고 있습니다…", "loading");

  try {
    const data = await generateViaBackend(feature, input);

    setResult(data.result);
    setStatus(`「${data.title}」 생성이 완료되었습니다.`, "ok");
  } catch (err) {
    setStatus(err.message || "오류가 발생했습니다.", "error");
  } finally {
    setLoading(false, form);
  }
}

navItems.forEach((btn) => {
  btn.addEventListener("click", () => switchFeature(btn.dataset.feature));
});

forms.forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const feature = form.dataset.feature;
    const input = formToObject(form);
    generate(feature, input, form);
  });
});

btnCopy.addEventListener("click", async () => {
  if (!latestResult) return;
  try {
    await navigator.clipboard.writeText(latestResult);
    setStatus("결과가 클립보드에 복사되었습니다.", "ok");
  } catch {
    setStatus("복사에 실패했습니다. 텍스트를 직접 선택해 복사해 주세요.", "error");
  }
});

btnClear.addEventListener("click", () => {
  setResult("");
  setStatus("");
});

switchFeature(activeFeature);
loadApiKey();
